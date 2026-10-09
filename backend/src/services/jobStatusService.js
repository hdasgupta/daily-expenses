import cron from "node-cron";
import { q } from "../db/index.js";
import { env } from "../config/env.js";

const scheduleDefinitions = [
  {
    jobName: "daily-email-report",
    label: "Daily 7-day email report",
    cron: env.dailyEmailReportCron,
    timezone: env.dailyEmailReportTimezone,
  },
  {
    jobName: "weekly-email-report",
    label: "Weekly 4-week email report",
    cron: env.weeklyEmailReportCron,
    timezone: env.weeklyEmailReportTimezone,
  },
  {
    jobName: "monthly-email-report",
    label: "Monthly 3-month email report",
    cron: env.monthlyEmailReportCron,
    timezone: env.monthlyEmailReportTimezone,
  },
  {
    jobName: "yearly-email-report",
    label: "Yearly 2-year email report",
    cron: env.yearlyEmailReportCron,
    timezone: env.yearlyEmailReportTimezone,
  },
];

export async function getJobStatus({ page = 1, pageSize = 10, search = "", userId, isAdmin = false }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = [5, 10, 20, 50].includes(Number(pageSize)) ? Number(pageSize) : 10;
  const safeSearch = String(search || "").trim();
  const offset = (safePage - 1) * safePageSize;

  // Older one-time report jobs were created before created_by_user_id was
  // populated. The user confirmed those legacy jobs were created by the
  // administrator, so when an administrator opens Job Status, backfill the
  // missing creator with the currently logged-in administrator. New jobs
  // already store created_by_user_id at creation time.
  if (isAdmin && userId) {
    await q(
      `UPDATE public.one_time_report_email_jobs
          SET created_by_user_id = $1,
              updated_at = now()
        WHERE created_by_user_id IS NULL`,
      [userId],
    );
  }

  const historySql = `(
    SELECT e.id::text AS id,
           e.job_name, e.scheduled_key, e.status, e.started_at, e.completed_at,
           e.duration_ms, e.error_message, NULL::text AS scheduled_report_name,
           NULL::text AS owner_name, NULL::text AS owner_email
      FROM public.scheduler_job_executions e
    UNION ALL
    SELECT ('scheduled-' || split_part(r.job_name, ':', 2) || '-' || r.scheduled_key)::text AS id,
           r.job_name, r.scheduled_key, r.status, r.started_at, r.completed_at,
           r.duration_ms, r.error_message, j.name AS scheduled_report_name,
           u.full_name AS owner_name, u.email AS owner_email
      FROM public.scheduler_job_runs r
      LEFT JOIN public.scheduled_report_jobs j
        ON r.job_name = 'scheduled-report:' || j.id::text
      LEFT JOIN public.users u ON u.id = j.owner_user_id
     WHERE r.job_name LIKE 'scheduled-report:%'
       AND ($1::boolean = TRUE OR j.owner_user_id = NULLIF($2::text, '')::bigint)
    UNION ALL
    SELECT ('one-time-' || r.job_name || '-' || r.scheduled_key)::text AS id,
           r.job_name, r.scheduled_key, r.status, r.started_at, r.completed_at,
           r.duration_ms, r.error_message,
           'One-time report PDF email #' ||
             split_part(split_part(r.job_name, ':', 2), ':', 1) AS scheduled_report_name,
           u.full_name AS owner_name, u.email AS owner_email
      FROM public.scheduler_job_runs r
      LEFT JOIN public.users u
        ON u.id::text = split_part(r.job_name, ':user:', 2)
     WHERE r.job_name LIKE 'one-time-report:%:user:%'
       AND (
         $1::boolean = TRUE
         OR r.job_name LIKE 'one-time-report:%:user:' || NULLIF($2::text, '')
       )
  ) history`;
  const historyWhere =
    `$3 = '' OR history.job_name ILIKE $3 OR history.scheduled_report_name ILIKE $3
      OR ($1::boolean = TRUE AND (history.owner_name ILIKE $3 OR history.owner_email ILIKE $3))`;

  const [countResult, rowsResult] = await Promise.all([
    q(`SELECT COUNT(*)::int AS total
         FROM ${historySql}
        WHERE ${historyWhere}`, [
      Boolean(isAdmin),
      userId,
      safeSearch,
    ]),
    q(
      `SELECT id, job_name, scheduled_key, status, started_at, completed_at,
              duration_ms, error_message, scheduled_report_name, owner_name, owner_email
         FROM ${historySql}
        WHERE ${historyWhere}
        ORDER BY started_at DESC
        LIMIT $4 OFFSET $5`,
      [Boolean(isAdmin), userId, safeSearch, safePageSize, offset],
    ),
  ]);

  const oneTimeResult = await q(
    `SELECT j.id, j.name, j.config, j.scheduled_for, j.status,
            j.last_attempt_at, j.last_error, j.created_at,
            j.owner_user_id, j.created_by_user_id,
            u.full_name AS owner_name, u.email AS owner_email,
            c.full_name AS creator_name, c.email AS creator_email
       FROM public.one_time_report_email_jobs j
       LEFT JOIN public.users u ON u.id = j.owner_user_id
       LEFT JOIN public.users c ON c.id = j.created_by_user_id
      WHERE j.status <> 'completed'
        AND ($1::boolean = TRUE OR j.owner_user_id = NULLIF($2::text, '')::bigint)
      ORDER BY j.scheduled_for ASC, j.id ASC`,
    [Boolean(isAdmin), userId],
  );

  const oneTimeJobs = oneTimeResult.rows;
  // Load the canonical category ID/name map once. Avoid a filtered lookup here:
  // saved manager configs can contain legacy IDs or mixed numeric/string formats.
  // The info tooltip must use actual names from the category master table.
  const categoryResult = await q(
    `SELECT id, name FROM public.categories`,
  );
  const categoryNames = new Map(
    (categoryResult.rows || []).map((row) => [String(row.id), row.name]),
  );

  const enrichedOneTimeJobs = oneTimeJobs.map((job) => {
    const config = job.config && typeof job.config === "object" ? { ...job.config } : {};
    const filters = config.filters && typeof config.filters === "object" ? { ...config.filters } : {};
    const keys = Array.isArray(filters.categoryItems) ? filters.categoryItems : [];

    if (keys.length) {
      filters.categoryItemLabels = keys.map((key) => {
        const [categoryId, kind] = String(key).split(":");
        const categoryName = categoryNames.get(String(categoryId)) || `Unknown category (${categoryId})`;
        if (kind === "item") return `${categoryName} - Item`;
        return `${categoryName} - ${kind === "other" ? "Other" : "Total"}`;
      });
    }

    const categoryKeys = Array.isArray(filters.categories) ? filters.categories : [];
    if (categoryKeys.length) {
      filters.categoryLabels = categoryKeys.map(
        (categoryId) => categoryNames.get(String(categoryId)) || String(categoryId),
      );
    }

    return { ...job, config: { ...config, filters } };
  });

  const schedules = scheduleDefinitions.map((item) => {
    const valid = Boolean(item.cron && cron.validate(item.cron));
    let nextRunAt = null;
    if (valid) {
      try {
        const task = cron.schedule(item.cron, () => {}, { timezone: item.timezone });
        const nextRun = task.getNextRun();
        nextRunAt =
          nextRun instanceof Date && !Number.isNaN(nextRun.getTime())
            ? nextRun.toISOString()
            : null;
        task.stop();
        task.destroy();
      } catch (error) {
        console.error(`Unable to calculate next run for ${item.jobName}`, error);
      }
    }
    return { ...item, configured: Boolean(item.cron), valid, nextRunAt };
  });

  return {
    schedules,
    oneTimeScheduledJobs: enrichedOneTimeJobs,
    rows: rowsResult.rows,
    total: countResult.rows[0]?.total || 0,
    page: safePage,
    pageSize: safePageSize,
    search: safeSearch,
  };
}
