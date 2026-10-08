import { q } from "../db/index.js";
import {
  deleteSelection,
  getShareableUsers,
  listSelections,
  saveSelection,
  shareSelection,
  unshareSelection,
} from "../models/reportModel.js";
import { reportSql } from "../../scripts/sql/reportSql.js";
import { signedObjectUrl } from "./storageService.js";

const groupable = new Set(Object.keys(reportSql.groupExpr));
const rawSortable = new Set(["date", "category", "item", "survivor"]);
const groupedSortable = new Set([
  "date",
  "survivor",
  "category",
  "item",
  "price",
  ...groupable,
]);

function cleanConfig(config = {}) {
  const filters = config.filters || {};
  const groupBy = Array.isArray(config.groupBy)
    ? config.groupBy.filter((x) => groupable.has(x))
    : [];
  const uniqueGroupBy = [...new Set(groupBy)];
  const allowedSort = uniqueGroupBy.length ? groupedSortable : rawSortable;

  const sortColumns = (Array.isArray(config.sortColumns) ? config.sortColumns : [])
    .filter((x) => allowedSort.has(x?.column))
    .map((x) => ({
      column: x.column,
      direction: x.direction === "desc" ? "desc" : "asc",
    }))
    .filter((x, i, a) => a.findIndex((y) => y.column === x.column) === i);

  return {
    dateFilterType: ["none", "date", "range", "month", "year"].includes(config.dateFilterType)
      ? config.dateFilterType
      : "none",
    filters: {
      date: filters.date || "",
      dateFrom: filters.dateFrom || "",
      dateTo: filters.dateTo || "",
      month: filters.month || "",
      year: filters.year || "",
      hasProof: ["true", "false"].includes(filters.hasProof) ? filters.hasProof : "",
      categoryItems: Array.isArray(filters.categoryItems)
        ? [...new Set(filters.categoryItems.map(String))]
        : [],
      categories: Array.isArray(filters.categories)
        ? [...new Set(filters.categories.map(String))]
        : [],
      survivors: Array.isArray(filters.survivors)
        ? [...new Set(filters.survivors.map(String))]
        : [],
    },
    sortColumns,
    groupBy: uniqueGroupBy,
    summarise: Boolean(config.summarise),
  };
}

function addFilter(where, params, filters, alias) {
  if (filters.date) {
    params.push(filters.date);
    where.push(reportSql.filterDate(alias, params.length));
  } else if (filters.dateFrom || filters.dateTo) {
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      where.push(reportSql.filterFrom(alias, params.length));
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      where.push(reportSql.filterTo(alias, params.length));
    }
  } else if (filters.month) {
    params.push(`${filters.month}-01`);
    where.push(reportSql.filterMonthFrom(alias, params.length));
    where.push(reportSql.filterMonthTo(alias, params.length));
  } else if (filters.year) {
    params.push(Number(filters.year));
    where.push(reportSql.filterYear(alias, params.length));
  }

  if (filters.hasProof) {
    where.push(reportSql.filterProof(alias, filters.hasProof === "true"));
  }

  if (filters.categoryItems.length) {
    const clauses = [];
    for (const key of filters.categoryItems) {
      const [categoryId, kind, itemId] = String(key).split(":");
      params.push(categoryId);
      const categoryIndex = params.length;

      if (kind === "item") {
        params.push(itemId);
        clauses.push(reportSql.filterCategoryItem(alias, categoryIndex, params.length));
      } else if (kind === "other") {
        clauses.push(reportSql.filterOther(alias, categoryIndex));
      } else {
        clauses.push(reportSql.filterTotal(alias, categoryIndex));
      }
    }
    where.push(reportSql.or(clauses));
  }

  if (filters.categories.length) {
    params.push(filters.categories);
    where.push(reportSql.filterCategories(alias, params.length));
  }

  if (filters.survivors.length) {
    params.push(filters.survivors);
    where.push(reportSql.filterSurvivors(alias, params.length));
  }

  return reportSql.where(where);
}

