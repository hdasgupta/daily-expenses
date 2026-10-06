import cron from "node-cron";
import { env } from "../src/config/env.js";
import { pool } from "../src/db/index.js";
import { sendDailyEmailReportToManagers } from "../src/services/dailyEmailReportService.js";
import { sendMonthlyEmailReportToManagers } from "../src/services/monthlyEmailReportService.js";
import { sendWeeklyEmailReportToManagers } from "../src/services/weeklyEmailReportService.js";
import { sendYearlyEmailReportToManagers } from "../src/services/yearlyEmailReportService.js";
import { notifyAdminFailure } from "../src/services/adminAlertService.js";

let started = false;

function getLocalDateParts(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hour12: false,
  }).formatToParts(new Date());
  return Object.fromEntries(
    parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]),
  );
}

function localDateKey(timezone) {
  const { year, month, day } = getLocalDateParts(timezone);
  return `${year}-${month}-${day}`;
}

function logSchedulerEvent(event, details = {}) {
  console.log(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

async function markJobStarted(client, jobName, scheduledKey) {
  const result = await client.query(
    `INSERT INTO public.scheduler_job_executions
      (job_name, scheduled_key, status, started_at, completed_at, duration_ms, error_message)
     VALUES ($1, $2, 'running', now(), NULL, NULL, NULL)
     ON CONFLICT (job_name, scheduled_key) DO UPDATE
       SET status = 'running',
           started_at = now(),
           completed_at = NULL,
           duration_ms = NULL,
           error_message = NULL
     RETURNING id`,
    [jobName, scheduledKey],
  );
  return result.rows[0]?.id;
}

async function markJobCompleted(client, executionId, durationMs) {
  await client.query(
    `UPDATE public.scheduler_job_executions
     SET status = 'completed',
         completed_at = now(),
         duration_ms = $2,
         error_message = NULL
     WHERE id = $1`,
    [executionId, durationMs],
  );
}

async function markJobFailed(client, executionId, durationMs, error) {
  await client.query(
    `UPDATE public.scheduler_job_executions
     SET status = 'failed',
         completed_at = now(),
         duration_ms = $2,
         error_message = $3
     WHERE id = $1`,
    [executionId, durationMs, error?.message || String(error)],
  );
}

async function runEmailJobOnce(jobName, scheduledKey, send) {
  const client = await pool.connect();
  const lockKey = `${jobName}:${scheduledKey}`;

  logSchedulerEvent("scheduler_job_started", {
    jobName,
    scheduledKey,
    timezone:
      jobName === "daily-email-report"
        ? env.dailyEmailReportTimezone
        : jobName === "monthly-email-report"
          ? env.monthlyEmailReportTimezone
          : jobName === "yearly-email-report"
            ? env.yearlyEmailReportTimezone
            : env.weeklyEmailReportTimezone,
    localTime:
      jobName === "daily-email-report"
        ? getLocalDateParts(env.dailyEmailReportTimezone)
        : jobName === "monthly-email-report"
          ? getLocalDateParts(env.monthlyEmailReportTimezone)
          : jobName === "yearly-email-report"
            ? getLocalDateParts(env.yearlyEmailReportTimezone)
            : getLocalDateParts(env.weeklyEmailReportTimezone),
  });

  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [
      lockKey,
    ]);
    if (!lockResult.rows[0].locked) {
      logSchedulerEvent("scheduler_job_skipped_locked", { jobName, scheduledKey });
      return false;
    }

    // A scheduled period is idempotent: once every manager email for this
    // execution has completed successfully, later cron ticks/catch-up runs
    // must never send the same report again. Failed executions remain retryable.
    const completedResult = await client.query(
      `SELECT id, completed_at
       FROM public.scheduler_job_executions
       WHERE job_name = $1
         AND scheduled_key = $2
         AND status = 'completed'
       ORDER BY completed_at DESC NULLS LAST
       LIMIT 1`,
      [jobName, scheduledKey],
    );
    if (completedResult.rows.length > 0) {
      logSchedulerEvent("scheduler_job_skipped_already_completed", {
        jobName,
        scheduledKey,
        executionId: completedResult.rows[0].id,
        completedAt: completedResult.rows[0].completed_at,
      });
      return false;
    }

    try {
      const executionId = await markJobStarted(client, jobName, scheduledKey);
      const startedAt = Date.now();

      logSchedulerEvent("scheduler_execution_started", {
        jobName,
        scheduledKey,
        executionId,
      });

      try {
        const result = await send();
        const durationMs = Date.now() - startedAt;
        await markJobCompleted(client, executionId, durationMs);

        logSchedulerEvent("scheduler_job_completed", {
          jobName,
          scheduledKey,
          executionId,
          durationMs,
          result,
        });
        return result;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        await markJobFailed(client, executionId, durationMs, error);

        logSchedulerEvent("scheduler_job_failed", {
          jobName,
          scheduledKey,
          executionId,
          durationMs,
          error: error?.message || String(error),
          stack: error?.stack,
        });
        throw error;
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    }
  } catch (error) {
    await notifyAdminFailure({
      category: "default-scheduler-email",
      schedulerType: jobName,
      failureTime: new Date().toISOString(),
      failureMessage: error?.message || String(error),
      stack: error?.stack,
    });
    throw error;
  } finally {
    client.release();
  }
}

async function runDailyEmailReport() {
  const scheduledKey = localDateKey(env.dailyEmailReportTimezone);
  const result = await runEmailJobOnce(
    "daily-email-report",
    scheduledKey,
    sendDailyEmailReportToManagers,
  );
  if (result) {
    console.log(
      `7-day email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
    );
  }
}

async function runMonthlyEmailReport() {
  const local = getLocalDateParts(env.monthlyEmailReportTimezone);
  if (local.day !== "01") {
    logSchedulerEvent("monthly_email_report_skipped_not_first_day", { local });
    return;
  }
  const scheduledKey = `${local.year}-${local.month}`;
  const result = await runEmailJobOnce(
    "monthly-email-report",
    scheduledKey,
    sendMonthlyEmailReportToManagers,
  );
  if (result) {
    console.log(
      `3-month email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
    );
  }
}

async function runYearlyEmailReport() {
  const local = getLocalDateParts(env.yearlyEmailReportTimezone);
  if (local.month !== "01" || local.day !== "01") {
    logSchedulerEvent("yearly_email_report_skipped_not_january_first", { local });
    return;
  }
  const scheduledKey = `${local.year}`;
  const result = await runEmailJobOnce(
    "yearly-email-report",
    scheduledKey,
    sendYearlyEmailReportToManagers,
  );
  if (result) {
    console.log(
      `2-year email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
    );
  }
}

async function runWeeklyEmailReport() {
  const local = getLocalDateParts(env.weeklyEmailReportTimezone);
  if (local.weekday !== undefined && local.weekday !== "Sunday") {
    logSchedulerEvent("weekly_email_report_skipped_not_sunday", { local });
    return;
  }
  const scheduledKey = localDateKey(env.weeklyEmailReportTimezone);
  const result = await runEmailJobOnce(
    "weekly-email-report",
    scheduledKey,
    sendWeeklyEmailReportToManagers,
  );
  if (result) {
    console.log(
      `4-week email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
    );
  }
}

async function catchUpMissedEmailReports() {
  const dailyLocal = getLocalDateParts(env.dailyEmailReportTimezone);
  logSchedulerEvent("scheduler_catchup_check", {
    dailyLocal,
    dailyCron: env.dailyEmailReportCron,
    dailyTimezone: env.dailyEmailReportTimezone,
  });

  if (
    Number(dailyLocal.hour) > 6 ||
    (Number(dailyLocal.hour) === 6 && Number(dailyLocal.minute) >= 0)
  ) {
    try {
      await runDailyEmailReport();
    } catch (error) {
      console.error("Missed 7-day email report catch-up failed", error);
    }
  }

  const weeklyLocal = getLocalDateParts(env.weeklyEmailReportTimezone);
  if (
    weeklyLocal.weekday === "Sunday" &&
    (Number(weeklyLocal.hour) > 6 ||
      (Number(weeklyLocal.hour) === 6 && Number(weeklyLocal.minute) >= 0))
  ) {
    try {
      await runWeeklyEmailReport();
    } catch (error) {
      console.error("Missed 4-week email report catch-up failed", error);
    }
  }

  const yearlyLocal = getLocalDateParts(env.yearlyEmailReportTimezone);
  if (yearlyLocal.month === "01" && yearlyLocal.day === "01" && Number(yearlyLocal.hour) >= 6) {
    try {
      await runYearlyEmailReport();
    } catch (error) {
      console.error("Missed 2-year email report catch-up failed", error);
    }
  }

  const monthlyLocal = getLocalDateParts(env.monthlyEmailReportTimezone);
  if (monthlyLocal.day === "01" && Number(monthlyLocal.hour) >= 6) {
    try {
      await runMonthlyEmailReport();
    } catch (error) {
      console.error("Missed 3-month email report catch-up failed", error);
    }
  }
}

export function startEmailSchedulers() {
  if (started) return;
  started = true;

  logSchedulerEvent("scheduler_starting", {
    serverTime: new Date().toISOString(),
    dailyEmailReportCron: env.dailyEmailReportCron,
    dailyEmailReportTimezone: env.dailyEmailReportTimezone,
    monthlyEmailReportCron: env.monthlyEmailReportCron,
    monthlyEmailReportTimezone: env.monthlyEmailReportTimezone,
    weeklyEmailReportCron: env.weeklyEmailReportCron,
    weeklyEmailReportTimezone: env.weeklyEmailReportTimezone,
    yearlyEmailReportCron: env.yearlyEmailReportCron,
    yearlyEmailReportTimezone: env.yearlyEmailReportTimezone,
  });

  if (!cron.validate(env.dailyEmailReportCron)) {
    console.error(`Invalid DAILY_EMAIL_REPORT_CRON: ${env.dailyEmailReportCron}`);
  } else {
    cron.schedule(
      env.dailyEmailReportCron,
      async () => {
        logSchedulerEvent("daily_email_report_triggered", {
          cron: env.dailyEmailReportCron,
          timezone: env.dailyEmailReportTimezone,
          localTime: getLocalDateParts(env.dailyEmailReportTimezone),
        });
        try {
          await runDailyEmailReport();
        } catch (error) {
          console.error("7-day email report job failed", error);
        }
      },
      { timezone: env.dailyEmailReportTimezone },
    );
    console.log(
      `7-day email report scheduler enabled: ${env.dailyEmailReportCron} (${env.dailyEmailReportTimezone})`,
    );
  }

  if (!cron.validate(env.weeklyEmailReportCron)) {
    console.error(`Invalid WEEKLY_EMAIL_REPORT_CRON: ${env.weeklyEmailReportCron}`);
  } else {
    cron.schedule(
      env.weeklyEmailReportCron,
      async () => {
        logSchedulerEvent("weekly_email_report_triggered", {
          cron: env.weeklyEmailReportCron,
          timezone: env.weeklyEmailReportTimezone,
          localTime: getLocalDateParts(env.weeklyEmailReportTimezone),
        });
        try {
          await runWeeklyEmailReport();
        } catch (error) {
          console.error("4-week email report job failed", error);
        }
      },
      { timezone: env.weeklyEmailReportTimezone },
    );
    console.log(
      `4-week email report scheduler enabled: ${env.weeklyEmailReportCron} (${env.weeklyEmailReportTimezone})`,
    );
  }

  if (!cron.validate(env.monthlyEmailReportCron)) {
    console.error(`Invalid MONTHLY_EMAIL_REPORT_CRON: ${env.monthlyEmailReportCron}`);
  } else {
    cron.schedule(
      env.monthlyEmailReportCron,
      async () => {
        logSchedulerEvent("monthly_email_report_triggered", {
          cron: env.monthlyEmailReportCron,
          timezone: env.monthlyEmailReportTimezone,
          localTime: getLocalDateParts(env.monthlyEmailReportTimezone),
        });
        try {
          await runMonthlyEmailReport();
        } catch (error) {
          console.error("3-month email report job failed", error);
        }
      },
      { timezone: env.monthlyEmailReportTimezone },
    );
    console.log(
      `3-month email report scheduler enabled: ${env.monthlyEmailReportCron} (${env.monthlyEmailReportTimezone})`,
    );
  }

  if (!cron.validate(env.yearlyEmailReportCron)) {
    console.error(`Invalid YEARLY_EMAIL_REPORT_CRON: ${env.yearlyEmailReportCron}`);
  } else {
    cron.schedule(
      env.yearlyEmailReportCron,
      async () => {
        logSchedulerEvent("yearly_email_report_triggered", {
          cron: env.yearlyEmailReportCron,
          timezone: env.yearlyEmailReportTimezone,
          localTime: getLocalDateParts(env.yearlyEmailReportTimezone),
        });
        try {
          await runYearlyEmailReport();
        } catch (error) {
          console.error("2-year email report job failed", error);
        }
      },
      { timezone: env.yearlyEmailReportTimezone },
    );
    console.log(
      `2-year email report scheduler enabled: ${env.yearlyEmailReportCron} (${env.yearlyEmailReportTimezone})`,
    );
  }

  void catchUpMissedEmailReports();
}
