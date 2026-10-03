import { q } from "../db/index.js";
import {
  deleteSelection,
  listSelections,
  saveSelection,
} from "../models/reportModel.js";
import { reportSql } from "../../scripts/sql/reportSql.js";
import { signedObjectUrl } from "./storageService.js";

const groupable = new Set(Object.keys(reportSql.groupExpr));

const rawSortable = new Set([
  "date",
  "category",
  "item",
  "survivor",
]);

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
    ? config.groupBy.filter((x) =>
        groupable.has(x),
      )
    : [];

  const uniqueGroupBy = [
    ...new Set(groupBy),
  ];

  const allowedSort = uniqueGroupBy.length
    ? groupedSortable
    : rawSortable;

  const sortColumns = (
    Array.isArray(config.sortColumns)
      ? config.sortColumns
      : []
  )
    .filter((x) =>
      allowedSort.has(x?.column),
    )
    .map((x) => ({
      column: x.column,
      direction:
        x.direction === "desc"
          ? "desc"
          : "asc",
    }))
    .filter(
      (x, i, a) =>
        a.findIndex(
          (y) =>
            y.column === x.column,
        ) === i,
    );

  const categoryItems =
    Array.isArray(filters.categoryItems)
      ? [
          ...new Set(
            filters.categoryItems.map(
              String,
            ),
          ),
        ]
      : [];

  const survivors =
    Array.isArray(filters.survivors)
      ? [
          ...new Set(
            filters.survivors.map(String),
          ),
        ]
      : [];

  const categories =
    Array.isArray(filters.categories)
      ? [
          ...new Set(
            filters.categories.map(String),
          ),
        ]
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

      hasProof: [
        "true",
        "false",
      ].includes(filters.hasProof)
        ? filters.hasProof
        : "",

      categoryItems,
      categories,
      survivors,
    },

    sortColumns,
    groupBy: uniqueGroupBy,
    summarise: Boolean(
      config.summarise,
    ),
  };
}

function addFilter(
  where,
  params,
  filters,
  alias,
) {
  if (filters.date) {
    params.push(filters.date);

    where.push(
      reportSql.filterDate(
        alias,
        params.length,
      ),
    );
  } else if (
    filters.dateFrom ||
    filters.dateTo
  ) {
    if (filters.dateFrom) {
      params.push(filters.dateFrom);

      where.push(
        reportSql.filterFrom(
          alias,
          params.length,
        ),
      );
    }

    if (filters.dateTo) {
      params.push(filters.dateTo);

      where.push(
        reportSql.filterTo(
          alias,
          params.length,
        ),
      );
    }
  } else if (filters.month) {
    params.push(
      `${filters.month}-01`,
    );

    where.push(
      reportSql.filterMonthFrom(
        alias,
        params.length,
      ),
    );

    where.push(
      reportSql.filterMonthTo(
        alias,
        params.length,
      ),
    );
  } else if (filters.year) {
    params.push(
      Number(filters.year),
    );

    where.push(
      reportSql.filterYear(
        alias,
        params.length,
      ),
    );
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
      const [
        categoryId,
        kind,
        itemId,
      ] = String(key).split(":");

      params.push(categoryId);

      const categoryIndex =
        params.length;

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

    where.push(
      reportSql.or(clauses),
    );
  }

  if (filters.categories.length) {
    params.push(
      filters.categories,
    );

    where.push(
      reportSql.filterCategories(
        alias,
        params.length,
      ),
    );
  }

  if (filters.survivors.length) {
    params.push(
      filters.survivors,
    );

    where.push(
      reportSql.filterSurvivors(
        alias,
        params.length,
      ),
    );
  }

  return reportSql.where(where);
}

