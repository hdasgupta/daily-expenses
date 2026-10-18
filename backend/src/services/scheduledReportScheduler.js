import cron from "node-cron";
import { q } from "../db/index.js";
import {
  getScheduledReportForExecution,
  sendScheduledReportJob,
} from "./scheduledReportService.js";
import { notifyAdminFailure } from "./adminAlertService.js";

let started = false;
let activePollPromise = null;
let migrationChecked = false;
const activeJobLocks = new Set();

const STALE_RUNNING_SECONDS = 35;
const FAILED_RETRY_COOLDOWN_MINUTES = 2;

const WEEKDAY_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
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

function yesterdayDateKey(local) {
  const d = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day) - 1));
  return d.toISOString().slice(0, 10);
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

async function runOneTimeV4ResetIfNeeded() {
  if (migrationChecked) return;
  try {
    await q(`
      CREATE TABLE IF NOT EXISTS public.scheduler_migrations (
        key TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const mig = await q(
      `INSERT INTO public.scheduler_migrations (key)
       VALUES ('reset_oct_2026_email_runs_v4')
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
    );
    if (mig.rowCount > 0) {
      await q(
        `DELETE FROM public.scheduler_job_runs
          WHERE job_name LIKE 'scheduled-report:%'
            AND started_at >= '2026-10-16T00:00:00Z'`,
      );
      await q(
        `DELETE FROM public.scheduler_job_executions
          WHERE job_name <> 'daily-planned-recipe-email'
            AND (
              status IN ('failed', 'running')
              OR started_at >= '2026-10-18T00:00:00Z'
            )`,
      );
    }
    migrationChecked = true;
  } catch (error) {
    console.error("Failed to run one-time scheduler v4 migration", error);
  }
}

export async function reconcileStaleScheduledReportRuns() {
  try {
    await runOneTimeV4ResetIfNeeded();

    await q(
      `UPDATE public.scheduler_job_runs
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
        WHERE job_name LIKE 'scheduled-report:%'
          AND status = 'running'
          AND started_at < now() - ($2::int * INTERVAL '1 second')`,
      [FAILED_RETRY_COOLDOWN_MINUTES + 1, STALE_RUNNING_SECONDS],
    );
  } catch (error) {
    console.error("Failed to reconcile stale scheduled-report runs", {
      error: error?.message || String(error),
      stack: error?.stack,
    });
  }
}

async function isAlreadyCompletedOrCoolingDown(job, key) {
  const jobName = executionJobName(job.id);
  const existing = await q(
    `SELECT status, started_at, completed_at, error_message
       FROM public.scheduler_job_runs
      WHERE job_name = $1
        AND scheduled_key = $2`,
    [jobName, key],
  );

  const row = existing.rows[0];
  if (!row) return false;

  if (row.status === "running") {
    const ageMs = Date.now() - new Date(row.started_at).getTime();
    if (ageMs < STALE_RUNNING_SECONDS * 1000) return true;
    return false;
  }

  // If the user edited the scheduled report after the previous run started,
  // allow the updated schedule to execute again for the current period.
  if (job.updated_at && row.started_at) {
    const updatedMs = new Date(job.updated_at).getTime();
    const startedMs = new Date(row.started_at).getTime();
    if (Number.isFinite(updatedMs) && Number.isFinite(startedMs) && updatedMs > startedMs) {
      return false;
    }
  }

  if (row.status === "completed") return true;

  if (
    row.status === "failed" &&
    row.error_message !== "Execution interrupted or timed out before completion" &&
    !String(row.error_message || "").toLowerCase().includes("fetch failed")
  ) {
    const refTime = new Date(row.completed_at || row.started_at).getTime();
    if (Date.now() - refTime < FAILED_RETRY_COOLDOWN_MINUTES * 60 * 1000) {
      return true;
    }
  }

  return false;
}

