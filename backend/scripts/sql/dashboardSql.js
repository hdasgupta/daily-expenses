export const dashboardSql = {
  trend: {
    day: { expression: "e.expense_date", start: "CURRENT_DATE - ($1::int - 1)" },
    week: {
      expression: "date_trunc('week', e.expense_date)::date",
      start: "date_trunc('week', CURRENT_DATE) - (($1::int - 1) * interval '1 week')",
    },
    month: {
      expression: "date_trunc('month', e.expense_date)::date",
      start: "date_trunc('month', CURRENT_DATE) - (($1::int - 1) * interval '1 month')",
    },
    year: {
      expression: "date_trunc('year', e.expense_date)::date",
      start: "date_trunc('year', CURRENT_DATE) - (($1::int - 1) * interval '1 year')",
    },
  },
  trendQuery: (expression, start) => `SELECT ${expression} AS bucket,SUM(e.total_cost) AS total
    FROM public.expenses e WHERE e.expense_date >= ${start}
    GROUP BY ${expression} ORDER BY bucket`,
  breakdown: {
    category: { idField: "c.id", field: "c.name", amount: "e.total_cost", join: "" },
    survivor: {
      idField: "s.id",
      field: "s.full_name",
      amount: "es.amount",
      join: "JOIN public.expense_shares es ON es.expense_id=e.id JOIN public.survivors s ON s.id=es.survivor_id",
    },
  },
  breakdownQuery: (
    period,
    idField,
    field,
    amount,
    join,
    start,
  ) => `SELECT ${period} AS bucket,${idField} AS entity_id,${field} AS name,SUM(${amount}) AS total
    FROM public.expenses e JOIN public.categories c ON c.id=e.category_id ${join}
    WHERE e.expense_date >= ${start} GROUP BY ${period},${idField},${field} ORDER BY bucket,total DESC`,
};
