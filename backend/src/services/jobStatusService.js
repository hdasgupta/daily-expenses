import cron from "node-cron";
import { q } from "../db/index.js";
import { env } from "../config/env.js";
import {
  reconcileStaleScheduledReportRuns,
  processDueScheduledReportJobs,
} from "./scheduledReportScheduler.js";
import {
  reconcileStaleOneTimeReportEmailJobs,
  processDueOneTimeReportEmailJobs,
} from "./oneTimeReportEmailService.js";
import {
  reconcileStaleEmailExecutions,
  catchUpMissedEmailReports,
  normalizeCronExpression,
} from "../../scripts/scheduler.js";

const scheduleDefinitions = [
  {
    jobName: "daily-planned-recipe-email",
    label: "Daily planned recipe email (admin only)",
    cron: env.dailyPlannedRecipeCron,
    timezone: env.dailyPlannedRecipeTimezone,
    adminOnly: true,
  },
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
  {
    jobName: "marketing-list-email",
    label: "Marketing List email",
    cron: env.marketingListEmailCron,
    timezone: env.marketingListEmailTimezone,
  },
];

function computeNextLastDayOfMonthRun(minute, hour, timezone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  let year = Number(values.year);
  let month = Number(values.month);

  const buildCandidate = (y, m) => {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    return new Date(`${y}-${pad(m)}-${pad(lastDay)}T${pad(hour)}:${pad(minute)}:00+05:30`);
  };

  let candidate = buildCandidate(year, month);
  if (candidate.getTime() <= Date.now()) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    candidate = buildCandidate(year, month);
  }
  return !Number.isNaN(candidate.getTime()) ? candidate.toISOString() : null;
}

export async function runSchedulerTick({ maxJobs = 1, budgetMs = 7000 } = {}) {
  await Promise.all([
    reconcileStaleScheduledReportRuns(),
    reconcileStaleEmailExecutions(),
    reconcileStaleOneTimeReportEmailJobs(),
  ]);

  let executedCount = 0;
  let hasMoreDueJobs = false;
  const deadlineMs = Date.now() + budgetMs;

  try {
    const oneTimeOutcome = await processDueOneTimeReportEmailJobs({
      maxJobs,
      deadlineMs,
    });
    executedCount += Number(oneTimeOutcome?.executedCount || 0);
    if (oneTimeOutcome?.hasMoreDue) hasMoreDueJobs = true;

    if (Date.now() < deadlineMs) {
      const scheduledOutcome = await processDueScheduledReportJobs({
        maxJobs,
        deadlineMs,
      });
      executedCount += Number(scheduledOutcome?.executedCount || 0);
      if (scheduledOutcome?.hasMoreDue) hasMoreDueJobs = true;
    } else {
      hasMoreDueJobs = true;
    }

    if (Date.now() < deadlineMs) {
      const systemOutcome = await catchUpMissedEmailReports({
        maxJobs,
        deadlineMs,
      });
      executedCount += Number(systemOutcome?.executedCount || 0);
      if (systemOutcome?.hasMoreDue) hasMoreDueJobs = true;
    } else {
      hasMoreDueJobs = true;
    }
  } catch (pollError) {
    console.error("Scheduler tick failed", pollError);
  }

  return {
    ok: true,
    executedCount,
    hasMoreDueJobs,
  };
}

export async function getJobStatus({ page = 1, pageSize = 10, search = "", userId, isAdmin = false }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = [5, 10, 20, 50].includes(Number(pageSize)) ? Number(pageSize) : 10;
  const safeSearch = String(search || "").trim();
  const searchPattern = safeSearch ? `%${safeSearch}%` : "";
  const offset = (safePage - 1) * safePageSize;

  // IMPORTANT: On serverless deployments (Vercel), un-awaited background tasks
  // ("void ...") are frozen by the runtime the instant the HTTP response is sent,
  // leaving jobs stuck in "running" state and later timing out. Always AWAIT
  // bounded job execution before returning the HTTP response so every claimed
  // job completes cleanly within the request lifecycle.
  const tickOutcome = await runSchedulerTick({ maxJobs: 1, budgetMs: 7000 });
  const hasMoreDueJobs = Boolean(tickOutcome?.hasMoreDueJobs);

  // Older one-time report jobs and scheduled report jobs were created before
  // created_by_user_id was populated. Backfill missing creators.
  if (isAdmin && userId) {
    await q(
      `UPDATE public.one_time_report_email_jobs
          SET created_by_user_id = $1,
              updated_at = now()
        WHERE created_by_user_id IS NULL`,
      [userId],
    );
  }
  await q(
    `UPDATE public.scheduled_report_jobs
        SET created_by_user_id = owner_user_id,
            updated_at = now()
      WHERE created_by_user_id IS NULL`,
  );

  const historySql = `(
    SELECT e.id::text AS id,
           e.job_name, e.scheduled_key, e.status, e.started_at, e.completed_at,
           e.duration_ms, e.error_message,
           CASE e.job_name
             WHEN 'daily-planned-recipe-email' THEN 'Daily planned recipe email (admin only)'
             WHEN 'daily-email-report' THEN 'Daily 7-day email report'
             WHEN 'weekly-email-report' THEN 'Weekly 4-week email report'
             WHEN 'monthly-email-report' THEN 'Monthly 3-month email report'
             WHEN 'yearly-email-report' THEN 'Yearly 2-year email report'
             WHEN 'marketing-list-email' THEN 'Marketing List email'
             ELSE NULL::text
           END AS scheduled_report_name,
           NULL::text AS owner_name, NULL::text AS owner_email
      FROM public.scheduler_job_executions e
     WHERE ($1::boolean = TRUE OR e.job_name <> 'daily-planned-recipe-email')
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
      OR history.status ILIKE $3 OR history.scheduled_key ILIKE $3 OR history.error_message ILIKE $3
      OR ($1::boolean = TRUE AND (history.owner_name ILIKE $3 OR history.owner_email ILIKE $3))`;

  const [countResult, rowsResult] = await Promise.all([
    q(`SELECT COUNT(*)::int AS total
         FROM ${historySql}
        WHERE ${historyWhere}`, [
      Boolean(isAdmin),
      userId,
      searchPattern,
    ]),
    q(
      `SELECT id, job_name, scheduled_key, status, started_at, completed_at,
              duration_ms, error_message, scheduled_report_name, owner_name, owner_email
         FROM ${historySql}
        WHERE ${historyWhere}
        ORDER BY started_at DESC
        LIMIT $4 OFFSET $5`,
      [Boolean(isAdmin), userId, searchPattern, safePageSize, offset],
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

  const schedules = scheduleDefinitions.filter((item) => isAdmin || !item.adminOnly).map((item) => {
    const normalizedCron = normalizeCronExpression(item.cron);
    const valid = Boolean(normalizedCron && cron.validate(normalizedCron));
    let nextRunAt = null;
    if (valid) {
      try {
        const lastDayMatch = String(item.cron || "")
          .trim()
          .match(/^(\d+)\s+(\d+)\s+L\s+\*\s+\*$/i);
        if (lastDayMatch) {
          nextRunAt = computeNextLastDayOfMonthRun(
            Number(lastDayMatch[1]),
            Number(lastDayMatch[2]),
            item.timezone,
          );
        } else {
          const task = cron.schedule(normalizedCron, () => {}, { timezone: item.timezone });
          const nextRun = task.getNextRun();
          nextRunAt =
            nextRun instanceof Date && !Number.isNaN(nextRun.getTime())
              ? nextRun.toISOString()
              : null;
          task.stop();
          task.destroy();
        }
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
    hasMoreDueJobs,
  };
}
