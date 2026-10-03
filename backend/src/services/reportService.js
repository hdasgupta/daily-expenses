import { q } from "../db/index.js";
import {
  deleteSelection,
  listSelections,
  saveSelection,
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

  const allowedSort = uniqueGroupBy.length
    ? groupedSortable
    : rawSortable;

  const sortColumns = (
    Array.isArray(config.sortColumns) ? config.sortColumns : []
  )
    .filter((x) => allowedSort.has(x?.column))
    .map((x) => ({
      column: x.column,
      direction: x.direction === "desc" ? "desc" : "asc",
    }))
    .filter(
      (x, i, a) =>
        a.findIndex((y) => y.column === x.column) === i,
    );

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
    dateFilterType: [
      "none",
      "date",
      "range",
      "month",
      "year",
    ].includes(config.dateFilterType)
      ? config.dateFilterType
      : "none",

    filters: {
      date: filters.date || "",
      dateFrom: filters.dateFrom || "",
      dateTo: filters.dateTo || "",
      month: filters.month || "",
      year: filters.year || "",
      hasProof: ["true", "false"].includes(filters.hasProof)
        ? filters.hasProof
        : "",
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

    where.push(
      reportSql.filterMonthFrom(alias, params.length),
    );

    where.push(
      reportSql.filterMonthTo(alias, params.length),
    );
  } else if (filters.year) {
    params.push(Number(filters.year));
    where.push(reportSql.filterYear(alias, params.length));
  }

  if (filters.hasProof) {
    where.push(
      reportSql.filterProof(
        alias,
        filters.hasProof === "true",
      ),
    );
  }

  if (filters.categoryItems.length) {
    const clauses = [];

    for (const key of filters.categoryItems) {
      const [categoryId, kind, itemId] = String(key).split(
        ":",
      );

      params.push(categoryId);
      const categoryIndex = params.length;

      if (kind === "item") {
        params.push(itemId);

        clauses.push(
          reportSql.filterCategoryItem(
            alias,
            categoryIndex,
            params.length,
          ),
        );
      } else if (kind === "other") {
        clauses.push(
          reportSql.filterOther(
            alias,
            categoryIndex,
          ),
        );
      } else {
        clauses.push(
          reportSql.filterTotal(
            alias,
            categoryIndex,
          ),
        );
      }
    }

    where.push(reportSql.or(clauses));
  }

  if (filters.categories.length) {
    params.push(filters.categories);

    where.push(
      reportSql.filterCategories(
        alias,
        params.length,
      ),
    );
  }

  if (filters.survivors.length) {
    params.push(filters.survivors);

    where.push(
      reportSql.filterSurvivors(
        alias,
        params.length,
      ),
    );
  }

  return reportSql.where(where);
}

function orderSql(config, forGroup, summarise = false) {
  const rawExpressions = {
    date: "expense_date",
    category: "category",
    item: "item",
    survivor: "survivor",
  };

  const expressions = forGroup
    ? {
        ...reportSql.groupExpr,
        ...rawExpressions,
        price: summarise
          ? "SUM(report_amount)"
          : "report_amount",
      }
    : rawExpressions;

  const chosen = config.sortColumns.length
    ? config.sortColumns
    : [];

  const parts = chosen
    .filter((x) => expressions[x.column])
    .map((x) => {
      let expression = expressions[x.column];

      /*
       * In a grouped summary, only selected groupBy dimensions
       * are legal as plain ORDER BY expressions. Any other
       * dimension must be aggregated.
       *
       * This prevents PostgreSQL errors such as:
       *   column "expense_source.survivor" must appear in the
       *   GROUP BY clause or be used in an aggregate function
       */
      if (
        forGroup &&
        summarise &&
        !config.groupBy.includes(x.column) &&
        x.column !== "price"
      ) {
        expression = `MIN(${expression})`;
      }

      return reportSql.order(
        expression,
        x.direction.toUpperCase(),
      );
    });

  if (parts.length) {
    return parts.join(", ");
  }

  if (!forGroup) {
    return reportSql.defaultRawOrder;
  }

  return config.groupBy
    .map((x) => reportSql.groupExpr[x])
    .join(", ");
}

function chartData(rows, groupBy) {
  return rows.map((row) => ({
    label: groupBy
      .map(
        (column) =>
          `${column}: ${row[column]}`,
      )
      .join(" • "),

    value: Number(row.total || 0),
  }));
}

