import cron from "node-cron";
import { env } from "../src/config/env.js";
import { pool } from "../src/db/index.js";
import { sendDashboardToManagers } from "../src/services/dashboardService.js";
import { sendDailyEmailReportToManagers } from "../src/services/dailyEmailReportService.js";
import { sendMonthlyEmailReportToManagers } from "../src/services/monthlyEmailReportService.js";

let started = false;

function getLocalDateParts(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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

async function runEmailJobOnce(jobName, scheduledKey, send) {
  const client = await pool.connect();
  const lockKey = `${jobName}:${scheduledKey}`;

  logSchedulerEvent("scheduler_job_started", {
    jobName,
    scheduledKey,
    timezone:
      jobName === "daily-email-report"
        ? env.dailyEmailReportTimezone
        : env.monthlyEmailReportTimezone,
    localTime:
      jobName === "daily-email-report"
        ? getLocalDateParts(env.dailyEmailReportTimezone)
        : getLocalDateParts(env.monthlyEmailReportTimezone),
  });

  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [lockKey],
    );
    if (!lockResult.rows[0].locked) {
      logSchedulerEvent("scheduler_job_skipped_locked", { jobName, scheduledKey });
      return false;
    }

    try {
      const existing = await client.query(
        "SELECT 1 FROM public.scheduler_job_runs WHERE job_name = $1 AND scheduled_key = $2",
        [jobName, scheduledKey],
      );
      if (existing.rowCount) {
        logSchedulerEvent("scheduler_job_skipped_already_completed", {
          jobName,
          scheduledKey,
        });
        return false;
      }

      const startedAt = Date.now();
      try {
        const result = await send();
        await client.query(
          `INSERT INTO public.scheduler_job_runs (job_name, scheduled_key, completed_at)
           VALUES ($1, $2, now())
           ON CONFLICT (job_name, scheduled_key) DO NOTHING`,
          [jobName, scheduledKey],
        );
        logSchedulerEvent("scheduler_job_completed", {
          jobName,
          scheduledKey,
          durationMs: Date.now() - startedAt,
          result,
        });
        return result;
      } catch (error) {
        logSchedulerEvent("scheduler_job_failed", {
          jobName,
          scheduledKey,
          durationMs: Date.now() - startedAt,
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

  const monthlyLocal = getLocalDateParts(env.monthlyEmailReportTimezone);
  if (monthlyLocal.day === "01" && Number(monthlyLocal.hour) >= 6) {
    try {
      await runMonthlyEmailReport();
    } catch (error) {
      console.error("Missed 3-month email report catch-up failed", error);
    }
  }
}

export function startDashboardScheduler() {
  if (started) return;
  started = true;

  logSchedulerEvent("scheduler_starting", {
    serverTime: new Date().toISOString(),
    dashboardCron: env.dashboardCron,
    dashboardTimezone: env.dashboardTimezone,
    dailyEmailReportCron: env.dailyEmailReportCron,
    dailyEmailReportTimezone: env.dailyEmailReportTimezone,
    monthlyEmailReportCron: env.monthlyEmailReportCron,
    monthlyEmailReportTimezone: env.monthlyEmailReportTimezone,
  });

  if (!cron.validate(env.dashboardCron)) {
    console.error(`Invalid DASHBOARD_CRON: ${env.dashboardCron}`);
  } else {
    cron.schedule(
      env.dashboardCron,
      async () => {
        logSchedulerEvent("dashboard_job_triggered", {
          cron: env.dashboardCron,
          timezone: env.dashboardTimezone,
          localTime: getLocalDateParts(env.dashboardTimezone),
        });
        try {
          const result = await sendDashboardToManagers();
          console.log(`Dashboard job sent to ${result.recipients} manager(s)`);
        } catch (error) {
          console.error("Dashboard job failed", error);
        }
      },
      { timezone: env.dashboardTimezone },
    );
    console.log(`Dashboard scheduler enabled: ${env.dashboardCron} (${env.dashboardTimezone})`);
  }

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
