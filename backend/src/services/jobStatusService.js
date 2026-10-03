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
];

export async function getJobStatus({ page = 1, pageSize = 10, search = "" }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = [5, 10, 20, 50].includes(Number(pageSize))
    ? Number(pageSize)
    : 10;
  const safeSearch = String(search || "").trim();
  const offset = (safePage - 1) * safePageSize;
  const searchPattern = `%${safeSearch}%`;

  const [countResult, rowsResult] = await Promise.all([
    q(
      `SELECT COUNT(*)::int AS total
       FROM public.scheduler_job_executions
       WHERE $1 = '' OR job_name ILIKE $2`,
      [safeSearch, searchPattern],
    ),
    q(
      `SELECT id, job_name, scheduled_key, status, started_at, completed_at,
              duration_ms, error_message
       FROM public.scheduler_job_executions
       WHERE $1 = '' OR job_name ILIKE $2
       ORDER BY started_at DESC
       LIMIT $3 OFFSET $4`,
      [safeSearch, searchPattern, safePageSize, offset],
    ),
  ]);

  const schedules = scheduleDefinitions.map((item) => {
    const valid = Boolean(item.cron && cron.validate(item.cron));
    let nextRunAt = null;
    if (valid) {
      try {
        const task = cron.schedule(item.cron, () => {}, { timezone: item.timezone });
        const nextRun = task.getNextRun();
        nextRunAt = nextRun instanceof Date && !Number.isNaN(nextRun.getTime())
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
