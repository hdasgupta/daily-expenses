import cron from "node-cron";
import { env } from "../src/config/env.js";
import { pool } from "../src/db/index.js";
import { sendDailyEmailReportToManagers } from "../src/services/dailyEmailReportService.js";
import { sendMonthlyEmailReportToManagers } from "../src/services/monthlyEmailReportService.js";
import { sendWeeklyEmailReportToManagers } from "../src/services/weeklyEmailReportService.js";

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
      (job_name, scheduled_key, status, started_at)
     VALUES ($1, $2, 'running', now())
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
          : env.weeklyEmailReportTimezone,
    localTime:
      jobName === "daily-email-report"
        ? getLocalDateParts(env.dailyEmailReportTimezone)
        : jobName === "monthly-email-report"
          ? getLocalDateParts(env.monthlyEmailReportTimezone)
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
    Number(dailyLocal.hour) > 11 ||
    (Number(dailyLocal.hour) === 11 && Number(dailyLocal.minute) >= 10)
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

  void catchUpMissedEmailReports();
}
