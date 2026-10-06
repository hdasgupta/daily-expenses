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
  const searchPattern = `%${safeSearch}%`;

  const historySql = `(
    SELECT e.id::text AS id,
           e.job_name, e.scheduled_key, e.status, e.started_at, e.completed_at,
           e.duration_ms, e.error_message, NULL::text AS scheduled_report_name
      FROM public.scheduler_job_executions e
    UNION ALL
    SELECT ('scheduled-' || j.id::text || '-' || r.scheduled_key)::text AS id,
           r.job_name, r.scheduled_key, r.status, r.started_at, r.completed_at,
           r.duration_ms, r.error_message, j.name AS scheduled_report_name
      FROM public.scheduler_job_runs r
      JOIN public.scheduled_report_jobs j
        ON r.job_name = 'scheduled-report:' || j.id::text
     WHERE r.job_name LIKE 'scheduled-report:%'
       AND ($1::boolean = TRUE OR j.owner_user_id = $2)
  ) history`;
  const historyWhere = `$2 = '' OR history.job_name ILIKE $3 OR history.scheduled_report_name ILIKE $3`;

  const [countResult, rowsResult] = await Promise.all([
    q(`SELECT COUNT(*)::int AS total\n         FROM ${historySql}\n        WHERE ${historyWhere}`, [
      Boolean(isAdmin),
      userId,
      safeSearch,
      searchPattern,
    ]),
    q(
      `SELECT id, job_name, scheduled_key, status, started_at, completed_at,\n              duration_ms, error_message, scheduled_report_name\n         FROM ${historySql}\n        WHERE ${historyWhere}\n        ORDER BY started_at DESC\n        LIMIT $4 OFFSET $5`,
      [Boolean(isAdmin), userId, safeSearch, searchPattern, safePageSize, offset],
    ),
  ]);

  const oneTimeResult = await q(
    `SELECT j.id, j.name, j.config, j.scheduled_for, j.status, j.last_attempt_at, j.last_error, j.created_at, j.owner_user_id, j.created_by_user_id, u.full_name AS owner_name, u.email AS owner_email, c.full_name AS creator_name, c.email AS creator_email
       FROM public.one_time_report_email_jobs j
       JOIN public.users u ON u.id = j.owner_user_id
       LEFT JOIN public.users c ON c.id = j.created_by_user_id
      WHERE ($1::boolean = TRUE OR j.owner_user_id = $2)
      ORDER BY j.scheduled_for ASC, j.id ASC`,
    [Boolean(isAdmin), userId],
  );

  const oneTimeJobs = oneTimeResult.rows;
  const categoryIds = [
    ...new Set(
      oneTimeJobs.flatMap((job) => {
        const keys = job.config?.filters?.categoryItems;
        return Array.isArray(keys)
          ? keys
              .map((key) => String(key).split(":")[0])
              .filter((id) => /^\d+$/.test(id))
          : [];
      }),
    ),
  ];

  let categoryNames = new Map();
  if (categoryIds.length) {
    const categoryResult = await q(
      `SELECT id, name
         FROM public.categories
        WHERE id = ANY($1::bigint[])`,
      [categoryIds],
    );
    categoryNames = new Map(
      categoryResult.rows.map((row) => [String(row.id), row.name]),
    );
  }

  const enrichedOneTimeJobs = oneTimeJobs.map((job) => {
    const config = job.config && typeof job.config === "object" ? { ...job.config } : {};
    const filters = config.filters && typeof config.filters === "object" ? { ...config.filters } : {};
    const keys = Array.isArray(filters.categoryItems) ? filters.categoryItems : [];

    if (keys.length) {
      filters.categoryItemLabels = keys.map((key) => {
        const [categoryId, kind] = String(key).split(":");
        const categoryName = categoryNames.get(String(categoryId)) || `Category ${categoryId}`;
        if (kind === "item") return `${categoryName} - Item`;
        return `${categoryName} - ${kind === "other" ? "Other" : "Total"}`;
      });
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
