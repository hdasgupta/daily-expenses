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

let presetsTableReadyPromise = null;

async function ensureDashboardFilterPresetsTable() {
  if (!presetsTableReadyPromise) {
    presetsTableReadyPromise = q(
      `CREATE TABLE IF NOT EXISTS public.dashboard_filter_presets (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        categories JSONB NOT NULL DEFAULT '[]'::jsonb,
        survivors JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, name)
      )`,
    ).catch((err) => {
      presetsTableReadyPromise = null;
      console.error("Failed to ensure public.dashboard_filter_presets table", err);
    });
  }
  await presetsTableReadyPromise;
}

export async function listUserDashboardFilterPresets(userId) {
  await ensureDashboardFilterPresetsTable();
  const res = await q(
    `SELECT id, name, categories, survivors, updated_at
       FROM public.dashboard_filter_presets
      WHERE user_id = $1
      ORDER BY LOWER(name) ASC, id ASC`,
    [userId],
  );
  return (res.rows || []).map((row) => ({
    id: String(row.id),
    name: String(row.name || ""),
    categories: cleanIdArray(row.categories),
    survivors: cleanIdArray(row.survivors),
    updatedAt: row.updated_at,
  }));
}

export async function saveUserDashboardFilterPreset(userId, payload = {}) {
  await ensureDashboardFilterPresetsTable();
  const name = String(payload?.name || "").trim().slice(0, 150);
  if (!name) {
    const err = new Error("Filter preset name is required.");
    err.statusCode = 400;
    throw err;
  }
  const categories = cleanIdArray(payload?.categories);
  const survivors = cleanIdArray(payload?.survivors);

  const res = await q(
    `INSERT INTO public.dashboard_filter_presets (user_id, name, categories, survivors, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
     ON CONFLICT (user_id, name)
     DO UPDATE SET
       categories = EXCLUDED.categories,
       survivors = EXCLUDED.survivors,
       updated_at = now()
     RETURNING id, name, categories, survivors, updated_at`,
    [userId, name, JSON.stringify(categories), JSON.stringify(survivors)],
  );
  const row = res.rows[0];
  return {
    id: String(row.id),
    name: String(row.name || ""),
    categories: cleanIdArray(row.categories),
    survivors: cleanIdArray(row.survivors),
    updatedAt: row.updated_at,
  };
}

export async function deleteUserDashboardFilterPreset(userId, presetId) {
  await ensureDashboardFilterPresetsTable();
  const cleanId = /^\d+$/.test(String(presetId || "").trim()) ? String(presetId).trim() : "";
  if (!cleanId) {
    const err = new Error("Valid preset id is required.");
    err.statusCode = 400;
    throw err;
  }
  await q(
    `DELETE FROM public.dashboard_filter_presets
      WHERE id = $1::bigint
        AND user_id = $2`,
    [cleanId, userId],
  );
  return { ok: true, id: cleanId };
}
