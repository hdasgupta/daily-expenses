import cron from "node-cron";
import { q } from "../db/index.js";
import {
  getScheduledReportForExecution,
  sendScheduledReportJob,
} from "./scheduledReportService.js";
import { notifyAdminFailure } from "./adminAlertService.js";

let started = false;
let isPolling = false;
const activeJobLocks = new Set();

const STALE_RUNNING_MINUTES = 5;
const FAILED_RETRY_COOLDOWN_MINUTES = 5;

const WEEKDAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function localParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const mapped = Object.fromEntries(
    parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]),
  );

  if (mapped.hour === "24") {
    mapped.hour = "00";
  }

  return mapped;
}

function dueFor(job, local) {
  const [hour, minute] = String(job.time_of_day || "00:00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);

  const currentHour = Number(local.hour === "24" ? 0 : local.hour);
  const currentMinute = Number(local.minute);
  const currentMinutes = currentHour * 60 + currentMinute;
  const scheduledMinutes = hour * 60 + minute;

  if (currentMinutes < scheduledMinutes) return false;

  if (job.frequency === "daily") return true;

  if (job.frequency === "weekly") {
    const weekday =
      local.weekday in WEEKDAY_INDEX
        ? WEEKDAY_INDEX[local.weekday]
        : new Date(`${local.year}-${local.month}-${local.day}T00:00:00Z`).getUTCDay();
    return Number(weekday) === Number(job.day_of_week);
  }

  if (job.frequency === "monthly") {
    return Number(local.day) === Number(job.day_of_month);
  }

  if (job.frequency === "yearly") {
    return (
      Number(local.month) === Number(job.month_of_year) &&
      Number(local.day) === Number(job.day_of_month)
    );
  }

  return false;
}

function scheduledKey(job, local) {
  if (job.frequency === "daily") {
    return `${local.year}-${local.month}-${local.day}`;
  }

  if (job.frequency === "weekly") {
    // Weekly jobs are keyed by their scheduled weekday/date. Since weekly
    // jobs only become due on their configured weekday, this is one key per week.
    return `${local.year}-${local.month}-${local.day}`;
  }

  if (job.frequency === "monthly") {
    return `${local.year}-${local.month}`;
  }

  return `${local.year}`;
}

function executionJobName(jobId) {
  return `scheduled-report:${jobId}`;
}

export async function reconcileStaleScheduledReportRuns() {
  try {
    await q(
      `UPDATE public.scheduler_job_runs
          SET status = 'failed',
              completed_at = COALESCE(completed_at, now() - ($1::int * INTERVAL '1 minute')),
              duration_ms = COALESCE(
                duration_ms,
                GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int)
              ),
              error_message = COALESCE(
                error_message,
                'Execution interrupted or timed out before completion'
              )
        WHERE job_name LIKE 'scheduled-report:%'
          AND status = 'running'
          AND started_at < now() - ($2::int * INTERVAL '1 minute')`,
      [FAILED_RETRY_COOLDOWN_MINUTES + 1, STALE_RUNNING_MINUTES],
    );
  } catch (error) {
    console.error("Failed to reconcile stale scheduled-report runs", {
      error: error?.message || String(error),
      stack: error?.stack,
    });
  }
}

async function claimExecution(job, key) {
  const jobName = executionJobName(job.id);
  const lockKey = `${jobName}:${key}`;

  if (activeJobLocks.has(lockKey)) {
    return { acquired: false };
  }

  activeJobLocks.add(lockKey);

  try {
    const result = await q(
      `INSERT INTO public.scheduler_job_runs (
         job_name,
         scheduled_key,
         status,
         started_at,
         completed_at,
         duration_ms,
         error_message
       )
       VALUES ($1, $2, 'running', now(), NULL, NULL, NULL)
       ON CONFLICT (job_name, scheduled_key) DO UPDATE
         SET status = 'running',
             started_at = now(),
             completed_at = NULL,
             duration_ms = NULL,
             error_message = NULL
       WHERE public.scheduler_job_runs.status <> 'completed'
         AND (
           public.scheduler_job_runs.status <> 'running'
           OR public.scheduler_job_runs.started_at < now() - ($3::int * INTERVAL '1 minute')
         )
         AND (
           public.scheduler_job_runs.status <> 'failed'
           OR COALESCE(
                public.scheduler_job_runs.completed_at,
                public.scheduler_job_runs.started_at
              ) <= now() - ($4::int * INTERVAL '1 minute')
         )
       RETURNING job_name, scheduled_key`,
      [jobName, key, STALE_RUNNING_MINUTES, FAILED_RETRY_COOLDOWN_MINUTES],
    );

    if (!result.rowCount) {
      activeJobLocks.delete(lockKey);
      return { acquired: false };
    }

    return {
      acquired: true,
      lockKey,
      jobName,
      scheduledKey: key,
    };
  } catch (error) {
    activeJobLocks.delete(lockKey);
    throw error;
  }
}

async function finishExecution(execution, status, startedAt, errorMessage = null) {
  const durationMs = Math.max(0, Date.now() - startedAt);

  await q(
    `UPDATE public.scheduler_job_runs
        SET status = $1,
            completed_at = now(),
            duration_ms = $2,
            error_message = $3
      WHERE job_name = $4
        AND scheduled_key = $5`,
    [status, durationMs, errorMessage, execution.jobName, execution.scheduledKey],
  );
}

async function runJob(jobId, key) {
  let execution = null;
  let startedAt = Date.now();
  let job = null;

  try {
    job = await getScheduledReportForExecution(jobId);

    if (!job) return;

    const claim = await claimExecution(job, key);

    if (!claim.acquired) return;

    execution = claim;
    startedAt = Date.now();

    console.log(
      JSON.stringify({
        event: "scheduled_report_started",
        jobId,
        scheduledKey: key,
        reportKey: job.report_key,
      }),
    );

    const result = await sendScheduledReportJob(job);

    await finishExecution(execution, "completed", startedAt, null);

    console.log(
      JSON.stringify({
        event: "scheduled_report_completed",
        jobId,
        scheduledKey: key,
        result,
      }),
    );
  } catch (error) {
    const errorMessage = error?.message || String(error);

    console.error("Scheduled report failed", {
      jobId,
      scheduledKey: key,
      error: errorMessage,
      stack: error?.stack,
    });

    if (execution) {
      try {
        await finishExecution(execution, "failed", startedAt, errorMessage);
      } catch (finishError) {
        console.error("Failed to record scheduled report failure", {
          jobId,
          scheduledKey: key,
          error: finishError?.message || String(finishError),
          stack: finishError?.stack,
        });
      }
    }

    const failedJob = typeof job === "object" && job ? job : null;
    void notifyAdminFailure({
      category: "custom-scheduler-email",
      schedulerName: failedJob?.name || `Scheduled report #${jobId}`,
      schedulerOwnerName: failedJob?.owner_name || null,
      schedulerOwnerEmail: failedJob?.owner_email || null,
      schedulerSchedule: failedJob
        ? `${failedJob.frequency || "unknown"} at ${String(failedJob.time_of_day || "").slice(0, 5) || "unknown"}`
        : `Scheduled report #${jobId}`,
      failureTime: new Date().toISOString(),
      failureMessage: errorMessage,
      stack: error?.stack,
    }).catch((alertError) => {
      console.error("Failed to send scheduled report admin alert", {
        jobId,
        error: alertError?.message || String(alertError),
      });
    });
  } finally {
    if (execution?.lockKey) {
      activeJobLocks.delete(execution.lockKey);
    }
  }
}

export async function processDueScheduledReportJobs() {
  if (isPolling) return;
  isPolling = true;

  try {
    await reconcileStaleScheduledReportRuns();

    const local = localParts();

    const result = await q(
      `SELECT *
         FROM public.scheduled_report_jobs
        WHERE active = TRUE
        ORDER BY id`,
    );

    for (const job of result.rows) {
      if (!dueFor(job, local)) continue;

      try {
        await runJob(job.id, scheduledKey(job, local));
      } catch (error) {
        console.error("Scheduled report worker failed unexpectedly", {
          jobId: job.id,
          error: error?.message || String(error),
          stack: error?.stack,
        });
      }
    }
  } finally {
    isPolling = false;
  }
}

export function startScheduledReportScheduler() {
  if (started) return;

  started = true;

  console.log("User scheduled-report scheduler enabled (Asia/Kolkata, minute polling)");

  if (!cron.validate("* * * * *")) {
    console.error("Internal scheduled-report scheduler expression is invalid");
    return;
  }

  cron.schedule(
    "* * * * *",
    async () => {
      try {
        await processDueScheduledReportJobs();
      } catch (error) {
        console.error("Scheduled-report scheduler poll failed", error);
      }
    },
    { timezone: "Asia/Kolkata" },
  );

  void processDueScheduledReportJobs().catch((error) => {
    console.error("Initial scheduled-report scheduler poll failed", error);
  });
}
