import { q } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { sendWeeklyEmailReport } from "./mailService.js";
import { buildWeeklyEmailReportPdf } from "./weeklyEmailReportPdfService.js";
import { nowIso } from "../utils/dates.js";
import { signedObjectUrl } from "./storageService.js";

const WEEKLY_REPORT_SQL = {
  weeklySummary: `WITH weeks AS (
      SELECT gs::date AS week_start,
             (gs::date + 6) AS week_end
      FROM generate_series(
        (CURRENT_DATE - INTERVAL '28 days')::date,
        (CURRENT_DATE - INTERVAL '7 days')::date,
        INTERVAL '7 days'
      ) AS gs
    )
    SELECT w.week_start, w.week_end,
      COALESCE(SUM(e.total_cost), 0) AS total,
      COUNT(e.id)::int AS expense_count
    FROM weeks w
    LEFT JOIN public.expenses e
      ON e.expense_date >= w.week_start
     AND e.expense_date <= w.week_end
    GROUP BY w.week_start, w.week_end
    ORDER BY w.week_start`,

  survivorSummary: `SELECT
      (e.expense_date - EXTRACT(DOW FROM e.expense_date)::int)::date AS week_start,
      ((e.expense_date - EXTRACT(DOW FROM e.expense_date)::int)::date + 6) AS week_end,
      s.full_name AS survivor,
      COALESCE(SUM(es.amount), 0) AS total
    FROM public.expenses e
    JOIN public.expense_shares es ON es.expense_id = e.id
    JOIN public.survivors s ON s.id = es.survivor_id
    WHERE e.expense_date >= CURRENT_DATE - INTERVAL '28 days'
      AND e.expense_date < CURRENT_DATE
    GROUP BY week_start, week_end, s.id, s.full_name
    ORDER BY week_start, s.full_name`,

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
    WHERE e.expense_date >= CURRENT_DATE - INTERVAL '28 days'
      AND e.expense_date < CURRENT_DATE
    ORDER BY e.expense_date, e.id, s.full_name`,
};

export async function buildWeeklyEmailReport() {
  const [weekly, survivors, dump] = await Promise.all([
    q(WEEKLY_REPORT_SQL.weeklySummary),
    q(WEEKLY_REPORT_SQL.survivorSummary),
    q(WEEKLY_REPORT_SQL.dump),
  ]);

  return {
    generatedAt: nowIso(),
    weeklySummary: weekly.rows.map((row) => ({
      weekStart: String(row.week_start).slice(0, 10),
      weekEnd: String(row.week_end).slice(0, 10),
      total: Number(row.total || 0),
      expenseCount: Number(row.expense_count || 0),
    })),
    survivorSummary: survivors.rows.map((row) => ({
      weekStart: String(row.week_start).slice(0, 10),
      weekEnd: String(row.week_end).slice(0, 10),
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

export async function sendWeeklyEmailReportToManagers() {
  const report = await buildWeeklyEmailReport();
  const pdf = await buildWeeklyEmailReportPdf(report);
  const result = await q(userSql.managers);
  const reportDate = report.generatedAt.slice(0, 10);
  const failures = [];

  // Attempt every active admin/manager even if one recipient fails.
  for (const row of result.rows) {
    try {
      await sendWeeklyEmailReport(row.email, pdf, reportDate);
    } catch (error) {
      failures.push({ email: row.email, error });
    }
  }

  if (failures.length) {
    const details = failures.map((item) => `${item.email}: ${item.error?.message || String(item.error)}`).join('; ');
    const aggregate = new Error(`Common weekly report email failed for ${failures.length} of ${result.rows.length} recipients: ${details}`);
    aggregate.name = 'CommonReportRecipientDeliveryError';
    aggregate.failures = failures;
    throw aggregate;
  }

  return { recipients: result.rows.length, rows: report.dump.length };
}

export { WEEKLY_REPORT_SQL };