function orderSql(
  config,
  forGroup,
  summarise = false,
) {
  const rawExpressions = {
    date: "expense_date",
    category: "category",
    item: "item",
    survivor: "survivor",
  };

  if (!forGroup) {
    const chosen =
      config.sortColumns.length
        ? config.sortColumns
        : [];

    const parts = chosen
      .filter(
        (x) =>
          rawExpressions[x.column],
      )
      .map((x) =>
        reportSql.order(
          rawExpressions[x.column],
          x.direction.toUpperCase(),
        ),
      );

    return parts.length
      ? parts.join(", ")
      : reportSql.defaultRawOrder;
  }

  const groupPositions = new Map(
    config.groupBy.map(
      (column, index) => [
        column,
        index + 1,
      ],
    ),
  );

  const chosen =
    config.sortColumns.length
      ? config.sortColumns
      : [];

  const parts = [];

  for (const sort of chosen) {
    if (
      groupPositions.has(
        sort.column,
      )
    ) {
      parts.push(
        reportSql.order(
          String(
            groupPositions.get(
              sort.column,
            ),
          ),
          sort.direction.toUpperCase(),
        ),
      );

      continue;
    }

    if (summarise) {
      if (sort.column === "price") {
        parts.push(
          reportSql.order(
            "SUM(report_amount)",
            sort.direction.toUpperCase(),
          ),
        );

        continue;
      }

      const expression =
        rawExpressions[
          sort.column
        ] ||
        reportSql.groupExpr[
          sort.column
        ];

      if (expression) {
        parts.push(
          reportSql.order(
            `MIN(${expression})`,
            sort.direction.toUpperCase(),
          ),
        );
      }
    }
  }

  if (parts.length) {
    return parts.join(", ");
  }

  if (config.groupBy.length) {
    return config.groupBy
      .map(
        (_, index) =>
          `${index + 1} ASC`,
      )
      .join(", ");
  }

  return "";
}

function chartData(
  rows,
  groupBy,
) {
  return rows.map((row) => ({
    label: groupBy
      .map(
        (column) =>
          `${column}: ${row[column]}`,
      )
      .join(" • "),

    value: Number(
      row.total || 0,
    ),
  }));
}

function buildGroupedRawSelect(
  groupBy,
  usesSurvivor,
) {
  const select = [];

  /*
   * Every group dimension is represented
   * by the SELECT position used by the
   * positional GROUP BY.
   */
  for (const column of groupBy) {
    /*
     * Survivor is special because the
     * survivor name is not itself the
     * safest grouping key.
     *
     * The source has one row per survivor,
     * so MIN(survivor) is safe after grouping.
     */
    if (column === "survivor") {
      select.push(
        "MIN(survivor) AS \"survivor\"",
      );
    } else {
      select.push(
        `${reportSql.groupExpr[column]} AS "${column}"`,
      );
    }
  }

  if (groupBy.includes("category")) {
    select.push(
      "MIN(category_id) AS category_id",
    );
  }

  if (groupBy.includes("survivor")) {
    select.push(
      "MIN(survivor_id) AS survivor_id",
    );
  }

  /*
   * These are representative values for
   * the grouped-raw result.
   *
   * MIN keeps PostgreSQL happy while
   * preserving the existing response shape.
   */
  if (!groupBy.includes("date")) {
    select.push(
      "MIN(expense_date) AS expense_date",
    );
  }

  if (!groupBy.includes("category")) {
    select.push(
      "MIN(category) AS category",
    );
  }

  if (!groupBy.includes("item")) {
    select.push(
      "MIN(item) AS item",
    );
  }

  if (!groupBy.includes("survivor")) {
    select.push(
      "MIN(survivor) AS survivor",
    );
  }

  if (usesSurvivor) {
    select.push(
      "SUM(report_amount) AS share_price",
    );
  } else {
    select.push(
      "SUM(total_cost) AS total_cost",
    );
  }

  select.push(
    "MIN(comment) AS comment",
    "MIN(proof_key) AS proof_key",
  );

  return select;
}