export async function runReport(input) {
  const config = cleanConfig(input);

  /*
   * Expense-based reports use one row per expense so totals
   * include every expense exactly once.
   *
   * Survivor reports intentionally use share rows because
   * their totals are survivor-specific.
   */
  const usesSurvivor =
    config.groupBy.includes("survivor");

  const cte = usesSurvivor
    ? reportSql.sourcePerSurvivor
    : reportSql.sourcePerExpense;

  const params = [];
  const where = addFilter(
    [],
    params,
    config.filters,
    "expense_source",
  );

  /*
   * Raw report without grouping.
   */
  if (!config.groupBy.length && !config.summarise) {
    const select = usesSurvivor
      ? reportSql.rawSelectPerSurvivor
      : reportSql.rawSelectPerExpense;

    const result = await q(
      reportSql.raw(
        cte,
        select,
        where,
        orderSql(config, false),
      ),
      params,
    );

    const rows = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,

        total_cost:
          row.total_cost == null
            ? null
            : Number(row.total_cost),

        report_amount:
          row.report_amount == null
            ? null
            : Number(row.report_amount),

        proof_url: row.proof_key
          ? await signedObjectUrl(row.proof_key)
          : null,
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
          const expenseKey =
            row.expense_id ?? row.id;

          const totalCost = Number(
            row.total_cost,
          );

          if (
            expenseKey != null &&
            Number.isFinite(totalCost)
          ) {
            if (seen.has(expenseKey)) {
              return sum;
            }

            seen.add(expenseKey);
            return sum + totalCost;
          }

          const sharePrice = Number(
            row.share_price,
          );

          return Number.isFinite(sharePrice)
            ? sum + sharePrice
            : sum;
        }, 0);
      })(),

      chartData: [],
    };
  }

  /*
   * Total summary without grouping.
   */
  if (!config.groupBy.length && config.summarise) {
    const result = await q(
      reportSql.totalSummary(
        cte,
        usesSurvivor
          ? "SUM(report_amount)"
          : "SUM(total_cost)",
        where,
      ),
      params,
    );

    const total = Number(
      result.rows[0]?.total || 0,
    );

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
   * Build the selected grouping columns.
   *
   * Every expression placed here is also passed to GROUP BY
   * for grouped summaries.
   */
  const groupSelect = config.groupBy.map(
    (column) =>
      `${reportSql.groupExpr[column]} AS "${column}"`,
  );

  if (config.groupBy.includes("category")) {
    groupSelect.push(
      "MIN(category_id) AS category_id",
    );
  }

  if (config.groupBy.includes("survivor")) {
    groupSelect.push(
      "MIN(survivor_id) AS survivor_id",
    );
  }

  /*
   * Grouped raw report.
   *
   * This intentionally does not use SQL GROUP BY. The
   * groupBy values are returned together with the matching
   * raw rows. Applying GROUP BY here would make PostgreSQL
   * reject raw columns such as survivor, category, item,
   * comment, etc.
   */
  if (!config.summarise) {
    const rawSelect = usesSurvivor
      ? reportSql.rawSelectPerSurvivor
      : reportSql.rawSelectPerExpense;

    const select = [
      ...groupSelect,
      rawSelect,
    ].join(", ");

    const result = await q(
      reportSql.raw(
        cte,
        select,
        where,
        orderSql(
          config,
          true,
          false,
        ),
      ),
      params,
    );

    const rows = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,

        total_cost:
          row.total_cost == null
            ? null
            : Number(row.total_cost),

        report_amount:
          row.report_amount == null
            ? null
            : Number(row.report_amount),

        proof_url: row.proof_key
          ? await signedObjectUrl(row.proof_key)
          : null,
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

      total: 0,

      chartData: [],
    };
  }

  /*
   * Grouped summary.
   *
   * The important part of this query is that GROUP BY contains
   * exactly the same expressions used for the selected
   * groupBy dimensions.
   */
  const amount = usesSurvivor
    ? "SUM(report_amount)"
    : "SUM(total_cost)";

  const groupBySql = config.groupBy
    .map(
      (column) =>
        reportSql.groupExpr[column],
    )
    .join(", ");

  const result = await q(
    reportSql.grouped(
      cte,
      [
        ...groupSelect,
        `${amount} AS total`,
      ].join(", "),
      where,
      groupBySql,
      orderSql(
        config,
        true,
        true,
      ),
    ),
    params,
  );

  const rows = result.rows.map(
    (row) => ({
      ...row,
      total: Number(row.total || 0),
    }),
  );

  return {
    mode: "summary",

    columns: [
      ...config.groupBy,
      "total",
    ],

    rows,

    total: rows.reduce(
      (sum, row) =>
        sum + row.total,
      0,
    ),

    chartData: chartData(
      rows,
      config.groupBy,
    ),
  };
}

export {
  cleanConfig,
  deleteSelection,
  listSelections,
  saveSelection,
};
