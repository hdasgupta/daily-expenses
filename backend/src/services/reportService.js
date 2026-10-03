import { q } from "../db/index.js";
import { deleteSelection, listSelections, saveSelection } from "../models/reportModel.js";
import { reportSql } from "../../scripts/sql/reportSql.js";
import { signedObjectUrl } from "./storageService.js";

const groupable = new Set(Object.keys(reportSql.groupExpr));

const rawSortable = new Set(["date", "category", "item", "survivor"]);

const groupedSortable = new Set(["date", "survivor", "category", "item", "price", ...groupable]);

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

  const categoryItems = Array.isArray(filters.categoryItems)
    ? [...new Set(filters.categoryItems.map(String))]
    : [];

  const survivors = Array.isArray(filters.survivors)
    ? [...new Set(filters.survivors.map(String))]
    : [];

  const categories = Array.isArray(filters.categories)
    ? [...new Set(filters.categories.map(String))]
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
      categories,
      survivors,
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

/*
 * Ordering for a true detail/raw report.
 *
 * IMPORTANT:
 * groupBy does NOT mean SQL GROUP BY when
 * summarise === false.
 *
 * It only controls the ordering of the
 * individual detail rows.
 */
function detailOrderSql(config) {
  const expressions = {
    date: "expense_date",
    category: "category",
    item: "item",
    survivor: "survivor",
  };

  const parts = [];

  /*
   * Explicit sorting selected by the user
   * takes priority.
   */
  for (const sort of config.sortColumns) {
    const expression = expressions[sort.column];

    if (!expression) continue;

    parts.push(reportSql.order(expression, sort.direction.toUpperCase()));
  }

  /*
   * When Group By is selected but Summarise
   * is OFF, groupBy means:
   *
   *   "keep every detail row, but arrange
   *    the rows by these dimensions."
   *
   * Add the group dimensions to the
   * ordering if the user did not already
   * explicitly sort by them.
   */
  for (const column of config.groupBy) {
    const expression = expressions[column];

    if (!expression) continue;

    const alreadySorted = config.sortColumns.some((sort) => sort.column === column);

    if (alreadySorted) continue;

    parts.push(reportSql.order(expression, "ASC"));
  }

  /*
   * Finally keep newest expenses first
   * inside each detail group.
   */
  parts.push("expense_date DESC", "id DESC");

  return parts.join(", ");
}

/*
 * Ordering for grouped summary reports.
 *
 * Here groupBy REALLY is SQL GROUP BY.
 */
function summaryOrderSql(config, usesSurvivor) {
  const expressions = {
    date: "expense_date",
    category: "category",
    item: "item",
    survivor: "survivor",
    price: usesSurvivor ? "SUM(report_amount)" : "SUM(total_cost)",
  };

  const parts = [];

  for (const sort of config.sortColumns) {
    if (!expressions[sort.column]) {
      continue;
    }

    let expression = expressions[sort.column];

    /*
     * A grouped dimension can be ordered
     * directly because it is present in
     * GROUP BY.
     *
     * Non-grouped dimensions need an
     * aggregate in a summary query.
     */
    if (sort.column !== "price" && !config.groupBy.includes(sort.column)) {
      expression = `MIN(${expression})`;
    }

    parts.push(reportSql.order(expression, sort.direction.toUpperCase()));
  }

  if (parts.length) {
    return parts.join(", ");
  }

  /*
   * Default summary ordering follows
   * the selected grouping dimensions.
   */
  return config.groupBy
    .map((column) => {
      const expression = expressions[column];

      return expression ? reportSql.order(expression, "ASC") : null;
    })
    .filter(Boolean)
    .join(", ");
}

function chartData(rows, groupBy) {
  return rows.map((row) => ({
    label: groupBy.map((column) => `${column}: ${row[column]}`).join(" • "),

    value: Number(row.total || 0),
  }));
}

