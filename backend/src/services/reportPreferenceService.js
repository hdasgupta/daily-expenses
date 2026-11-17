import { q } from "../db/index.js";
import { cleanConfig } from "./reportService.js";

let tableReadyPromise = null;

async function ensureReportUserPreferencesTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = q(
      `CREATE TABLE IF NOT EXISTS public.report_user_preferences (
        user_id BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ).catch((err) => {
      tableReadyPromise = null;
      console.error("Failed to ensure public.report_user_preferences table", err);
    });
  }
  await tableReadyPromise;
}

const VALID_ACTIVE_FILTERS = new Set(["date", "hasProof", "categoryItems", "categories", "survivors"]);

function sanitizePreferenceConfig(raw = {}) {
  const cleaned = cleanConfig(raw);
  const activeFilters = Array.isArray(raw?.activeFilters)
    ? [...new Set(raw.activeFilters.map(String).filter((f) => VALID_ACTIVE_FILTERS.has(f)))]
    : [
        ...(cleaned.dateFilterType && cleaned.dateFilterType !== "none" ? ["date"] : []),
        ...(cleaned.filters?.hasProof ? ["hasProof"] : []),
        ...(cleaned.filters?.categoryItems?.length ? ["categoryItems"] : []),
        ...(cleaned.filters?.categories?.length ? ["categories"] : []),
        ...(cleaned.filters?.survivors?.length ? ["survivors"] : []),
      ];

  return {
    activeFilters,
    dateFilterType: cleaned.dateFilterType,
    filters: cleaned.filters,
    sortColumns: cleaned.sortColumns,
    groupBy: cleaned.groupBy,
    summarise: Boolean(cleaned.summarise),
  };
}

export async function getUserReportPreference(userId) {
  await ensureReportUserPreferencesTable();

  const result = await q(
    `SELECT config
       FROM public.report_user_preferences
      WHERE user_id = $1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row || !row.config || typeof row.config !== "object" || !Object.keys(row.config).length) {
    return { config: null };
  }

  return {
    config: sanitizePreferenceConfig(row.config),
  };
}

export async function saveUserReportPreference(userId, rawConfig = {}) {
  await ensureReportUserPreferencesTable();

  const config = sanitizePreferenceConfig(rawConfig);

  await q(
    `INSERT INTO public.report_user_preferences (user_id, config, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       config = EXCLUDED.config,
       updated_at = now()`,
    [userId, JSON.stringify(config)],
  );

  return { config };
}
