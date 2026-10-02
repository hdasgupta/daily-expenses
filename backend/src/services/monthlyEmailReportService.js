import { q } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { sendMonthlyEmailReport } from "./mailService.js";
import { buildMonthlyEmailReportPdf } from "./monthlyEmailReportPdfService.js";
import { nowIso } from "../utils/dates.js";
import { signedObjectUrl } from "./storageService.js";

const MONTHLY_REPORT_SQL = {
  monthlySummary: `WITH months AS (
      SELECT gs::date AS month_start,
             (gs::date + INTERVAL '1 month - 1 day')::date AS month_end
      FROM generate_series(
        (date_trunc('month', CURRENT_DATE) - INTERVAL '3 months')::date,
        (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date,
        INTERVAL '1 month'
      ) AS gs
    )
    SELECT m.month_start, m.month_end,
      COALESCE(SUM(e.total_cost), 0) AS total,
      COUNT(e.id)::int AS expense_count
    FROM months m
    LEFT JOIN public.expenses e
      ON e.expense_date >= m.month_start
     AND e.expense_date <= m.month_end
    GROUP BY m.month_start, m.month_end
    ORDER BY m.month_start`,

  survivorSummary: `WITH months AS (
      SELECT gs::date AS month_start,
             (gs::date + INTERVAL '1 month - 1 day')::date AS month_end
      FROM generate_series(
        (date_trunc('month', CURRENT_DATE) - INTERVAL '3 months')::date,
        (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date,
        INTERVAL '1 month'
      ) AS gs
    )
    SELECT m.month_start,
      m.month_end,
      s.full_name AS survivor,
      COALESCE(SUM(es.amount), 0) AS total
    FROM months m
    JOIN public.expenses e
      ON e.expense_date >= m.month_start
     AND e.expense_date <= m.month_end
    JOIN public.expense_shares es ON es.expense_id = e.id
    JOIN public.survivors s ON s.id = es.survivor_id
    GROUP BY m.month_start, m.month_end, s.id, s.full_name
    ORDER BY m.month_start, s.full_name`,

  dump: `SELECT e.id AS expense_id, e.total_cost, e.expense_date AS date,
      c.name AS category,
      COALESCE(i.name, e.other_item, 'Total') AS item,
      s.full_name AS survivor,
      es.amount AS price,
      e.comment,
      e.proof_key
    FROM public.expenses e
    JOIN public.categories c ON c.id = e.category_id
    LEFT JOIN public.items i ON i.id = e.item_id
    LEFT JOIN public.expense_shares es ON es.expense_id = e.id
    LEFT JOIN public.survivors s ON s.id = es.survivor_id
    WHERE e.expense_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '3 months'
      AND e.expense_date < date_trunc('month', CURRENT_DATE)
    ORDER BY e.expense_date, e.id, s.full_name`,
};

export async function buildMonthlyEmailReport() {
  const [monthly, survivors, dump] = await Promise.all([
    q(MONTHLY_REPORT_SQL.monthlySummary),
    q(MONTHLY_REPORT_SQL.survivorSummary),
    q(MONTHLY_REPORT_SQL.dump),
  ]);

  return {
    generatedAt: nowIso(),
    monthlySummary: monthly.rows.map((row) => ({
      monthStart: String(row.month_start).slice(0, 10),
      monthEnd: String(row.month_end).slice(0, 10),
      total: Number(row.total || 0),
      expenseCount: Number(row.expense_count || 0),
    })),
    survivorSummary: survivors.rows.map((row) => ({
      monthStart: String(row.month_start).slice(0, 10),
      monthEnd: String(row.month_end).slice(0, 10),
      survivor: row.survivor || "Unknown",
      total: Number(row.total || 0),
    })),
    dump: await Promise.all(dump.rows.map(async (row) => ({
      date: String(row.date).slice(0, 10),
      category: row.category || "—",
      item: row.item || "—",
      survivor: row.survivor || "—",
      price: Number(row.price || 0),
      expenseId: row.expense_id,
      totalCost: Number(row.total_cost || 0),
      comment: row.comment || "—",
      proofUrl: row.proof_key ? await signedObjectUrl(row.proof_key) : null,
    }))),
  };
}

export async function sendMonthlyEmailReportToManagers() {
  const report = await buildMonthlyEmailReport();
  const pdf = await buildMonthlyEmailReportPdf(report);
  const result = await q(userSql.managers);
  const reportDate = report.generatedAt.slice(0, 10);
  for (const row of result.rows) {
    await sendMonthlyEmailReport(row.email, pdf, reportDate);
  }
  return { recipients: result.rows.length, rows: report.dump.length };
}

export { MONTHLY_REPORT_SQL };
