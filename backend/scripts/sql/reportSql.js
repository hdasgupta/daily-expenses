const SOURCE_PER_SURVIVOR = `expense_source AS (
  SELECT
    e.id,
    e.expense_date,
    e.category_id,
    e.item_id,
    e.other_item,
    e.total_cost,
    e.expense_type,
    e.comment,
    (e.proof_key IS NOT NULL) AS has_proof,
    c.name AS category,
    COALESCE(i.name, e.other_item, 'Total') AS item,
    s.id AS survivor_id,
    s.full_name AS survivor,
    es.amount AS report_amount,
    ARRAY[s.id]::bigint[] AS survivor_ids
  FROM expenses e
  JOIN categories c ON c.id = e.category_id
  LEFT JOIN items i ON i.id = e.item_id
  JOIN expense_shares es ON es.expense_id = e.id
  JOIN survivors s ON s.id = es.survivor_id
)`;

const SOURCE_PER_EXPENSE = `expense_source AS (
  SELECT
    e.id,
    e.expense_date,
    e.category_id,
    e.item_id,
    e.other_item,
    e.total_cost,
    e.expense_type,
    e.comment,
    (e.proof_key IS NOT NULL) AS has_proof,
    c.name AS category,
    COALESCE(i.name, e.other_item, 'Total') AS item,
    string_agg(DISTINCT s.full_name, ', ' ORDER BY s.full_name) AS survivor,
    COALESCE(ARRAY_AGG(DISTINCT s.id) FILTER (WHERE s.id IS NOT NULL), ARRAY[]::bigint[]) AS survivor_ids,
    NULL::bigint AS survivor_id,
    NULL::numeric AS report_amount
  FROM expenses e
  JOIN categories c ON c.id = e.category_id
  LEFT JOIN items i ON i.id = e.item_id
  LEFT JOIN expense_shares es ON es.expense_id = e.id
  LEFT JOIN survivors s ON s.id = es.survivor_id
  GROUP BY e.id, c.name, i.name
)`;

const RAW_SELECT_PER_SURVIVOR = `id, expense_date, category, item, survivor, report_amount, expense_type, has_proof, comment`;
const RAW_SELECT_PER_EXPENSE = `id, expense_date, category, item, survivor, total_cost, expense_type, has_proof, comment`;

const GROUP_EXPRESSION = Object.freeze({
  date: "expense_date",
  week: "date_trunc('week', expense_date)::date",
  month: "date_trunc('month', expense_date)::date",
  year: "extract(year from expense_date)::int",
  category: "category",
  item: "item",
  survivor: "survivor",
});

const RAW_SORT_EXPRESSION = Object.freeze({
  date: "expense_date",
  category: "category",
  item: "item",
  survivor: "survivor",
});

function makeWhere(clauses) {
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function makeOrder(expression, direction) {
  return `${expression} ${String(direction).toLowerCase() === "desc" ? "DESC" : "ASC"}`;
}

function makeRawQuery(cte, select, where, orderBy) {
  return `WITH ${cte}
SELECT ${select}
FROM expense_source
${where}
ORDER BY ${orderBy}
LIMIT 5000`;
}

function makeTotalQuery(cte, amountExpression, where) {
  return `WITH ${cte}
SELECT ${amountExpression} AS total
FROM expense_source
${where}`;
}

function makeGroupedSummaryQuery(cte, select, where, groupBy, orderBy) {
  return `WITH ${cte}
SELECT ${select}
FROM expense_source
${where}
GROUP BY ${groupBy}
ORDER BY ${orderBy}
LIMIT 5000`;
}

export const reportSql = {
  sourcePerSurvivor: SOURCE_PER_SURVIVOR,
  sourcePerExpense: SOURCE_PER_EXPENSE,
  rawSelectPerSurvivor: RAW_SELECT_PER_SURVIVOR,
  rawSelectPerExpense: RAW_SELECT_PER_EXPENSE,
  groupExpr: GROUP_EXPRESSION,
  rawSortExpr: RAW_SORT_EXPRESSION,
  where: makeWhere,
  or: (clauses) => `(${clauses.join(" OR ")})`,
  raw: makeRawQuery,
  totalSummary: makeTotalQuery,
  grouped: makeGroupedSummaryQuery,
  filterDate: (alias, index) => `${alias}.expense_date = $${index}`,
  filterFrom: (alias, index) => `${alias}.expense_date >= $${index}`,
  filterTo: (alias, index) => `${alias}.expense_date <= $${index}`,
  filterMonthFrom: (alias, index) =>
    `${alias}.expense_date >= date_trunc('month', $${index}::date)`,
  filterMonthTo: (alias, index) =>
    `${alias}.expense_date < date_trunc('month', $${index}::date) + interval '1 month'`,
  filterYear: (alias, index) => `extract(year from ${alias}.expense_date) = $${index}`,
  filterProof: (alias, value) => `${alias}.has_proof = ${value ? "TRUE" : "FALSE"}`,
  filterCategoryItem: (alias, categoryIndex, itemIndex) =>
    `(${alias}.category_id = $${categoryIndex} AND ${alias}.item_id = $${itemIndex})`,
  filterOther: (alias, categoryIndex) =>
    `(${alias}.category_id = $${categoryIndex} AND ${alias}.item_id IS NULL AND ${alias}.other_item IS NOT NULL)`,
  filterTotal: (alias, categoryIndex) =>
    `(${alias}.category_id = $${categoryIndex} AND ${alias}.item_id IS NULL AND ${alias}.other_item IS NULL)`,
  filterSurvivors: (alias, index) => `${alias}.survivor_ids && $${index}::bigint[]`,
  amountPerSurvivor: "SUM(report_amount)",
  amountPerExpense: "SUM(total_cost)",
  groupedSelect: (groupBy, amountExpression) =>
    [
      ...groupBy.map((column) => `${GROUP_EXPRESSION[column]} AS "${column}"`),
      `${amountExpression} AS total`,
    ].join(", "),
  groupedRawSelect: (groupBy, rawSelect) =>
    [...groupBy.map((column) => `${GROUP_EXPRESSION[column]} AS "${column}"`), rawSelect].join(
      ", ",
    ),
  groupBy: (columns) => columns.map((column) => GROUP_EXPRESSION[column]).join(", "),
  defaultRawOrder: "expense_date DESC, id DESC",
  orderByGroup: (groupBy) => groupBy.map((column) => GROUP_EXPRESSION[column]).join(", "),
  orderByRaw: (sortColumns) =>
    sortColumns
      .map((entry) => makeOrder(RAW_SORT_EXPRESSION[entry.column], entry.direction))
      .join(", "),
  orderBySelectedGroup: (groupBy, sortColumns) => {
    const selected = sortColumns
      .filter((entry) => groupBy.includes(entry.column))
      .map((entry) => makeOrder(GROUP_EXPRESSION[entry.column], entry.direction));
    return selected.length
      ? selected.join(", ")
      : groupBy.map((column) => GROUP_EXPRESSION[column]).join(", ");
  },
  order: makeOrder,
};
