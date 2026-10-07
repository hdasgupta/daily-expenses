export const reportSql = {
  sourcePerSurvivor: `expense_source AS (
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
      e.proof_key,
      c.name AS category,
      COALESCE(i.name, e.other_item, 'Total') AS item,
      s.id AS survivor_id,
      COALESCE(s.full_name, 'Unassigned') AS survivor,
      COALESCE(NULLIF(es.amount, 0), e.total_cost) AS report_amount,
      CASE
        WHEN s.id IS NULL
        THEN ARRAY[]::bigint[]
        ELSE ARRAY[s.id]::bigint[]
      END AS survivor_ids
    FROM public.expenses e
    JOIN public.categories c
      ON c.id = e.category_id
    LEFT JOIN public.items i
      ON i.id = e.item_id
    LEFT JOIN public.expense_shares es
      ON es.expense_id = e.id
    LEFT JOIN public.survivors s
      ON s.id = es.survivor_id
  )`,

  sourcePerExpense: `expense_source AS (
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
      e.proof_key,
      c.name AS category,
      COALESCE(i.name, e.other_item, 'Total') AS item,
      string_agg(
        DISTINCT s.full_name,
        ', '
        ORDER BY s.full_name
      ) AS survivor,
      ARRAY_AGG(
        DISTINCT s.id
      ) FILTER (
        WHERE s.id IS NOT NULL
      )::bigint[] AS survivor_ids,
      NULL::bigint AS survivor_id,
      NULL::numeric AS report_amount
    FROM public.expenses e
    JOIN public.categories c
      ON c.id = e.category_id
    LEFT JOIN public.items i
      ON i.id = e.item_id
    LEFT JOIN public.expense_shares es
      ON es.expense_id = e.id
    LEFT JOIN public.survivors s
      ON s.id = es.survivor_id
    GROUP BY
      e.id,
      c.name,
      i.name
  )`,

  rawSelectPerSurvivor:
    "id AS expense_id, expense_date, category, item, survivor, report_amount AS share_price, total_cost, comment, proof_key",

  rawSelectPerExpense: "expense_date, category, item, survivor, total_cost, comment, proof_key",

  raw: (cte, select, where, orderSql) =>
    `WITH ${cte}
     SELECT ${select}
     FROM expense_source
     ${where}
     ORDER BY ${orderSql}
     LIMIT 5000`,

  where: (clauses) => (clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""),

  or: (clauses) => `(${clauses.join(" OR ")})`,

  totalSummary: (cte, amount, where) =>
    `WITH ${cte}
     SELECT ${amount} AS total
     FROM expense_source
     ${where}`,

  grouped: (cte, select, where, groupBy, orderSql) =>
    `WITH ${cte}
     SELECT ${select}
     FROM expense_source
     ${where}
     GROUP BY ${groupBy}
     ${orderSql ? `ORDER BY ${orderSql}` : ""}
     LIMIT 5000`,

  filterDate: (alias, index) => `${alias}.expense_date = $${index}`,

  filterFrom: (alias, index) => `${alias}.expense_date >= $${index}`,

  filterTo: (alias, index) => `${alias}.expense_date <= $${index}`,

  filterMonthFrom: (alias, index) =>
    `${alias}.expense_date >= date_trunc('month', $${index}::date)`,

  filterMonthTo: (alias, index) =>
    `${alias}.expense_date < date_trunc('month', $${index}::date) + interval '1 month'`,

  filterYear: (alias, index) => `extract(year from ${alias}.expense_date) = $${index}`,

  filterProof: (alias, value) => `${alias}.has_proof = ${value}`,

  filterCategoryItem: (alias, categoryIndex, itemIndex) =>
    `(
      ${alias}.category_id = $${categoryIndex}
      AND ${alias}.item_id = $${itemIndex}
    )`,

  filterOther: (alias, categoryIndex) =>
    `(
      ${alias}.category_id = $${categoryIndex}
      AND ${alias}.item_id IS NULL
      AND ${alias}.other_item IS NOT NULL
    )`,

  filterTotal: (alias, categoryIndex) =>
    `(
      ${alias}.category_id = $${categoryIndex}
      AND ${alias}.item_id IS NULL
      AND ${alias}.other_item IS NULL
    )`,

  filterSurvivors: (alias, index) => `${alias}.survivor_ids && $${index}::bigint[]`,

  filterCategories: (alias, index) => `${alias}.category_id = ANY($${index}::bigint[])`,

  order: (expr, dir) => `${expr} ${dir}`,

  defaultRawOrder: "expense_date DESC, id DESC",

  groupExpr: {
    date: "expense_date",

    week: "date_trunc('week', expense_date)::date",

    month: "date_trunc('month', expense_date)::date",

    year: "extract(year from expense_date)::int",

    category: "category",

    item: "item",

    survivor: "survivor",
  },
};
