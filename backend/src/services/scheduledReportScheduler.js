import cron from "node-cron";
import { q, pool } from "../db/index.js";
import {
  getScheduledReportForExecution,
  sendScheduledReportJob,
} from "./scheduledReportService.js";

let started = false;

function localParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
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

function dueFor(job, local) {
  const [hour, minute] = String(job.time_of_day || "00:00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);

  const currentMinutes = Number(local.hour) * 60 + Number(local.minute);
  const scheduledMinutes = hour * 60 + minute;

  if (currentMinutes < scheduledMinutes) return false;

  if (job.frequency === "daily") return true;

  if (job.frequency === "weekly") {
    return (
      Number(
        local.weekday === undefined
          ? -1
          : new Date(`${local.year}-${local.month}-${local.day}T00:00:00Z`).getUTCDay(),
      ) === Number(job.day_of_week)
    );
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

async function claimExecution(client, job, key) {
  const jobName = executionJobName(job.id);
  const lockKey = `${jobName}:${key}`;

  const lock = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [lockKey]);

  if (!lock.rows[0]?.locked) {
    return { acquired: false };
  }

  const existing = await client.query(
    `SELECT job_name, scheduled_key, status, started_at
       FROM public.scheduler_job_runs
      WHERE job_name = $1 AND scheduled_key = $2
      FOR UPDATE`,
    [jobName, key],
  );

  if (existing.rows[0]?.status === "completed") {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);

    return { acquired: false };
  }

  if (existing.rows[0]) {
    await client.query(
      `UPDATE public.scheduler_job_runs
          SET status = 'running',
              started_at = now(),
              completed_at = NULL,
              duration_ms = NULL,
              error_message = NULL
        WHERE job_name = $1
          AND scheduled_key = $2`,
      [jobName, key],
    );
  } else {
    await client.query(
      `INSERT INTO public.scheduler_job_runs(
        job_name,
        scheduled_key,
        status,
        started_at,
        completed_at
      )
      VALUES ($1, $2, 'running', now(), NULL)`,
      [jobName, key],
    );
  }

  return {
    acquired: true,
    lockKey,
    jobName,
  };
}

async function finishExecution(client, execution, status, startedAt, errorMessage = null) {
  const durationMs = Date.now() - startedAt;

  if (status === "completed") {
    await client.query(
      `UPDATE public.scheduler_job_runs
          SET status = 'completed',
              completed_at = now(),
              duration_ms = $1,
              error_message = $2
        WHERE job_name = $3
          AND scheduled_key = $4`,
      [durationMs, errorMessage, execution.jobName, execution.scheduledKey],
    );
  } else {
    await client.query(
      `UPDATE public.scheduler_job_runs
          SET status = 'failed',
              completed_at = NULL,
              duration_ms = $1,
              error_message = $2
        WHERE job_name = $3
          AND scheduled_key = $4`,
      [durationMs, errorMessage, execution.jobName, execution.scheduledKey],
    );
  }

  await client.query("SELECT pg_advisory_unlock(hashtext($1))", [execution.lockKey]);
}

async function runJob(jobId, key) {
  let client = null;
  let execution = null;
  let startedAt = Date.now();

  try {
    client = await pool.connect();

    const job = await getScheduledReportForExecution(jobId);

    if (!job) return;

    const claim = await claimExecution(client, job, key);

    if (!claim.acquired) return;

    execution = {
      ...claim,
      scheduledKey: key,
    };

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

    await finishExecution(client, execution, "completed", startedAt, null);

    execution = null;

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

    if (client && execution) {
      try {
        await finishExecution(client, execution, "failed", startedAt, errorMessage);

        execution = null;
      } catch (finishError) {
        console.error("Failed to record scheduled report failure", {
          jobId,
          scheduledKey: key,
          error: finishError?.message || String(finishError),
          stack: finishError?.stack,
        });
      }
    }
  } finally {
    if (client) {
      client.release();
    }
  }
}

async function processDueJobs() {
  const local = localParts();

  const result = await q(
    `SELECT *
       FROM public.scheduled_report_jobs
      WHERE active = TRUE
      ORDER BY id`,
  );

  for (const job of result.rows) {
    if (!dueFor(job, local)) continue;

    void runJob(job.id, scheduledKey(job, local)).catch((error) => {
      console.error("Scheduled report worker failed unexpectedly", {
        jobId: job.id,
        error: error?.message || String(error),
        stack: error?.stack,
      });
    });
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
        await processDueJobs();
      } catch (error) {
        console.error("Scheduled-report scheduler poll failed", error);
      }
    },
    { timezone: "Asia/Kolkata" },
  );

  void processDueJobs().catch((error) => {
    console.error("Initial scheduled-report scheduler poll failed", error);
  });
}