function detailOrderSql(config) {
  const expressions = {
    date: "expense_date",
    week: "date_trunc('week', expense_date)::date",
    month: "date_trunc('month', expense_date)::date",
    year: "extract(year from expense_date)::int",
    category: "category",
    item: "item",
    survivor: "survivor",
    price: "report_amount",
  };

  const parts = [];

  for (const sort of config.sortColumns) {
    const expression = expressions[sort.column];
    if (expression) {
      parts.push(reportSql.order(expression, sort.direction.toUpperCase()));
    }
  }

  for (const column of config.groupBy) {
    const expression = expressions[column];
    if (!expression || config.sortColumns.some((sort) => sort.column === column)) continue;
    parts.push(reportSql.order(expression, "ASC"));
  }

  parts.push("expense_date DESC", "id DESC");
  return parts.join(", ");
}

function summaryOrderSql(config) {
  const expressions = {
    date: "expense_date",
    week: "date_trunc('week', expense_date)::date",
    month: "date_trunc('month', expense_date)::date",
    year: "extract(year from expense_date)::int",
    category: "category",
    item: "item",
    survivor: "survivor",
    price: "SUM(report_amount)",
  };

  const parts = [];
  for (const sort of config.sortColumns) {
    if (!expressions[sort.column]) continue;

    let expression = expressions[sort.column];
    if (sort.column !== "price" && !config.groupBy.includes(sort.column)) {
      expression = `MIN(${expression})`;
    }
    parts.push(reportSql.order(expression, sort.direction.toUpperCase()));
  }

  if (parts.length) return parts.join(", ");

  return config.groupBy
    .map((column) => expressions[column])
    .filter(Boolean)
    .map((expression) => reportSql.order(expression, "ASC"))
    .join(", ");
}

function chartData(rows, groupBy) {
  return rows.map((row) => ({
    label: groupBy.map((column) => `${column}: ${row[column]}`).join(" • "),
    value: Number(row.total || 0),
  }));
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function calculateDetailTotal(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, row) => sum + (numericValue(row.expense_amount) || 0), 0);
}

async function hydrateRows(rows) {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      quantity: row.quantity == null ? null : Number(row.quantity),
      expense_amount: row.expense_amount == null ? null : Number(row.expense_amount),
      proof_url: row.proof_key ? await signedObjectUrl(row.proof_key) : null,
    })),
  );
}

export async function runReport(input) {
  const config = cleanConfig(input);

  /*
   * Every report is built from one row per expense share. This means:
   * - fixed shares use their fixed amount;
   * - average shares use the already-resolved equal allocation;
   * - remaining shares use the resolved remainder.
   *
   * Consequently every visible expense row represents only that survivor's
   * share and the original total_cost is never repeated across survivors.
   */
  const cte = reportSql.sourcePerExpense;
  const params = [];
  const where = addFilter([], params, config.filters, "expense_source");

  if (!config.groupBy.length && !config.summarise) {
    const result = await q(
      reportSql.raw(cte, reportSql.rawSelectPerExpense, where, detailOrderSql(config)),
      params,
    );
    const rows = await hydrateRows(result.rows);

    return {
      mode: "raw",
      columns: [
        "expense_date",
        "category",
        "item",
        "quantity",
        "unit",
        "share",
        "expense_amount",
        "comment",
        "proof_url",
      ],
      rows,
      total: calculateDetailTotal(rows),
      chartData: [],
    };
  }

  if (!config.groupBy.length && config.summarise) {
    const result = await q(reportSql.totalSummary(cte, where), params);
    const total = Number(result.rows[0]?.total || 0);

    return {
      mode: "summary",
      columns: ["total"],
      rows: [{ total }],
      total,
      chartData: [{ label: "Total", value: total }],
    };
  }

  /*
   * Grouping without summarise is intentionally a detail report. SQL keeps
   * every split-share row and orders it by the selected group/sort columns;
   * the UI then renders every raw row underneath each group.
   */
  if (!config.summarise) {
    const result = await q(
      reportSql.raw(cte, reportSql.rawSelectPerExpense, where, detailOrderSql(config)),
      params,
    );
    const rows = await hydrateRows(result.rows);

    return {
      mode: "grouped-raw",
      columns: [
        ...config.groupBy,
        "expense_date",
        "category",
        "item",
        "quantity",
        "unit",
        "share",
        "expense_amount",
        "comment",
        "proof_url",
      ],
      groupBy: config.groupBy,
      rows,
      total: calculateDetailTotal(rows),
      chartData: [],
    };
  }

  const groupSelect = config.groupBy.map(
    (column) => `${reportSql.groupExpr[column]} AS "${column}"`,
  );

  if (config.groupBy.includes("category")) {
    groupSelect.push("MIN(category_id) AS category_id");
  }
  if (config.groupBy.includes("survivor")) {
    groupSelect.push("MIN(survivor_id) AS survivor_id");
  }

  const groupBySql = config.groupBy.map((column) => reportSql.groupExpr[column]).join(", ");

  const result = await q(
    reportSql.grouped(
      cte,
      [...groupSelect, "SUM(report_amount) AS total"].join(", "),
      where,
      groupBySql,
      summaryOrderSql(config),
    ),
    params,
  );

  const rows = result.rows.map((row) => ({
    ...row,
    total: Number(row.total || 0),
  }));
  const total = rows.reduce((sum, row) => sum + row.total, 0);

  return {
    mode: "summary",
    columns: [...config.groupBy, "total"],
    rows,
    total,
    chartData: chartData(rows, config.groupBy),
  };
}

