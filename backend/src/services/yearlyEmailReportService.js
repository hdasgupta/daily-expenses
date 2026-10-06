import { q } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { sendYearlyEmailReport } from "./mailService.js";
import { buildYearlyEmailReportPdf } from "./yearlyEmailReportPdfService.js";
import { nowIso } from "../utils/dates.js";
import { signedObjectUrl } from "./storageService.js";

const YEARLY_REPORT_SQL = {
  yearlySummary: `WITH years AS (
      SELECT gs::date AS year_start,
             (gs::date + INTERVAL '1 year - 1 day')::date AS year_end
      FROM generate_series(
        (date_trunc('year', CURRENT_DATE) - INTERVAL '2 years')::date,
        (date_trunc('year', CURRENT_DATE) - INTERVAL '1 year')::date,
        INTERVAL '1 year'
      ) AS gs
    )
    SELECT y.year_start, y.year_end,
      COALESCE(SUM(e.total_cost), 0) AS total,
      COUNT(e.id)::int AS expense_count
    FROM years y
    LEFT JOIN public.expenses e
      ON e.expense_date >= y.year_start
     AND e.expense_date <= y.year_end
    GROUP BY y.year_start, y.year_end
    ORDER BY y.year_start`,

  survivorSummary: `WITH years AS (
      SELECT gs::date AS year_start,
             (gs::date + INTERVAL '1 year - 1 day')::date AS year_end
      FROM generate_series(
        (date_trunc('year', CURRENT_DATE) - INTERVAL '2 years')::date,
        (date_trunc('year', CURRENT_DATE) - INTERVAL '1 year')::date,
        INTERVAL '1 year'
      ) AS gs
    )
    SELECT y.year_start,
      y.year_end,
      s.full_name AS survivor,
      COALESCE(SUM(es.amount), 0) AS total
    FROM years y
    JOIN public.expenses e
      ON e.expense_date >= y.year_start
     AND e.expense_date <= y.year_end
    JOIN public.expense_shares es ON es.expense_id = e.id
    JOIN public.survivors s ON s.id = es.survivor_id
    GROUP BY y.year_start, y.year_end, s.id, s.full_name
    ORDER BY y.year_start, s.full_name`,

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
    WHERE e.expense_date >= date_trunc('year', CURRENT_DATE) - INTERVAL '2 years'
      AND e.expense_date < date_trunc('year', CURRENT_DATE)
    ORDER BY e.expense_date, e.id, s.full_name`,
};

export async function buildYearlyEmailReport() {
  const [yearly, survivors, dump] = await Promise.all([
    q(YEARLY_REPORT_SQL.yearlySummary),
    q(YEARLY_REPORT_SQL.survivorSummary),
    q(YEARLY_REPORT_SQL.dump),
  ]);

  return {
    generatedAt: nowIso(),
    yearlySummary: yearly.rows.map((row) => ({
      yearStart: String(row.year_start).slice(0, 10),
      yearEnd: String(row.year_end).slice(0, 10),
      total: Number(row.total || 0),
      expenseCount: Number(row.expense_count || 0),
    })),
    survivorSummary: survivors.rows.map((row) => ({
      yearStart: String(row.year_start).slice(0, 10),
      yearEnd: String(row.year_end).slice(0, 10),
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

export async function sendYearlyEmailReportToManagers() {
  const report = await buildYearlyEmailReport();
  const pdf = await buildYearlyEmailReportPdf(report);
  const result = await q(userSql.managers);
  const reportDate = report.generatedAt.slice(0, 10);
  const failures = [];

  // Attempt every active admin/manager even if one recipient fails.
  for (const row of result.rows) {
    try {
      await sendYearlyEmailReport(row.email, pdf, reportDate);
    } catch (error) {
      failures.push({ email: row.email, error });
    }
  }

  if (failures.length) {
    const details = failures.map((item) => `${item.email}: ${item.error?.message || String(item.error)}`).join('; ');
    const aggregate = new Error(`Common yearly report email failed for ${failures.length} of ${result.rows.length} recipients: ${details}`);
    aggregate.name = 'CommonReportRecipientDeliveryError';
    aggregate.failures = failures;
    throw aggregate;
  }

  return { recipients: result.rows.length, rows: report.dump.length };
}

export { YEARLY_REPORT_SQL };