export async function runReport(input) {
  const config = cleanConfig(input);

  const usesSurvivor = config.groupBy.includes("survivor");

  /*
   * Survivor grouping requires one row
   * per survivor share.
   *
   * Without survivor grouping we use one
   * row per expense.
   */
  const cte = usesSurvivor ? reportSql.sourcePerSurvivor : reportSql.sourcePerExpense;

  const params = [];

  const where = addFilter([], params, config.filters, "expense_source");

  /*
   * --------------------------------------------------
   * RAW DETAIL REPORT
   *
   * No Group By
   * No Summarise
   * --------------------------------------------------
   */

  if (!config.groupBy.length && !config.summarise) {
    const select = usesSurvivor ? reportSql.rawSelectPerSurvivor : reportSql.rawSelectPerExpense;

    const result = await q(reportSql.raw(cte, select, where, detailOrderSql(config)), params);

    const rows = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,

        total_cost: row.total_cost == null ? null : Number(row.total_cost),

        report_amount: row.report_amount == null ? null : Number(row.report_amount),

        proof_url: row.proof_key ? await signedObjectUrl(row.proof_key) : null,
      })),
    );

    return {
      mode: "raw",

      columns: [
        "expense_date",
        "category",
        "item",
        "survivor",
        "share_price",
        "comment",
        "proof_url",
      ],

      rows,

      total: (() => {
        const seen = new Set();

        return rows.reduce((sum, row) => {
          const expenseKey = row.expense_id ?? row.id;

          const totalCost = Number(row.total_cost);

          if (expenseKey != null && Number.isFinite(totalCost)) {
            if (seen.has(expenseKey)) {
              return sum;
            }

            seen.add(expenseKey);

            return sum + totalCost;
          }

          const sharePrice = Number(row.share_price);

          return Number.isFinite(sharePrice) ? sum + sharePrice : sum;
        }, 0);
      })(),

      chartData: [],
    };
  }

  /*
   * --------------------------------------------------
   * TOTAL SUMMARY
   *
   * No Group By
   * Summarise ON
   * --------------------------------------------------
   */

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

      chartData: [
        {
          label: "Total",
          value: total,
        },
      ],
    };
  }

  /*
   * --------------------------------------------------
   * GROUP BY + SUMMARISE OFF
   *
   * THIS IS A DETAIL REPORT.
   *
   * There is deliberately NO SQL GROUP BY.
   *
   * Every underlying row is returned.
   *
   * groupBy only controls the ordering.
   * --------------------------------------------------
   */

  if (!config.summarise) {
    const select = usesSurvivor ? reportSql.rawSelectPerSurvivor : reportSql.rawSelectPerExpense;

    const result = await q(reportSql.raw(cte, select, where, detailOrderSql(config)), params);

    const rows = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,

        total_cost: row.total_cost == null ? null : Number(row.total_cost),

        report_amount: row.report_amount == null ? null : Number(row.report_amount),

        proof_url: row.proof_key ? await signedObjectUrl(row.proof_key) : null,
      })),
    );

    return {
      mode: "grouped-raw",

      columns: [
        ...config.groupBy,
        "expense_date",
        "category",
        "item",
        "survivor",
        "share_price",
        "comment",
        "proof_url",
      ],

      groupBy: config.groupBy,

      rows,

      /*
       * Keep existing grouped-detail
       * behaviour: this is not a summary
       * total.
       */
      total: 0,

      chartData: [],
    };
  }

  /*
   * --------------------------------------------------
   * GROUP BY + SUMMARISE ON
   *
   * This remains a genuine aggregate query.
   * --------------------------------------------------
   */

  const groupSelect = config.groupBy.map(
    (column) => `${reportSql.groupExpr[column]} AS "${column}"`,
  );

  if (config.groupBy.includes("category")) {
    groupSelect.push("MIN(category_id) AS category_id");
  }

  if (config.groupBy.includes("survivor")) {
    groupSelect.push("MIN(survivor_id) AS survivor_id");
  }

  const amount = usesSurvivor ? "SUM(report_amount)" : "SUM(total_cost)";

  /*
   * Summary queries really do need GROUP BY.
   *
   * Use the actual group expressions,
   * never SELECT positions.
   */
  const groupBySql = config.groupBy.map((column) => reportSql.groupExpr[column]).join(", ");

  const result = await q(
    reportSql.grouped(
      cte,
      [...groupSelect, `${amount} AS total`].join(", "),
      where,
      groupBySql,
      summaryOrderSql(config, usesSurvivor),
    ),
    params,
  );

  const rows = result.rows.map((row) => ({
    ...row,

    total: Number(row.total || 0),
  }));

  return {
    mode: "summary",

    columns: [...config.groupBy, "total"],

    rows,

    total: rows.reduce((sum, row) => sum + row.total, 0),

    chartData: chartData(rows, config.groupBy),
  };
}

export { cleanConfig, deleteSelection, listSelections, saveSelection };