async function resolveCategoryItemFilterLabelsForPdf(config) {
  const filters = config?.filters || {};
  const keys = Array.isArray(filters.categoryItems)
    ? [...new Set(filters.categoryItems.map(String))]
    : [];

  if (!keys.length) return [];

  const categoryIds = [
    ...new Set(
      keys
        .map((key) => String(key).split(":")[0])
        .filter((value) => /^\d+$/.test(value)),
    ),
  ];
  if (!categoryIds.length) return keys;

  const result = await q(
    `
      SELECT c.id AS category_id,
             c.name AS category,
             i.id AS item_id,
             i.name AS item
        FROM public.categories c
        LEFT JOIN public.items i ON i.category_id = c.id
       WHERE c.id = ANY($1::bigint[])
    `,
    [categoryIds],
  );

  const categories = new Map();
  const items = new Map();
  for (const row of result.rows || []) {
    const categoryId = String(row.category_id);
    categories.set(categoryId, row.category);
    if (row.item_id != null) {
      items.set(String(row.item_id), { categoryId, name: row.item });
    }
  }

  return keys.map((key) => {
    const [categoryId, kind, itemId] = String(key).split(":");
    const categoryName = categories.get(String(categoryId)) || `Category ${categoryId}`;
    if (kind === "item") {
      const item = items.get(String(itemId));
      return `${categoryName} - ${item?.name || `Item ${itemId}`}`;
    }
    return `${categoryName} - ${kind === "other" ? "Other" : "Total"}`;
  });
}

export async function buildReportPdfData(config = {}) {
  const report = await runReport(config);

  const rawConfig = {
    ...config,
    summarise: false,
    groupBy: ["survivor"],
    sortColumns: (Array.isArray(config.sortColumns) ? config.sortColumns : [])
      .filter((item) => ["date", "category", "item", "survivor"].includes(item?.column))
      .map((item) => ({
        column: item.column,
        direction: item.direction === "desc" ? "desc" : "asc",
      })),
  };

  const rawReport = await runReport(rawConfig);
  const categoryItemLabels = await resolveCategoryItemFilterLabelsForPdf(config);

  return {
    ...report,
    rawRows: rawReport.rows || [],
    rawColumns: rawReport.columns || [],
    pdfConfig: {
      ...config,
      filters: {
        ...(config.filters || {}),
        categoryItemLabels,
      },
    },
  };
}

export {
  cleanConfig,
  deleteSelection,
  getShareableUsers,
  listSelections,
  saveSelection,
  shareSelection,
  unshareSelection,
};
