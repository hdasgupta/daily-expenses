import { userSql } from "../../scripts/sql/userSql.js";
import { q } from "../db/index.js";
import { sendDailyEmailReport } from "./mailService.js";
import { buildDailyEmailReportPdf } from "./dailyEmailReportPdfService.js";
import { nowIso } from "../utils/dates.js";
import { signedObjectUrl } from "./storageService.js";

const DAILY_REPORT_SQL = {
  dailySummary: `WITH days AS (
      SELECT gs::date AS day
      FROM generate_series(
        (CURRENT_DATE - INTERVAL '7 days')::date,
        (CURRENT_DATE - INTERVAL '1 day')::date,
        INTERVAL '1 day'
      ) AS gs
    )
    SELECT d.day,
      COALESCE(SUM(e.total_cost), 0) AS total,
      COUNT(e.id)::int AS expense_count
    FROM days d
    LEFT JOIN public.expenses e ON e.expense_date = d.day
    GROUP BY d.day
    ORDER BY d.day`,

  survivorSummary: `WITH days AS (
      SELECT gs::date AS day
      FROM generate_series(
        (CURRENT_DATE - INTERVAL '7 days')::date,
        (CURRENT_DATE - INTERVAL '1 day')::date,
        INTERVAL '1 day'
      ) AS gs
    )
    SELECT d.day, s.full_name AS survivor,
      COALESCE(SUM(es.amount), 0) AS total
    FROM days d
    JOIN public.expenses e ON e.expense_date = d.day
    JOIN public.expense_shares es ON es.expense_id = e.id
    JOIN public.survivors s ON s.id = es.survivor_id
    GROUP BY d.day, s.id, s.full_name
    ORDER BY d.day, s.full_name`,

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
      date: String(row.day).slice(0, 10),
      total: Number(row.total || 0),
      expenseCount: Number(row.expense_count || 0),
    })),
    survivorSummary: survivors.rows.map((row) => ({
      date: String(row.day).slice(0, 10),
      survivor: row.survivor || "Unknown",
      total: Number(row.total || 0),
    })),
    dump: await Promise.all(
      dump.rows.map(async (row) => ({
        date: String(row.date).slice(0, 10),
        category: row.category || "—",
        item: row.item || "—",
        survivor: row.survivor || "—",
        price: Number(row.price || 0),
        expenseId: row.expense_id,
        totalCost: Number(row.total_cost || 0),
        comment: row.comment || "—",
        proofUrl: row.proof_key ? await signedObjectUrl(row.proof_key) : null,
      })),
    ),
  };
}

export async function sendDailyEmailReportToManagers() {
  const report = await buildDailyEmailReport();
  const pdf = await buildDailyEmailReportPdf(report);
  const result = await q(userSql.managers);
  const reportDate = report.generatedAt.slice(0, 10);
  const failures = [];

  // Attempt every active admin/manager even if one recipient fails.
  for (const row of result.rows) {
    try {
      await sendDailyEmailReport(row.email, pdf, reportDate);
    } catch (error) {
      failures.push({ email: row.email, error });
    }
  }

  if (failures.length) {
    const details = failures.map((item) => `${item.email}: ${item.error?.message || String(item.error)}`).join('; ');
    const aggregate = new Error(`Common daily report email failed for ${failures.length} of ${result.rows.length} recipients: ${details}`);
    aggregate.name = 'CommonReportRecipientDeliveryError';
    aggregate.failures = failures;
    throw aggregate;
  }

  return { recipients: result.rows.length, rows: report.dump.length };
}

export { DAILY_REPORT_SQL };