async function claimExecution(job, key) {
  const jobName = executionJobName(job.id);
  const lockKey = `${jobName}:${key}`;

  if (activeJobLocks.has(lockKey)) {
    return { acquired: false };
  }

  activeJobLocks.add(lockKey);

  const jobUpdatedAt = job.updated_at
    ? new Date(job.updated_at).toISOString()
    : new Date(0).toISOString();

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
       WHERE (
         public.scheduler_job_runs.status <> 'running'
         OR public.scheduler_job_runs.started_at < now() - ($3::int * INTERVAL '1 second')
       )
       AND (
         public.scheduler_job_runs.started_at < $5::timestamptz
         OR (
           public.scheduler_job_runs.status <> 'completed'
           AND (
             public.scheduler_job_runs.status <> 'failed'
             OR public.scheduler_job_runs.error_message = 'Execution interrupted or timed out before completion'
             OR public.scheduler_job_runs.error_message ILIKE '%fetch failed%'
             OR COALESCE(
                  public.scheduler_job_runs.completed_at,
                  public.scheduler_job_runs.started_at
                ) <= now() - ($4::int * INTERVAL '1 minute')
           )
         )
       )
       RETURNING job_name, scheduled_key`,
      [jobName, key, STALE_RUNNING_SECONDS, FAILED_RETRY_COOLDOWN_MINUTES, jobUpdatedAt],
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

    if (!job) return false;

    const claim = await claimExecution(job, key);

    if (!claim.acquired) return false;

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
    return true;
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
    return false;
  } finally {
    if (execution?.lockKey) {
      activeJobLocks.delete(execution.lockKey);
    }
  }
}

async function resolveDueKeyForJob(job, local) {
  const todayKey = `${local.year}-${local.month}-${local.day}`;

  if (dueFor(job, local)) {
    const key = scheduledKey(job, local);
    if (!(await isAlreadyCompletedOrCoolingDown(job, key))) {
      return key;
    }
  }

  // If a daily job's time for today has not yet arrived, check whether yesterday's
  // scheduled run was missed (for jobs created before today).
  if (job.frequency === "daily") {
    const createdDateKey = job.created_at
      ? (() => {
          const p = localParts(new Date(job.created_at));
          return `${p.year}-${p.month}-${p.day}`;
        })()
      : null;

    if (!createdDateKey || createdDateKey < todayKey) {
      const yKey = yesterdayDateKey(local);
      const existingYesterday = await q(
        `SELECT status
           FROM public.scheduler_job_runs
          WHERE job_name = $1
            AND scheduled_key = $2`,
        [executionJobName(job.id), yKey],
      );
      if (
        !existingYesterday.rows[0] ||
        (existingYesterday.rows[0].status === "failed" &&
          !(await isAlreadyCompletedOrCoolingDown(job, yKey)))
      ) {
        return yKey;
      }
    }
  }

  // Retry any recent failed run for this job from the last 7 days
  const failedRun = await q(
    `SELECT scheduled_key
       FROM public.scheduler_job_runs
      WHERE job_name = $1
        AND status = 'failed'
        AND started_at >= now() - INTERVAL '7 days'
      ORDER BY started_at DESC
      LIMIT 1`,
    [executionJobName(job.id)],
  );

  if (failedRun.rows[0]?.scheduled_key) {
    const fKey = failedRun.rows[0].scheduled_key;
    if (!(await isAlreadyCompletedOrCoolingDown(job, fKey))) {
      return fKey;
    }
  }

  return null;
}

export async function processDueScheduledReportJobs({ maxJobs = Infinity, deadlineMs = Infinity } = {}) {
  if (activePollPromise) {
    return activePollPromise;
  }

  activePollPromise = (async () => {
    let executedCount = 0;
    let hasMoreDue = false;

    try {
      await reconcileStaleScheduledReportRuns();

      const local = localParts();

      const result = await q(
        `SELECT j.*
           FROM public.scheduled_report_jobs j
           JOIN public.users u ON u.id = j.owner_user_id
          WHERE j.active = TRUE
            AND u.is_disabled = FALSE
          ORDER BY j.id`,
      );

      for (const job of result.rows) {
        const key = await resolveDueKeyForJob(job, local);
        if (!key) continue;

        if (executedCount >= maxJobs || Date.now() >= deadlineMs) {
          hasMoreDue = true;
          break;
        }

        try {
          const ran = await runJob(job.id, key);
          if (ran) executedCount += 1;
        } catch (error) {
          console.error("Scheduled report worker failed unexpectedly", {
            jobId: job.id,
            error: error?.message || String(error),
            stack: error?.stack,
          });
        }
      }
    } finally {
      activePollPromise = null;
    }

    return { executedCount, hasMoreDue };
  })();

  return activePollPromise;
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
