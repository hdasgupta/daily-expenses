import { q } from "../db/index.js";
import { deleteSelection, listSelections, saveSelection } from "../models/reportModel.js";
import { reportSql } from "../../scripts/sql/reportSql.js";

const groupable = new Set(Object.keys(reportSql.groupExpr));
const rawSortable = new Set(["date", "category", "item", "survivor"]);

function cleanConfig(config = {}) {
  const filters = config.filters || {};
  const groupBy = Array.isArray(config.groupBy)
    ? config.groupBy.filter((x) => groupable.has(x))
    : [];
  const uniqueGroupBy = [...new Set(groupBy)];
  const sortColumns = (Array.isArray(config.sortColumns) ? config.sortColumns : [])
    .filter((x) => (uniqueGroupBy.length ? [...groupable] : [...rawSortable]).includes(x?.column))
    .map((x) => ({
      column: x.column,
      direction: x.direction === "desc" ? "desc" : "asc",
    }))
    .filter((x, i, a) => a.findIndex((y) => y.column === x.column) === i);
  const categoryItems = Array.isArray(filters.categoryItems)
    ? [...new Set(filters.categoryItems.map(String))]
    : [];
  const survivors = Array.isArray(filters.survivors)
    ? [...new Set(filters.survivors.map(String))]
    : [];
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
      categoryItems,
      survivors,
    },
    sortColumns,
    groupBy: uniqueGroupBy,
    summarise: Boolean(config.summarise) || uniqueGroupBy.length > 0,
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
  if (filters.hasProof) where.push(reportSql.filterProof(alias, filters.hasProof === "true"));
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
  if (filters.survivors.length) {
    params.push(filters.survivors);
    where.push(reportSql.filterSurvivors(alias, params.length));
  }
  return reportSql.where(where);
}

function orderSql(config, forGroup) {
  const expressions = forGroup
    ? reportSql.groupExpr
    : {
        date: "expense_date",
        category: "category",
        item: "item",
        survivor: "survivor",
      };
  const chosen = config.sortColumns.length ? config.sortColumns : [];
  const parts = chosen
    .filter((x) => !forGroup || config.groupBy.includes(x.column))
    .map((x) => reportSql.order(expressions[x.column], x.direction.toUpperCase()));
  if (parts.length) return parts.join(", ");
  return forGroup ? config.groupBy.map((x) => `"${x}"`).join(", ") : reportSql.defaultRawOrder;
}

function chartData(rows, groupBy) {
  return rows.map((row) => ({
    label: groupBy.map((column) => `${column}: ${row[column]}`).join(" • "),
    value: Number(row.total || 0),
  }));
}

export async function runReport(input) {
  const config = cleanConfig(input);
  const usesSurvivor =
    config.groupBy.includes("survivor") ||
    config.sortColumns.some((x) => x.column === "survivor") ||
    config.filters.survivors.length > 0;
  const cte = usesSurvivor ? reportSql.sourcePerSurvivor : reportSql.sourcePerExpense;
  const params = [];
  const where = addFilter([], params, config.filters, "expense_source");
  if (!config.groupBy.length && !config.summarise) {
    const select = usesSurvivor ? reportSql.rawSelectPerSurvivor : reportSql.rawSelectPerExpense;
    const result = await q(reportSql.raw(cte, select, where, orderSql(config, false)), params);
    const rows = result.rows.map((row) => ({
      ...row,
      total_cost: Number(row.total_cost),
      report_amount: row.report_amount == null ? null : Number(row.report_amount),
    }));
    return {
      mode: "raw",
      columns: usesSurvivor
        ? [
            "id",
            "expense_date",
            "category",
            "item",
            "survivor",
            "report_amount",
            "expense_type",
            "has_proof",
          ]
        : [
            "id",
            "expense_date",
            "category",
            "item",
            "survivor",
            "total_cost",
            "expense_type",
            "has_proof",
          ],
      rows,
      total: usesSurvivor
        ? rows.reduce((sum, row) => sum + (row.report_amount || 0), 0)
        : [...new Set(rows.map((r) => r.id))].reduce(
            (sum, id) => sum + Number(rows.find((r) => r.id === id)?.total_cost || 0),
            0,
          ),
      chartData: [],
    };
  }
  if (!config.groupBy.length && config.summarise) {
    const result = await q(
      reportSql.totalSummary(cte, usesSurvivor ? "SUM(report_amount)" : "SUM(total_cost)", where),
      params,
    );
    const total = Number(result.rows[0]?.total || 0);
    return {
      mode: "summary",
      columns: ["total"],
      rows: [{ total }],
      total,
      chartData: [{ label: "Total", value: total }],
    };
  }
  const groupSelect = config.groupBy.map(
    (column) => `${reportSql.groupExpr[column]} AS "${column}"`,
  );
  if (!config.summarise) {
    const rawSelect = usesSurvivor ? reportSql.rawSelectPerSurvivor : reportSql.rawSelectPerExpense;
    const select = [...groupSelect, rawSelect].join(", ");
    const result = await q(reportSql.raw(cte, select, where, orderSql(config, true)), params);
    const rows = result.rows.map((row) => ({
      ...row,
      total_cost: Number(row.total_cost),
      report_amount: row.report_amount == null ? null : Number(row.report_amount),
    }));
    return {
      mode: "grouped-raw",
      columns: [
        ...config.groupBy,
        ...(usesSurvivor
          ? [
              "id",
              "expense_date",
              "category",
              "item",
              "survivor",
              "report_amount",
              "expense_type",
              "has_proof",
            ]
          : [
              "id",
              "expense_date",
              "category",
              "item",
              "survivor",
              "total_cost",
              "expense_type",
              "has_proof",
            ]),
      ],
      groupBy: config.groupBy,
      rows,
      total: 0,
      chartData: [],
    };
  }
  const amount = usesSurvivor ? "SUM(report_amount)" : "SUM(total_cost)";
  const result = await q(
    reportSql.grouped(
      cte,
      [...groupSelect, `${amount} AS total`].join(", "),
      where,
      reportSql.groupExpr[config.groupBy[0]]
        ? config.groupBy.map((x) => reportSql.groupExpr[x]).join(", ")
        : `"${config.groupBy.join('","')}"`,
      reportSql.orderBy([orderSql(config, true)]),
    ),
    params,
  );
  const rows = result.rows.map((row) => ({ ...row, total: Number(row.total) }));
  return {
    mode: "summary",
    columns: [...config.groupBy, "total"],
    rows,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    chartData: chartData(rows, config.groupBy),
  };
}
export { cleanConfig, deleteSelection, listSelections, saveSelection };
