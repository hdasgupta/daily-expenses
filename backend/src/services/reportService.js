import { q } from "../db/index.js";
import { deleteSelection, listSelections, saveSelection } from "../models/reportModel.js";
import { reportSql } from "../../scripts/sql/reportSql.js";

const groupable = new Set(Object.keys(reportSql.groupExpr));
const rawSortable = new Set(Object.keys(reportSql.rawSortExpr));

function cleanConfig(config = {}) {
  const filters = config.filters || {};
  const groupBy = Array.isArray(config.groupBy)
    ? config.groupBy.filter((value) => groupable.has(value))
    : [];
  const uniqueGroupBy = [...new Set(groupBy)];
  const allowedSort = uniqueGroupBy.length ? uniqueGroupBy : [...rawSortable];
  const sortColumns = (Array.isArray(config.sortColumns) ? config.sortColumns : [])
    .filter((entry) => allowedSort.includes(entry?.column))
    .map((entry) => ({
      column: entry.column,
      direction: entry.direction === "desc" ? "desc" : "asc",
    }))
    .filter((entry, index, all) => all.findIndex((item) => item.column === entry.column) === index);

  const categoryItems = Array.isArray(filters.categoryItems)
    ? [...new Set(filters.categoryItems.map(String))]
    : [];
  const survivors = Array.isArray(filters.survivors)
    ? [...new Set(filters.survivors.map(String))]
    : [];

  const dateFilterType = ["none", "date", "range", "month", "year"].includes(config.dateFilterType)
    ? config.dateFilterType
    : "none";

  return {
    dateFilterType,
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
    summarise: uniqueGroupBy.length > 0 || Boolean(config.summarise),
  };
}

function addFilter(where, params, config) {
  const { filters, dateFilterType } = config;
  const alias = "expense_source";

  if (dateFilterType === "date" && filters.date) {
    params.push(filters.date);
    where.push(reportSql.filterDate(alias, params.length));
  } else if (dateFilterType === "range") {
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      where.push(reportSql.filterFrom(alias, params.length));
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      where.push(reportSql.filterTo(alias, params.length));
    }
  } else if (dateFilterType === "month" && filters.month) {
    const monthDate = `${filters.month}-01`;
    params.push(monthDate);
    where.push(reportSql.filterMonthFrom(alias, params.length));
    params.push(monthDate);
    where.push(reportSql.filterMonthTo(alias, params.length));
  } else if (dateFilterType === "year" && filters.year) {
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
      params.push(Number(categoryId));
      const categoryIndex = params.length;
      if (kind === "item" && itemId) {
        params.push(Number(itemId));
        clauses.push(reportSql.filterCategoryItem(alias, categoryIndex, params.length));
      } else if (kind === "other") {
        clauses.push(reportSql.filterOther(alias, categoryIndex));
      } else {
        clauses.push(reportSql.filterTotal(alias, categoryIndex));
      }
    }
    if (clauses.length) where.push(reportSql.or(clauses));
  }

  if (filters.survivors.length) {
    params.push(filters.survivors.map((value) => Number(value)));
    where.push(reportSql.filterSurvivors(alias, params.length));
  }

  return reportSql.where(where);
}

function orderSql(config, grouped) {
  if (grouped) return reportSql.orderBySelectedGroup(config.groupBy, config.sortColumns);
  return reportSql.orderByRaw(config.sortColumns) || reportSql.defaultRawOrder;
}

function chartData(rows, groupBy) {
  return rows.map((row) => ({
    label: groupBy.map((column) => `${column}: ${row[column]}`).join(" • "),
    value: Number(row.total || 0),
  }));
}

function numericRow(row) {
  return {
    ...row,
    total_cost: row.total_cost == null ? null : Number(row.total_cost),
    report_amount: row.report_amount == null ? null : Number(row.report_amount),
    total: row.total == null ? null : Number(row.total),
  };
}

export async function runReport(input) {
  const config = cleanConfig(input);
  const usesSurvivor =
    config.groupBy.includes("survivor") ||
    config.sortColumns.some((entry) => entry.column === "survivor") ||
    config.filters.survivors.length > 0;
  const cte = usesSurvivor ? reportSql.sourcePerSurvivor : reportSql.sourcePerExpense;
  const params = [];
  const where = addFilter([], params, config);

  if (!config.groupBy.length && !config.summarise) {
    const select = usesSurvivor ? reportSql.rawSelectPerSurvivor : reportSql.rawSelectPerExpense;
    const result = await q(reportSql.raw(cte, select, where, orderSql(config, false)), params);
    const rows = result.rows.map(numericRow);
    const total = usesSurvivor
      ? rows.reduce((sum, row) => sum + Number(row.report_amount || 0), 0)
      : [...new Set(rows.map((row) => row.id))].reduce(
          (sum, id) => sum + Number(rows.find((row) => row.id === id)?.total_cost || 0),
          0,
        );
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
            "comment",
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
            "comment",
          ],
      rows,
      total,
      chartData: [],
    };
  }

  if (!config.groupBy.length && config.summarise) {
    const result = await q(
      reportSql.totalSummary(
        cte,
        usesSurvivor ? reportSql.amountPerSurvivor : reportSql.amountPerExpense,
        where,
      ),
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

  const rawSelect = usesSurvivor ? reportSql.rawSelectPerSurvivor : reportSql.rawSelectPerExpense;

  if (!config.summarise) {
    const select = reportSql.groupedRawSelect(config.groupBy, rawSelect);
    const result = await q(reportSql.raw(cte, select, where, orderSql(config, true)), params);
    const rows = result.rows.map(numericRow);
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
              "comment",
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
              "comment",
            ]),
      ],
      groupBy: config.groupBy,
      rows,
      total: 0,
      chartData: [],
    };
  }

  const amount = usesSurvivor ? reportSql.amountPerSurvivor : reportSql.amountPerExpense;
  const groupBySql = reportSql.groupBy(config.groupBy);
  const select = reportSql.groupedSelect(config.groupBy, amount);
  const result = await q(
    reportSql.grouped(cte, select, where, groupBySql, orderSql(config, true)),
    params,
  );
  const rows = result.rows.map(numericRow);
  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);

  return {
    mode: "summary",
    columns: [...config.groupBy, "total"],
    rows,
    total,
    chartData: chartData(rows, config.groupBy),
  };
}

export { cleanConfig, deleteSelection, listSelections, saveSelection };
