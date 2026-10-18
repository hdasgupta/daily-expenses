import cron from "node-cron";
import { env } from "../src/config/env.js";
import { q } from "../src/db/index.js";
import { sendDailyEmailReportToManagers } from "../src/services/dailyEmailReportService.js";
import { sendMonthlyEmailReportToManagers } from "../src/services/monthlyEmailReportService.js";
import { sendWeeklyEmailReportToManagers } from "../src/services/weeklyEmailReportService.js";
import { sendYearlyEmailReportToManagers } from "../src/services/yearlyEmailReportService.js";
import { sendDailyPlannedRecipeEmailToAdmins } from "../src/services/dailyPlannedRecipeEmailService.js";
import { sendMarketingListForDate, nextDayIST } from "../src/controllers/marketingController.js";
import { notifyAdminFailure } from "../src/services/adminAlertService.js";

let started = false;
let activeCatchUpPromise = null;
const activeEmailJobs = new Set();

const STALE_RUNNING_SECONDS = 25;
const FAILED_RETRY_COOLDOWN_MINUTES = 5;

export function normalizeCronExpression(cronExpr) {
  const raw = String(cronExpr || "").trim();
  if (!raw) return "";
  return raw.replace(/^(\S+\s+\S+\s+)L(\s+\S+\s+\S+)$/i, "$128-31$2");
}

function getLocalDateParts(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  }).formatToParts(date);
  const mapped = Object.fromEntries(
    parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]),
  );
  if (mapped.hour === "24") {
    mapped.hour = "00";
  }
  return mapped;
}

function localDateKey(timezone, date = new Date()) {
  const { year, month, day } = getLocalDateParts(timezone, date);
  return `${year}-${month}-${day}`;
}

