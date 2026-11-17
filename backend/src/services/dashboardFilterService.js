import { q } from "../db/index.js";
import { getDashboardDefinition } from "./dashboardReportService.js";

let tableReadyPromise = null;

async function ensureDashboardUserFiltersTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = q(
      `CREATE TABLE IF NOT EXISTS public.dashboard_user_filters (
        user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        report_key VARCHAR(100) NOT NULL,
        categories JSONB NOT NULL DEFAULT '[]'::jsonb,
        survivors JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, report_key)
      )`,
    ).catch((err) => {
      tableReadyPromise = null;
      console.error("Failed to ensure public.dashboard_user_filters table", err);
    });
  }
  await tableReadyPromise;
}

function cleanIdArray(values) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((v) => String(v ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

function assertValidReportKey(reportKey) {
  const key = String(reportKey || "").trim();
  const definition = getDashboardDefinition(key);
  if (!definition) {
    const err = new Error("Unknown dashboard report.");
    err.statusCode = 404;
    throw err;
  }
  return key;
}

export async function getUserDashboardFilters(userId, reportKey) {
  const key = assertValidReportKey(reportKey);
  await ensureDashboardUserFiltersTable();

  const result = await q(
    `SELECT categories, survivors
       FROM public.dashboard_user_filters
      WHERE user_id = $1
        AND report_key = $2`,
    [userId, key],
  );

  const row = result.rows[0];
  return {
    reportKey: key,
    categories: cleanIdArray(row?.categories),
    survivors: cleanIdArray(row?.survivors),
  };
}

export async function saveUserDashboardFilters(userId, reportKey, payload = {}) {
  const key = assertValidReportKey(reportKey);
  await ensureDashboardUserFiltersTable();

  const categories = cleanIdArray(payload?.categories);
  const survivors = cleanIdArray(payload?.survivors);

  await q(
    `INSERT INTO public.dashboard_user_filters (user_id, report_key, categories, survivors, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
     ON CONFLICT (user_id, report_key)
     DO UPDATE SET
       categories = EXCLUDED.categories,
       survivors = EXCLUDED.survivors,
       updated_at = now()`,
    [userId, key, JSON.stringify(categories), JSON.stringify(survivors)],
  );

  return {
    reportKey: key,
    categories,
    survivors,
  };
}
