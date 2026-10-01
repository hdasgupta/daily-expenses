import { q } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { sendDailyEmailReport } from "./mailService.js";
import { buildDailyEmailReportPdf } from "./dailyEmailReportPdfService.js";
import { nowIso } from "../utils/dates.js";

const DAILY_REPORT_SQL = {
  dailySummary: `SELECT days.date,
      COALESCE(SUM(e.total_cost), 0) AS total,
      COUNT(e.id)::int AS expense_count
    FROM generate_series(CURRENT_DATE - INTERVAL '7 days', CURRENT_DATE - INTERVAL '1 day', INTERVAL '1 day') AS days(date)
    LEFT JOIN public.expenses e ON e.expense_date = days.date
    GROUP BY days.date
    ORDER BY days.date`,
  survivorSummary: `SELECT e.expense_date AS date,
      s.full_name AS survivor,
      COALESCE(SUM(es.amount), 0) AS total
    FROM public.expenses e
    JOIN public.expense_shares es ON es.expense_id = e.id
    JOIN public.survivors s ON s.id = es.survivor_id
    WHERE e.expense_date >= CURRENT_DATE - INTERVAL '7 days'
      AND e.expense_date < CURRENT_DATE
    GROUP BY e.expense_date, s.id, s.full_name
    ORDER BY e.expense_date, s.full_name`,
  dump: `SELECT e.expense_date AS date,
      c.name AS category,
      COALESCE(i.name, e.other_item, 'Total') AS item,
      s.full_name AS survivor,
      es.amount AS price,
      e.comment
    FROM public.expenses e
    JOIN public.categories c ON c.id = e.category_id
    LEFT JOIN public.items i ON i.id = e.item_id
    LEFT JOIN public.expense_shares es ON es.expense_id = e.id
    LEFT JOIN public.survivors s ON s.id = es.survivor_id
    WHERE e.expense_date >= CURRENT_DATE - INTERVAL '7 days'
      AND e.expense_date < CURRENT_DATE
    ORDER BY e.expense_date, e.id, s.full_name`,
};

export async function buildDailyEmailReport() {
  const [daily, survivors, dump] = await Promise.all([
    q(DAILY_REPORT_SQL.dailySummary),
    q(DAILY_REPORT_SQL.survivorSummary),
    q(DAILY_REPORT_SQL.dump),
  ]);

  return {
    generatedAt: nowIso(),
    dailySummary: daily.rows.map((row) => ({
      date: String(row.date).slice(0, 10),
      total: Number(row.total || 0),
      expense_count: Number(row.expense_count || 0),
    })),
    survivorSummary: survivors.rows.map((row) => ({
      date: String(row.date).slice(0, 10),
      survivor: row.survivor || "Unknown",
      total: Number(row.total || 0),
    })),
    dump: dump.rows.map((row) => ({
      date: String(row.date).slice(0, 10),
      category: row.category || "—",
      item: row.item || "—",
      survivor: row.survivor || "—",
      price: Number(row.price || 0),
      comment: row.comment || "—",
    })),
  };
}

export async function sendDailyEmailReportToManagers() {
  const report = await buildDailyEmailReport();
  const pdf = await buildDailyEmailReportPdf(report);
  const result = await q(userSql.managers);
  const reportDate = report.generatedAt.slice(0, 10);
  for (const row of result.rows) await sendDailyEmailReport(row.email, pdf, reportDate);
  return { recipients: result.rows.length, rows: report.dump.length };
}

export { DAILY_REPORT_SQL };