function isLastDayOfMonth(local) {
  const date = new Date(`${local.year}-${local.month}-${local.day}T00:00:00Z`);
  const tomorrow = new Date(date);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  return (
    tomorrow.getUTCFullYear() !== Number(local.year) ||
    tomorrow.getUTCMonth() + 1 !== Number(local.month)
  );
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

export async function reconcileStaleEmailExecutions() {
  try {
    await q(
      `UPDATE public.scheduler_job_executions
          SET status = 'failed',
              completed_at = now() - ($1::int * INTERVAL '1 minute'),
              duration_ms = COALESCE(
                duration_ms,
                GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int)
              ),
              error_message = COALESCE(
                error_message,
                'Execution interrupted or timed out before completion'
              )
        WHERE status = 'running'
          AND started_at < now() - ($2::int * INTERVAL '1 second')`,
      [FAILED_RETRY_COOLDOWN_MINUTES + 1, STALE_RUNNING_SECONDS],
    );
  } catch (error) {
    console.error("Failed to reconcile stale email scheduler executions", {
      error: error?.message || String(error),
      stack: error?.stack,
    });
  }
}

async function claimJobExecution(jobName, scheduledKey) {
  const result = await q(
    `INSERT INTO public.scheduler_job_executions
      (job_name, scheduled_key, status, started_at, completed_at, duration_ms, error_message)
     VALUES ($1, $2, 'running', now(), NULL, NULL, NULL)
     ON CONFLICT (job_name, scheduled_key) WHERE scheduled_key IS NOT NULL
     DO UPDATE
       SET status = 'running',
           started_at = now(),
           completed_at = NULL,
           duration_ms = NULL,
           error_message = NULL
     WHERE public.scheduler_job_executions.status NOT IN ('completed', 'skipped')
       AND (
         public.scheduler_job_executions.status <> 'running'
         OR public.scheduler_job_executions.started_at < now() - ($3::int * INTERVAL '1 second')
       )
       AND (
         public.scheduler_job_executions.status <> 'failed'
         OR public.scheduler_job_executions.error_message = 'Execution interrupted or timed out before completion'
         OR COALESCE(
              public.scheduler_job_executions.completed_at,
              public.scheduler_job_executions.started_at
            ) <= now() - ($4::int * INTERVAL '1 minute')
       )
     RETURNING id`,
    [jobName, scheduledKey, STALE_RUNNING_SECONDS, FAILED_RETRY_COOLDOWN_MINUTES],
  );
  return result.rows[0]?.id || null;
}

async function markJobCompleted(executionId, durationMs, status = "completed", details = null) {
  await q(
    `UPDATE public.scheduler_job_executions
     SET status = $3,
         completed_at = now(),
         duration_ms = $2,
         error_message = $4
     WHERE id = $1`,
    [executionId, durationMs, status, details],
  );
}

async function markJobFailed(executionId, durationMs, error) {
  await q(
    `UPDATE public.scheduler_job_executions
     SET status = 'failed',
         completed_at = now(),
         duration_ms = $2,
         error_message = $3
     WHERE id = $1`,
    [executionId, durationMs, error?.message || String(error)],
  );
}

function timezoneForJob(jobName) {
  if (jobName === "daily-planned-recipe-email") return env.dailyPlannedRecipeTimezone;
  if (jobName === "daily-email-report") return env.dailyEmailReportTimezone;
  if (jobName === "monthly-email-report") return env.monthlyEmailReportTimezone;
  if (jobName === "yearly-email-report") return env.yearlyEmailReportTimezone;
  if (jobName === "marketing-list-email") return env.marketingListEmailTimezone;
  return env.weeklyEmailReportTimezone;
}

async function runEmailJobOnce(jobName, scheduledKey, send) {
  const lockKey = `${jobName}:${scheduledKey}`;
  if (activeEmailJobs.has(lockKey)) {
    logSchedulerEvent("scheduler_job_skipped_locked", { jobName, scheduledKey });
    return false;
  }

  activeEmailJobs.add(lockKey);
  const timezone = timezoneForJob(jobName);

  logSchedulerEvent("scheduler_job_started", {
    jobName,
    scheduledKey,
    timezone,
    localTime: getLocalDateParts(timezone),
  });

  let executionId = null;
  const startedAt = Date.now();

  try {
    await reconcileStaleEmailExecutions();

    executionId = await claimJobExecution(jobName, scheduledKey);
    if (!executionId) {
      logSchedulerEvent("scheduler_job_skipped_already_completed_or_cooldown", {
        jobName,
        scheduledKey,
      });
      return false;
    }

    logSchedulerEvent("scheduler_execution_started", {
      jobName,
      scheduledKey,
      executionId,
    });

    const result = await send();
    const durationMs = Math.max(0, Date.now() - startedAt);
    const executionStatus = result?.skipped ? "skipped" : "completed";
    await markJobCompleted(executionId, durationMs, executionStatus, result?.reason || null);

    logSchedulerEvent(
      executionStatus === "skipped" ? "scheduler_job_skipped" : "scheduler_job_completed",
      {
        jobName,
        scheduledKey,
        executionId,
        durationMs,
        result,
      },
    );
    return result;
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    if (executionId) {
      try {
        await markJobFailed(executionId, durationMs, error);
      } catch (markError) {
        console.error("Failed to record email job failure in database", {
          jobName,
          scheduledKey,
          executionId,
          error: markError?.message || String(markError),
        });
      }
    }

    logSchedulerEvent("scheduler_job_failed", {
      jobName,
      scheduledKey,
      executionId,
      durationMs,
      error: error?.message || String(error),
      stack: error?.stack,
    });

    void notifyAdminFailure({
      category: "default-scheduler-email",
      schedulerType: jobName,
      failureTime: new Date().toISOString(),
      failureMessage: error?.message || String(error),
      stack: error?.stack,
    }).catch(() => {});
    throw error;
  } finally {
    activeEmailJobs.delete(lockKey);
  }
}

async function runDailyEmailReport(customScheduledKey = null) {
  const scheduledKey = customScheduledKey || localDateKey(env.dailyEmailReportTimezone);
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
  return Boolean(result);
}

async function runDailyPlannedRecipeEmail(customScheduledKey = null) {
  const scheduledKey = customScheduledKey || localDateKey(env.dailyPlannedRecipeTimezone);
  return runEmailJobOnce("daily-planned-recipe-email", scheduledKey, () =>
    sendDailyPlannedRecipeEmailToAdmins(scheduledKey),
  );
}

async function runMarketingListEmail(customPurchaseDate = null) {
  const purchaseDate = customPurchaseDate || nextDayIST();
  const scheduledKey = `marketing-list-email:${purchaseDate}`;
  return runEmailJobOnce("marketing-list-email", scheduledKey, () =>
    sendMarketingListForDate(purchaseDate),
  );
}

async function runMonthlyEmailReport(customScheduledKey = null) {
  if (!customScheduledKey) {
    const local = getLocalDateParts(env.monthlyEmailReportTimezone);
    if (!isLastDayOfMonth(local)) {
      logSchedulerEvent("monthly_email_report_skipped_not_last_day", {
        local,
        cron: env.monthlyEmailReportCron,
      });
      return false;
    }
    customScheduledKey = `${local.year}-${local.month}`;
  }
  const result = await runEmailJobOnce(
    "monthly-email-report",
    customScheduledKey,
    sendMonthlyEmailReportToManagers,
  );
  if (result) {
    console.log(
      `3-month email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
    );
  }
  return Boolean(result);
}

async function runYearlyEmailReport(customScheduledKey = null) {
  if (!customScheduledKey) {
    const local = getLocalDateParts(env.yearlyEmailReportTimezone);
    if (local.month !== "12" || local.day !== "31") {
      logSchedulerEvent("yearly_email_report_skipped_not_december_31", { local });
      return false;
    }
    customScheduledKey = `${local.year}`;
  }
  const result = await runEmailJobOnce(
    "yearly-email-report",
    customScheduledKey,
    sendYearlyEmailReportToManagers,
  );
  if (result) {
    console.log(
      `2-year email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
    );
  }
  return Boolean(result);
}

async function runWeeklyEmailReport(customScheduledKey = null) {
  if (!customScheduledKey) {
    const local = getLocalDateParts(env.weeklyEmailReportTimezone);
    if (local.weekday !== undefined && local.weekday !== "Saturday") {
      logSchedulerEvent("weekly_email_report_skipped_not_saturday", { local });
      return false;
    }
    customScheduledKey = localDateKey(env.weeklyEmailReportTimezone);
  }
  const result = await runEmailJobOnce(
    "weekly-email-report",
    customScheduledKey,
    sendWeeklyEmailReportToManagers,
  );
  if (result) {
    console.log(
      `4-week email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
    );
  }
  return Boolean(result);
}

async function retryRecentFailedSystemJobs({ maxJobs = Infinity, deadlineMs = Infinity } = {}) {
  let executedCount = 0;
  let hasMoreDue = false;

  const failed = await q(
    `SELECT job_name, scheduled_key
       FROM public.scheduler_job_executions
      WHERE status = 'failed'
        AND scheduled_key IS NOT NULL
        AND started_at >= now() - INTERVAL '48 hours'
        AND (
          error_message = 'Execution interrupted or timed out before completion'
          OR COALESCE(completed_at, started_at) <= now() - ($1::int * INTERVAL '1 minute')
        )
      ORDER BY started_at DESC`,
    [FAILED_RETRY_COOLDOWN_MINUTES],
  );

  for (const row of failed.rows) {
    if (executedCount >= maxJobs || Date.now() >= deadlineMs) {
      hasMoreDue = true;
      break;
    }

    try {
      let ran = false;
      if (row.job_name === "daily-email-report") {
        ran = Boolean(await runDailyEmailReport(row.scheduled_key));
      } else if (row.job_name === "daily-planned-recipe-email") {
        ran = Boolean(await runDailyPlannedRecipeEmail(row.scheduled_key));
      } else if (row.job_name === "weekly-email-report") {
        ran = Boolean(await runWeeklyEmailReport(row.scheduled_key));
      } else if (row.job_name === "monthly-email-report") {
        ran = Boolean(await runMonthlyEmailReport(row.scheduled_key));
      } else if (row.job_name === "yearly-email-report") {
        ran = Boolean(await runYearlyEmailReport(row.scheduled_key));
      } else if (row.job_name === "marketing-list-email") {
        const purchaseDate = String(row.scheduled_key).replace(/^marketing-list-email:/, "");
        ran = Boolean(await runMarketingListEmail(purchaseDate));
      }
      if (ran) executedCount += 1;
    } catch (error) {
      console.error(`Failed retry for system job ${row.job_name} (${row.scheduled_key})`, error);
    }
  }

  return { executedCount, hasMoreDue };
}

export async function catchUpMissedEmailReports({ maxJobs = Infinity, deadlineMs = Infinity } = {}) {
  if (activeCatchUpPromise) {
    return activeCatchUpPromise;
  }

  activeCatchUpPromise = (async () => {
    let executedCount = 0;
    let hasMoreDue = false;

    try {
      await reconcileStaleEmailExecutions();
      const retryOutcome = await retryRecentFailedSystemJobs({ maxJobs, deadlineMs });
      executedCount += retryOutcome.executedCount;
      if (retryOutcome.hasMoreDue) {
        hasMoreDue = true;
        return { executedCount, hasMoreDue };
      }

      const recipeLocal = getLocalDateParts(env.dailyPlannedRecipeTimezone);
      const recipeHour = Number(recipeLocal.hour === "24" ? 0 : recipeLocal.hour);
      if (recipeHour >= 6 && executedCount < maxJobs && Date.now() < deadlineMs) {
        try {
          const ran = await runDailyPlannedRecipeEmail();
          if (ran) executedCount += 1;
        } catch (error) {
          console.error("Missed daily planned recipe email catch-up failed", error);
        }
      }

      const dailyLocal = getLocalDateParts(env.dailyEmailReportTimezone);
      const dailyHour = Number(dailyLocal.hour === "24" ? 0 : dailyLocal.hour);
      const dailyMinute = Number(dailyLocal.minute);

      if (dailyHour === 23 && dailyMinute >= 59 && executedCount < maxJobs && Date.now() < deadlineMs) {
        try {
          const ran = await runDailyEmailReport();
          if (ran) executedCount += 1;
        } catch (error) {
          console.error("Missed 7-day email report catch-up failed", error);
        }
        if (executedCount < maxJobs && Date.now() < deadlineMs) {
          try {
            const ran = await runMarketingListEmail();
            if (ran) executedCount += 1;
          } catch (error) {
            console.error("Missed marketing list email catch-up failed", error);
          }
        }
      }

      const weeklyLocal = getLocalDateParts(env.weeklyEmailReportTimezone);
      const weeklyHour = Number(weeklyLocal.hour === "24" ? 0 : weeklyLocal.hour);
      const weeklyMinute = Number(weeklyLocal.minute);
      if (
        weeklyLocal.weekday === "Saturday" &&
        weeklyHour === 23 &&
        weeklyMinute >= 59 &&
        executedCount < maxJobs &&
        Date.now() < deadlineMs
      ) {
        try {
          const ran = await runWeeklyEmailReport();
          if (ran) executedCount += 1;
        } catch (error) {
          console.error("Missed 4-week email report catch-up failed", error);
        }
      }

      const yearlyLocal = getLocalDateParts(env.yearlyEmailReportTimezone);
      const yearlyHour = Number(yearlyLocal.hour === "24" ? 0 : yearlyLocal.hour);
      const yearlyMinute = Number(yearlyLocal.minute);
      if (
        yearlyLocal.month === "12" &&
        yearlyLocal.day === "31" &&
        yearlyHour === 23 &&
        yearlyMinute >= 59 &&
        executedCount < maxJobs &&
        Date.now() < deadlineMs
      ) {
        try {
          const ran = await runYearlyEmailReport();
          if (ran) executedCount += 1;
        } catch (error) {
          console.error("Missed 2-year email report catch-up failed", error);
        }
      }

      const monthlyLocal = getLocalDateParts(env.monthlyEmailReportTimezone);
      const monthlyHour = Number(monthlyLocal.hour === "24" ? 0 : monthlyLocal.hour);
      const monthlyMinute = Number(monthlyLocal.minute);
      if (
        isLastDayOfMonth(monthlyLocal) &&
        monthlyHour === 23 &&
        monthlyMinute >= 59 &&
        executedCount < maxJobs &&
        Date.now() < deadlineMs
      ) {
        try {
          const ran = await runMonthlyEmailReport();
          if (ran) executedCount += 1;
        } catch (error) {
          console.error("Missed 3-month email report catch-up failed", error);
        }
      }
    } finally {
      activeCatchUpPromise = null;
    }

    return { executedCount, hasMoreDue };
  })();

  return activeCatchUpPromise;
}

export function startEmailSchedulers() {
  if (started) return;
  started = true;

  logSchedulerEvent("scheduler_starting", {
    serverTime: new Date().toISOString(),
    dailyEmailReportCron: env.dailyEmailReportCron,
    dailyPlannedRecipeCron: env.dailyPlannedRecipeCron,
    dailyPlannedRecipeTimezone: env.dailyPlannedRecipeTimezone,
    dailyEmailReportTimezone: env.dailyEmailReportTimezone,
    monthlyEmailReportCron: env.monthlyEmailReportCron,
    monthlyEmailReportTimezone: env.monthlyEmailReportTimezone,
    weeklyEmailReportCron: env.weeklyEmailReportCron,
    weeklyEmailReportTimezone: env.weeklyEmailReportTimezone,
    yearlyEmailReportCron: env.yearlyEmailReportCron,
    yearlyEmailReportTimezone: env.yearlyEmailReportTimezone,
    marketingListEmailCron: env.marketingListEmailCron,
    marketingListEmailTimezone: env.marketingListEmailTimezone,
  });

  const dailyCron = normalizeCronExpression(env.dailyEmailReportCron);
  if (!cron.validate(dailyCron)) {
    console.error(`Invalid DAILY_EMAIL_REPORT_CRON: ${env.dailyEmailReportCron}`);
  } else {
    cron.schedule(
      dailyCron,
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

  const recipeCron = normalizeCronExpression(env.dailyPlannedRecipeCron);
  if (!cron.validate(recipeCron)) {
    console.error(`Invalid DAILY_PLANNED_RECIPE_CRON: ${env.dailyPlannedRecipeCron}`);
  } else {
    cron.schedule(
      recipeCron,
      async () => {
        logSchedulerEvent("daily_planned_recipe_email_triggered", {
          cron: env.dailyPlannedRecipeCron,
          timezone: env.dailyPlannedRecipeTimezone,
          localTime: getLocalDateParts(env.dailyPlannedRecipeTimezone),
        });
        try {
          const result = await runDailyPlannedRecipeEmail();
          if (result && !result.skipped) {
            console.log(`Daily planned recipe email sent to ${result.recipients} admin(s)`);
          }
        } catch (error) {
          console.error("Daily planned recipe email job failed", error);
        }
      },
      { timezone: env.dailyPlannedRecipeTimezone },
    );
    console.log(
      `Daily planned recipe email scheduler enabled: ${env.dailyPlannedRecipeCron} (${env.dailyPlannedRecipeTimezone})`,
    );
  }

  const weeklyCron = normalizeCronExpression(env.weeklyEmailReportCron);
  if (!cron.validate(weeklyCron)) {
    console.error(`Invalid WEEKLY_EMAIL_REPORT_CRON: ${env.weeklyEmailReportCron}`);
  } else {
    cron.schedule(
      weeklyCron,
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

  const monthlyCron = normalizeCronExpression(env.monthlyEmailReportCron);
  if (!cron.validate(monthlyCron)) {
    console.error(`Invalid MONTHLY_EMAIL_REPORT_CRON: ${env.monthlyEmailReportCron}`);
  } else {
    cron.schedule(
      monthlyCron,
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

  const yearlyCron = normalizeCronExpression(env.yearlyEmailReportCron);
  if (!cron.validate(yearlyCron)) {
    console.error(`Invalid YEARLY_EMAIL_REPORT_CRON: ${env.yearlyEmailReportCron}`);
  } else {
    cron.schedule(
      yearlyCron,
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

  const marketingCron = normalizeCronExpression(env.marketingListEmailCron);
  if (!cron.validate(marketingCron)) {
    console.error(`Invalid MARKETING_LIST_EMAIL_CRON: ${env.marketingListEmailCron}`);
  } else {
    cron.schedule(
      marketingCron,
      async () => {
        logSchedulerEvent("marketing_list_email_triggered", {
          cron: env.marketingListEmailCron,
          timezone: env.marketingListEmailTimezone,
          localTime: getLocalDateParts(env.marketingListEmailTimezone),
        });
        try {
          await runMarketingListEmail();
        } catch (error) {
          console.error("Marketing list email job failed", error);
        }
      },
      { timezone: env.marketingListEmailTimezone },
    );
    console.log(
      `Marketing list email scheduler enabled: ${env.marketingListEmailCron} (${env.marketingListEmailTimezone})`,
    );
  }

  cron.schedule(
    "*/5 * * * *",
    async () => {
      try {
        await catchUpMissedEmailReports();
      } catch (error) {
        console.error("Periodic email scheduler recovery check failed", error);
      }
    },
    { timezone: "Asia/Kolkata" },
  );

  void catchUpMissedEmailReports();
}