export async function runReport(
  input,
) {
  const config = cleanConfig(input);

  const usesSurvivor =
    config.groupBy.includes(
      "survivor",
    );

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
   * --------------------------------------------------
   * RAW REPORT
   * --------------------------------------------------
   */

  if (
    !config.groupBy.length &&
    !config.summarise
  ) {
    const select =
      usesSurvivor
        ? reportSql.rawSelectPerSurvivor
        : reportSql.rawSelectPerExpense;

    const result = await q(
      reportSql.raw(
        cte,
        select,
        where,
        orderSql(
          config,
          false,
        ),
      ),
      params,
    );

    const rows =
      await Promise.all(
        result.rows.map(
          async (row) => ({
            ...row,

            total_cost:
              row.total_cost ==
              null
                ? null
                : Number(
                    row.total_cost,
                  ),

            report_amount:
              row.report_amount ==
              null
                ? null
                : Number(
                    row.report_amount,
                  ),

            proof_url:
              row.proof_key
                ? await signedObjectUrl(
                    row.proof_key,
                  )
                : null,
          }),
        ),
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
        const seen =
          new Set();

        return rows.reduce(
          (sum, row) => {
            const expenseKey =
              row.expense_id ??
              row.id;

            const totalCost =
              Number(
                row.total_cost,
              );

            if (
              expenseKey !=
                null &&
              Number.isFinite(
                totalCost,
              )
            ) {
              if (
                seen.has(
                  expenseKey,
                )
              ) {
                return sum;
              }

              seen.add(
                expenseKey,
              );

              return (
                sum + totalCost
              );
            }

            const sharePrice =
              Number(
                row.share_price,
              );

            return Number.isFinite(
              sharePrice,
            )
              ? sum + sharePrice
              : sum;
          },
          0,
        );
      })(),

      chartData: [],
    };
  }

  /*
   * --------------------------------------------------
   * TOTAL SUMMARY
   * --------------------------------------------------
   */

  if (
    !config.groupBy.length &&
    config.summarise
  ) {
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
   * --------------------------------------------------
   * GROUPED REPORT
   * --------------------------------------------------
   */

  if (!config.groupBy.length) {
    return {
      mode: "raw",
      columns: [],
      rows: [],
      total: 0,
      chartData: [],
    };
  }

  /*
   * --------------------------------------------------
   * GROUPED RAW
   *
   * This is the important fix.
   *
   * Previously this branch selected:
   *
   *   rawSelectPerSurvivor
   *
   * which contains raw `survivor`,
   * `expense_date`, etc.
   *
   * PostgreSQL therefore required all of
   * those columns in GROUP BY.
   *
   * We now aggregate the representative
   * fields with MIN/SUM.
   * --------------------------------------------------
   */

  if (!config.summarise) {
    const groupSelect =
      buildGroupedRawSelect(
        config.groupBy,
        usesSurvivor,
      );

    const groupByPositions =
      config.groupBy
        .map(
          (_, index) =>
            String(index + 1),
        )
        .join(", ");

    const result = await q(
      reportSql.grouped(
        cte,
        groupSelect.join(", "),
        where,
        groupByPositions,
        orderSql(
          config,
          true,
          false,
        ),
      ),
      params,
    );

    const rows =
      await Promise.all(
        result.rows.map(
          async (row) => ({
            ...row,

            total_cost:
              row.total_cost ==
              null
                ? null
                : Number(
                    row.total_cost,
                  ),

            share_price:
              row.share_price ==
              null
                ? null
                : Number(
                    row.share_price,
                  ),

            proof_url:
              row.proof_key
                ? await signedObjectUrl(
                    row.proof_key,
                  )
                : null,
          }),
        ),
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

      groupBy:
        config.groupBy,

      rows,

      total: 0,

      chartData: [],
    };
  }

  /*
   * --------------------------------------------------
   * GROUPED SUMMARY
   * --------------------------------------------------
   */

  const amount =
    usesSurvivor
      ? "SUM(report_amount)"
      : "SUM(total_cost)";

  const groupSelect =
    config.groupBy.map(
      (column) =>
        `${reportSql.groupExpr[column]} AS "${column}"`,
    );

  if (
    config.groupBy.includes(
      "category",
    )
  ) {
    groupSelect.push(
      "MIN(category_id) AS category_id",
    );
  }

  if (
    config.groupBy.includes(
      "survivor",
    )
  ) {
    groupSelect.push(
      "MIN(survivor_id) AS survivor_id",
    );
  }

  const groupBySql =
    config.groupBy
      .map(
        (_, index) =>
          String(index + 1),
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

  const rows =
    result.rows.map(
      (row) => ({
        ...row,

        total: Number(
          row.total || 0,
        ),
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
