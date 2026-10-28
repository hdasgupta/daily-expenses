import { q } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { sendYearlyEmailReport } from "./mailService.js";
import { buildYearlyEmailReportPdf } from "./yearlyEmailReportPdfService.js";
import { nowIso, toIsoDateString } from "../utils/dates.js";
import { signedObjectUrl } from "./storageService.js";

const YEARLY_REPORT_SQL = {
  yearlySummary: `WITH years AS (
      SELECT gs::date AS year_start,
             (gs::date + INTERVAL '1 year - 1 day')::date AS year_end
      FROM generate_series(
        (date_trunc('year', CURRENT_DATE) - INTERVAL '1 year')::date,
        date_trunc('year', CURRENT_DATE)::date,
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
        (date_trunc('year', CURRENT_DATE) - INTERVAL '1 year')::date,
        date_trunc('year', CURRENT_DATE)::date,
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
    WHERE e.expense_date >= (date_trunc('year', CURRENT_DATE) - INTERVAL '1 year')::date
      AND e.expense_date <= (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date
    ORDER BY e.expense_date, e.id, s.full_name`,
};

export async function buildYearlyEmailReport() {
  const yearly = await q(YEARLY_REPORT_SQL.yearlySummary);
  const survivors = await q(YEARLY_REPORT_SQL.survivorSummary);
  const dump = await q(YEARLY_REPORT_SQL.dump);
  const proofCache = new Map();

  const getCachedProofUrl = async (key) => {
    if (!key) return null;
    if (!proofCache.has(key)) {
      proofCache.set(key, signedObjectUrl(key));
    }
    return proofCache.get(key);
  };

  return {
    generatedAt: nowIso(),
    yearlySummary: yearly.rows.map((row) => ({
      yearStart: toIsoDateString(row.year_start),
      yearEnd: toIsoDateString(row.year_end),
      total: Number(row.total || 0),
      expenseCount: Number(row.expense_count || 0),
    })),
    survivorSummary: survivors.rows.map((row) => ({
      yearStart: toIsoDateString(row.year_start),
      yearEnd: toIsoDateString(row.year_end),
      survivor: row.survivor || "Unknown",
      total: Number(row.total || 0),
    })),
    dump: await Promise.all(
      dump.rows.map(async (row) => ({
        date: toIsoDateString(row.date),
        category: row.category || "—",
        item: row.item || "—",
        survivor: row.survivor || "—",
        price: Number(row.price || 0),
        expenseId: row.expense_id,
        totalCost: Number(row.total_cost || 0),
        comment: row.comment || "—",
        proofUrl: await getCachedProofUrl(row.proof_key),
      })),
    ),
  };
}

export async function sendYearlyEmailReportToManagers() {
  const report = await buildYearlyEmailReport();
  const pdf = await buildYearlyEmailReportPdf(report);
  const result = await q(userSql.managers);
  const reportDate = report.generatedAt.slice(0, 10);
  for (const row of result.rows) {
    await sendYearlyEmailReport(row.email, pdf, reportDate);
  }
  return { recipients: result.rows.length, rows: report.dump.length };
}

export { YEARLY_REPORT_SQL };
