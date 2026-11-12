export const reportSql = {
  /*
   * Per-survivor source used when Group By is applied so survivor-level
   * groupings and summaries reflect each survivor's resolved share amount.
   */
  sourcePerSurvivor: `expense_source AS (
    SELECT
      e.id,
      e.expense_date,
      e.category_id,
      e.item_id,
      e.other_item,
      e.quantity,
      e.unit_id,
      e.total_cost,
      e.expense_type,
      e.comment,
      (e.proof_key IS NOT NULL) AS has_proof,
      e.proof_key,
      c.name AS category,
      COALESCE(i.name, e.other_item, 'Total') AS item,
      u.name AS unit,
      es.survivor_id,
      COALESCE(s.full_name, 'Unassigned') AS survivor,
      COALESCE(es.amount, e.total_cost) AS report_amount,
      CASE
        WHEN es.survivor_id IS NULL THEN ARRAY[]::bigint[]
        ELSE ARRAY[es.survivor_id]::bigint[]
      END AS survivor_ids,
      COALESCE(es.share_type, 'remaining') AS share_type
    FROM public.expenses e
    JOIN public.categories c
      ON c.id = e.category_id
    LEFT JOIN public.items i
      ON i.id = e.item_id
    LEFT JOIN public.units u
      ON u.id = e.unit_id
    LEFT JOIN public.expense_shares es
      ON es.expense_id = e.id
    LEFT JOIN public.survivors s
      ON s.id = es.survivor_id
  )`,

  /*
   * Per-expense source used for raw reports when no Group By is applied.
   * Keeps each expense as a single unsplit row with all survivor shares
   * formatted on separate lines in the share column.
   */
  sourcePerExpense: `expense_source AS (
    SELECT
      e.id,
      e.expense_date,
      e.category_id,
      e.item_id,
      e.other_item,
      e.quantity,
      e.unit_id,
      e.total_cost,
      e.expense_type,
      e.comment,
      (e.proof_key IS NOT NULL) AS has_proof,
      e.proof_key,
      c.name AS category,
      COALESCE(i.name, e.other_item, 'Total') AS item,
      u.name AS unit,
      COALESCE(
        STRING_AGG(s.full_name, ', ' ORDER BY s.full_name),
        'Unassigned'
      ) AS survivor,
      COALESCE(
        STRING_AGG(
          CONCAT(
            s.full_name,
            ': ₹',
            TO_CHAR(es.amount, 'FM9999999990.00'),
            CASE
              WHEN e.total_cost > 0 THEN CONCAT(' (', TO_CHAR((es.amount / e.total_cost) * 100, 'FM999999990.00'), '%)')
              ELSE ''
            END
          ),
          E'\n'
          ORDER BY s.full_name
        ) FILTER (WHERE s.id IS NOT NULL),
        'No survivor share recorded'
      ) AS share,
      e.total_cost AS report_amount,
      COALESCE(
        ARRAY_AGG(es.survivor_id ORDER BY s.full_name) FILTER (WHERE es.survivor_id IS NOT NULL),
        ARRAY[]::bigint[]
      ) AS survivor_ids
    FROM public.expenses e
    JOIN public.categories c
      ON c.id = e.category_id
    LEFT JOIN public.items i
      ON i.id = e.item_id
    LEFT JOIN public.units u
      ON u.id = e.unit_id
    LEFT JOIN public.expense_shares es
      ON es.expense_id = e.id
    LEFT JOIN public.survivors s
      ON s.id = es.survivor_id
    GROUP BY e.id, c.name, i.name, u.name
  )`,

  rawSelectPerSurvivor: `
    id AS expense_id,
    expense_date,
    category,
    item,
    quantity,
    unit,
    CONCAT(survivor, ': ₹', TO_CHAR(report_amount, 'FM9999999990.00')) AS share,
    report_amount AS expense_amount,
    comment,
    proof_key
  `,

  rawSelectPerExpense: `
    id AS expense_id,
    expense_date,
    category,
    item,
    quantity,
    unit,
    share,
    report_amount AS expense_amount,
    comment,
    proof_key
  `,

  raw: (cte, select, where, orderSql) =>
    `WITH ${cte} SELECT ${select} FROM expense_source ${where} ORDER BY ${orderSql} LIMIT 5000`,

  where: (clauses) => (clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""),

  or: (clauses) => `(${clauses.join(" OR ")})`,

  totalSummary: (cte, where) =>
    `WITH ${cte}
     SELECT COALESCE(SUM(report_amount), 0) AS total
     FROM expense_source
     ${where}`,

  grouped: (cte, select, where, groupBy, orderSql) =>
    `WITH ${cte} SELECT ${select} FROM expense_source ${where} GROUP BY ${groupBy}${orderSql ? ` ORDER BY ${orderSql}` : ""} LIMIT 5000`,

  groupedOrder: (groupBy = [], sortColumns = [], priceAggregate = "SUM(report_amount)") => {
    const parts = [];
    for (const sort of sortColumns) {
      const dir = sort?.direction === "desc" ? "DESC" : "ASC";
      if (sort?.column === "price") {
        parts.push(`${priceAggregate} ${dir}`);
        continue;
      }
      const pos = groupBy.indexOf(sort?.column);
      if (pos !== -1) {
        parts.push(`${pos + 1} ${dir}`);
      } else if (reportSql.groupExpr[sort?.column]) {
        parts.push(`MIN(${reportSql.groupExpr[sort.column]}) ${dir}`);
      }
    }
    if (parts.length) return parts.join(", ");
    return groupBy.map((_, index) => `${index + 1} ASC`).join(", ");
  },

  groupedDetail: (cte, select, where, groupBy, groupOrderSql, detailOrderSql) =>
    `WITH ${cte}
     SELECT ${select},
            jsonb_agg(
              to_jsonb(expense_source)
              ORDER BY ${detailOrderSql}
            ) AS detail_rows
     FROM expense_source
     ${where}
     GROUP BY ${groupBy}
     ${groupOrderSql ? `ORDER BY ${groupOrderSql}` : ""}
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
    week: "(((now() AT TIME ZONE 'Asia/Kolkata')::date - 7) - (FLOOR((((now() AT TIME ZONE 'Asia/Kolkata')::date - 1 - expense_date)::numeric) / 7)::int * 7))::date",
    month: "date_trunc('month', expense_date)::date",
    year: "extract(year from expense_date)::int",
    category: "category",
    item: "item",
    survivor: "survivor",
  },
};
