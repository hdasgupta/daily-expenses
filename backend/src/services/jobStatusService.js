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

export async function getJobStatus({ page = 1, pageSize = 10, search = "", userId }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = [5, 10, 20, 50].includes(Number(pageSize)) ? Number(pageSize) : 10;
  const safeSearch = String(search || "").trim();
  const offset = (safePage - 1) * safePageSize;
  const searchPattern = `%${safeSearch}%`;

  const historySql = `(\n    SELECT e.id::text AS id,
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
       AND j.owner_user_id = $1
  ) history`;
  const historyWhere = `$2 = '' OR history.job_name ILIKE $3 OR history.scheduled_report_name ILIKE $3`;

  const [countResult, rowsResult] = await Promise.all([
    q(`SELECT COUNT(*)::int AS total\n         FROM ${historySql}\n        WHERE ${historyWhere}`, [
      userId,
      safeSearch,
      searchPattern,
    ]),
    q(
      `SELECT id, job_name, scheduled_key, status, started_at, completed_at,\n              duration_ms, error_message, scheduled_report_name\n         FROM ${historySql}\n        WHERE ${historyWhere}\n        ORDER BY started_at DESC\n        LIMIT $4 OFFSET $5`,
      [userId, safeSearch, searchPattern, safePageSize, offset],
    ),
  ]);

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
    rows: rowsResult.rows,
    total: countResult.rows[0]?.total || 0,
    page: safePage,
    pageSize: safePageSize,
    search: safeSearch,
  };
}
