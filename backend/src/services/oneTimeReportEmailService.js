import { q } from "../db/index.js";
import { cleanConfig, buildReportPdfData } from "./reportService.js";
import { buildReportPdf } from "./reportPdfService.js";
import { sendReportEmail } from "./mailService.js";
import { notifyAdminFailure } from "./adminAlertService.js";

const TIMEZONE = "Asia/Kolkata";

async function ensureOneTimeReportEmailSchedulerSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS public.one_time_report_email_jobs (
      id BIGSERIAL PRIMARY KEY,
      owner_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
      name VARCHAR(150) NOT NULL DEFAULT 'Report PDF email',
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      scheduled_for TIMESTAMPTZ NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      last_attempt_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'one_time_report_email_jobs'
           AND column_name = 'scheduled_for'
           AND data_type = 'timestamp without time zone'
      ) THEN
        ALTER TABLE public.one_time_report_email_jobs
          ALTER COLUMN scheduled_for TYPE TIMESTAMPTZ
          USING scheduled_for AT TIME ZONE 'Asia/Kolkata';
      END IF;
    END $$
  `);

  await q(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'scheduler_job_runs'
           AND column_name = 'job_name'
           AND character_maximum_length IS NOT NULL
           AND character_maximum_length < 100
      ) THEN
        ALTER TABLE public.scheduler_job_runs
          ALTER COLUMN job_name TYPE VARCHAR(100);
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'scheduler_job_runs'
           AND column_name = 'scheduled_key'
           AND character_maximum_length IS NOT NULL
           AND character_maximum_length < 100
      ) THEN
        ALTER TABLE public.scheduler_job_runs
          ALTER COLUMN scheduled_key TYPE VARCHAR(100);
      END IF;
    END $$
  `);

  await q(`CREATE INDEX IF NOT EXISTS idx_one_time_report_email_jobs_due
            ON public.one_time_report_email_jobs(status, scheduled_for, id)`);
}

function error(message, statusCode = 400) {
  const result = new Error(message);
  result.statusCode = statusCode;
  return result;
}

function normalizeName(value) {
  const name = String(value || "Report PDF email").trim();
  if (!name) return "Report PDF email";
  if (name.length > 150) throw error("The schedule name must be 150 characters or fewer.");
  return name;
}

function kolkataTodayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function hasFutureDateInReportConfig(config = {}) {
  const filters = config.filters || {};
  const today = kolkataTodayIso();

  if (filters.date && String(filters.date) > today) return true;
  if (filters.dateFrom && String(filters.dateFrom) > today) return true;
  if (filters.dateTo && String(filters.dateTo) > today) return true;

  if (filters.month) {
    const month = String(filters.month);
    const currentMonth = today.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month) && month >= currentMonth) return true;
  }

  if (filters.year) {
    const year = String(filters.year);
    const currentYear = today.slice(0, 4);
    if (/^\d{4}$/.test(year) && year >= currentYear) return true;
  }

  return false;
}

async function resolveScheduledFor(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    throw error("Choose a valid future date and time.");
  }

  const result = await q(
    `SELECT ($1::timestamp AT TIME ZONE $2) AS scheduled_for`,
    [text, TIMEZONE],
  );
  const scheduledFor = result.rows[0]?.scheduled_for;
  const timestamp = scheduledFor ? new Date(scheduledFor).getTime() : NaN;

  if (!Number.isFinite(timestamp) || timestamp <= Date.now() + 30_000) {
    throw error("Choose a date and time at least 30 seconds in the future.");
  }

  return new Date(timestamp).toISOString();
}

export async function scheduleOneTimeReportEmail({
  config,
  scheduledFor,
  name,
  user,
  managerIds = [],
}) {
  const clean = cleanConfig(config || {});
  const when = await resolveScheduledFor(scheduledFor);
  const scheduleName = normalizeName(name);

  const report = await buildReportPdfData(clean);
  const hasCurrentData = Boolean(report.rows?.length || report.rawRows?.length);
  if (!hasCurrentData && !hasFutureDateInReportConfig(clean)) {
    throw error(
      "Cannot schedule an email for a report with no data unless the report includes a future date.",
    );
  }

  const requestedIds = [...new Set((Array.isArray(managerIds) ? managerIds : [])
    .map((id) => String(id).trim())
    .filter(Boolean))];

  let recipients = [{ id: user.id, email: user.email }];
  if (requestedIds.length) {
    if (user.role !== "admin") {
      throw error("Only administrators can schedule report emails for managers.", 403);
    }
    if (requestedIds.some((id) => !/^\d+$/.test(id))) {
      throw error("One or more selected managers are invalid.");
    }
    const valid = await q(
      `SELECT u.id, u.email
         FROM public.users u
         JOIN public.roles r ON r.id = u.role_id
        WHERE u.id = ANY($1::bigint[])
          AND r.name = 'manager'
          AND u.is_disabled = false`,
      [requestedIds],
    );
    const validById = new Map(valid.rows.map((row) => [String(row.id), row]));
    if (validById.size !== requestedIds.length) {
      throw error("One or more selected accounts are not active managers.");
    }
    recipients = requestedIds.map((id) => validById.get(id));
  }

  const result = await q(
    `INSERT INTO public.one_time_report_email_jobs
      (owner_user_id, created_by_user_id, name, config, scheduled_for, status)
     SELECT recipient.id, $2::bigint, $3, $4::jsonb, $5::timestamptz, 'pending'
       FROM unnest($1::bigint[]) AS selected(id)
       JOIN public.users recipient ON recipient.id = selected.id
     RETURNING id, owner_user_id, created_by_user_id, name, scheduled_for, status, created_at`,
    [
      recipients.map((recipient) => recipient.id),
      user.id,
      scheduleName,
      JSON.stringify(clean),
      when,
    ],
  );

  const emailById = new Map(recipients.map((recipient) => [String(recipient.id), recipient.email]));
  // Wake the in-process worker immediately after a schedule is created.
  // This avoids waiting for the next polling tick and also makes newly-created
  // jobs resilient when the scheduler started just before this request.
  void processDueOneTimeReportEmailJobs().catch((schedulerError) => {
    console.error("One-time report email immediate poll failed", {
      error: schedulerError?.message || String(schedulerError),
      stack: schedulerError?.stack,
    });
  });

  return {
    jobs: result.rows.map((row) => ({
      ...row,
      report_email: emailById.get(String(row.owner_user_id)),
      timezone: TIMEZONE,
    })),
    count: result.rows.length,
    timezone: TIMEZONE,
  };
}

export async function listOneTimeReportEmailJobs(userId) {
  const result = await q(
    `SELECT id, name, scheduled_for, status, last_attempt_at, last_error, created_at, updated_at
       FROM public.one_time_report_email_jobs
      WHERE owner_user_id = $1
      ORDER BY scheduled_for ASC, id ASC`,
    [userId],
  );
  return result.rows;
}

export async function removeOneTimeReportEmailJob({ id, userId, isAdmin = false }) {
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw error("Invalid scheduled email job.", 400);
  }

  const result = await q(
    `DELETE FROM public.one_time_report_email_jobs
      WHERE id = $1
        AND ($2::boolean = TRUE OR owner_user_id = $3)
      RETURNING id`,
    [jobId, Boolean(isAdmin), userId],
  );

  if (!result.rows.length) {
    throw error("Scheduled report email not found or you do not have permission to remove it.", 404);
  }
}

let schedulerStarted = false;
let schedulerTimer = null;
const SCHEDULER_POLL_MS = 5_000;

export function startOneTimeReportEmailScheduler() {
  if (schedulerStarted) return;

  schedulerStarted = true;
  console.log(`One-time report email scheduler enabled (${SCHEDULER_POLL_MS}ms polling, Asia/Kolkata schedules normalized to UTC)`);

  const scheduleNextPoll = () => {
    schedulerTimer = setTimeout(async () => {
      try {
        await processDueOneTimeReportEmailJobs();
      } catch (error) {
        console.error("One-time report email scheduler poll failed", {
          error: error?.message || String(error),
          stack: error?.stack,
        });
      } finally {
        if (schedulerStarted) scheduleNextPoll();
      }
    }, SCHEDULER_POLL_MS);
  };

  void (async () => {
    try {
      await ensureOneTimeReportEmailSchedulerSchema();
      const clock = await q(`SELECT now() AS db_now, CURRENT_TIMESTAMP AS current_timestamp`);
      console.log(JSON.stringify({
        event: "one_time_report_email_scheduler_started",
        timezone: TIMEZONE,
        databaseNow: clock.rows[0]?.db_now || null,
        databaseCurrentTimestamp: clock.rows[0]?.current_timestamp || null,
        pollingMs: SCHEDULER_POLL_MS,
      }));

      await processDueOneTimeReportEmailJobs();
      scheduleNextPoll();
    } catch (error) {
      console.error("One-time report email scheduler initialization failed", {
        error: error?.message || String(error),
        stack: error?.stack,
      });
      schedulerStarted = false;
      if (schedulerTimer) clearTimeout(schedulerTimer);
      schedulerTimer = null;
    }
  })();
}

export async function processDueOneTimeReportEmailJobs() {
  const due = await q(
    `SELECT id
       FROM public.one_time_report_email_jobs
      WHERE scheduled_for <= clock_timestamp()
        AND status IN ('pending', 'failed')
      ORDER BY scheduled_for ASC, id ASC
      LIMIT 20`,
  );

  const next = await q(
    `SELECT id, scheduled_for, status
       FROM public.one_time_report_email_jobs
      WHERE status IN ('pending', 'failed', 'running')
      ORDER BY scheduled_for ASC, id ASC
      LIMIT 1`,
  );

  console.log(JSON.stringify({
    event: due.rows.length ? "one_time_report_email_due_jobs_found" : "one_time_report_email_poll",
    count: due.rows.length,
    jobIds: due.rows.map((row) => row.id),
    nextJobId: next.rows[0]?.id || null,
    nextScheduledFor: next.rows[0]?.scheduled_for || null,
    nextStatus: next.rows[0]?.status || null,
    databaseNow: new Date().toISOString(),
  }));

  for (const row of due.rows) {
    void executeOneTimeReportEmailJob(row.id).catch((workerError) => {
      console.error("One-time report email worker failed unexpectedly", {
        jobId: row.id,
        error: workerError?.message || String(workerError),
        stack: workerError?.stack,
      });
    });
  }
}

async function claimJob(id) {
  console.log(JSON.stringify({
    event: "one_time_report_email_execution_started",
    jobId: id,
  }));

  const result = await q(
    `UPDATE public.one_time_report_email_jobs
        SET status = 'running',
            last_attempt_at = now(),
            updated_at = now(),
            last_error = NULL
      WHERE id = $1
        AND scheduled_for <= clock_timestamp()
        AND status IN ('pending', 'failed')
      RETURNING *`,
    [id],
  );

  if (!result.rows[0]) {
    console.log(JSON.stringify({
      event: "one_time_report_email_claim_skipped",
      jobId: id,
      reason: "job_not_due_or_already_running",
    }));
    return null;
  }

  const jobResult = await q(
    `SELECT j.*, u.email AS owner_email, u.full_name AS owner_name
       FROM public.one_time_report_email_jobs j
       JOIN public.users u ON u.id = j.owner_user_id
      WHERE j.id = $1`,
    [id],
  );

  const job = jobResult.rows[0];
  if (!job) {
    throw new Error(`Claimed one-time report email job ${id} could not be reloaded.`);
  }

  console.log(JSON.stringify({
    event: "one_time_report_email_job_claimed",
    jobId: id,
    ownerUserId: job.owner_user_id,
    scheduledFor: job.scheduled_for,
  }));

  return job;
}

async function updateExecutionHistory(jobName, scheduledKey, values) {
  try {
    await q(
      `INSERT INTO public.scheduler_job_runs
        (job_name, scheduled_key, status, started_at, completed_at, duration_ms, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (job_name, scheduled_key) DO UPDATE
         SET status = EXCLUDED.status,
             started_at = EXCLUDED.started_at,
             completed_at = EXCLUDED.completed_at,
             duration_ms = EXCLUDED.duration_ms,
             error_message = EXCLUDED.error_message`,
      [
        jobName,
        scheduledKey,
        values.status,
        values.startedAt || null,
        values.completedAt || null,
        values.durationMs ?? null,
        values.errorMessage || null,
      ],
    );
  } catch (historyError) {
    console.error("One-time report email execution history update failed", {
      jobName,
      scheduledKey,
      requestedStatus: values.status,
      error: historyError?.message || String(historyError),
      stack: historyError?.stack,
    });
    throw historyError;
  }
}

async function executeOneTimeReportEmailJob(id) {
  let job = null;
  let executionJobName = null;
  let scheduledKey = null;
  const startedAt = Date.now();

  try {
    job = await claimJob(id);
    if (!job) return;

    executionJobName = `one-time-report:${id}:user:${job.owner_user_id}`;
    scheduledKey = String(job.scheduled_for);

    console.log(JSON.stringify({
      event: "one_time_report_email_execution_history_started",
      jobId: id,
      executionJobName,
      scheduledKey,
    }));

    await updateExecutionHistory(executionJobName, scheduledKey, {
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
      errorMessage: null,
    });

    console.log(JSON.stringify({
      event: "one_time_report_email_report_generation_started",
      jobId: id,
    }));

    const report = await buildReportPdfData(job.config || {});

    if (!report.rows?.length && !report.rawRows?.length) {
      throw error("No report data to email.");
    }

    console.log(JSON.stringify({
      event: "one_time_report_email_report_generation_completed",
      jobId: id,
      rowCount: report.rows?.length || 0,
      rawRowCount: report.rawRows?.length || 0,
    }));

    console.log(JSON.stringify({
      event: "one_time_report_email_pdf_generation_started",
      jobId: id,
    }));

    const pdf = await buildReportPdf(report, report.pdfConfig || job.config || {});

    console.log(JSON.stringify({
      event: "one_time_report_email_pdf_generation_completed",
      jobId: id,
      pdfBytes: Buffer.isBuffer(pdf) ? pdf.length : null,
    }));

    console.log(JSON.stringify({
      event: "one_time_report_email_send_started",
      jobId: id,
      recipient: job.owner_email,
    }));

    await sendReportEmail(job.owner_email, pdf, {
      subject: `Scheduled Expense Report PDF — ${job.name}`,
      htmlBody: `<p>Your scheduled expense report PDF <strong>${job.name}</strong> is attached.</p>`,
    });

    console.log(JSON.stringify({
      event: "one_time_report_email_send_completed",
      jobId: id,
      recipient: job.owner_email,
    }));

    const durationMs = Date.now() - startedAt;
    await updateExecutionHistory(executionJobName, scheduledKey, {
      status: "completed",
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs,
      errorMessage: null,
    });

    await q(`DELETE FROM public.one_time_report_email_jobs WHERE id = $1`, [id]);

    console.log(JSON.stringify({
      event: "one_time_report_email_completed",
      jobId: id,
      ownerUserId: job.owner_user_id,
      executionJobName,
      scheduledKey,
    }));
  } catch (workerError) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = workerError?.message || String(workerError);

    console.error("One-time report email execution failed", {
      jobId: id,
      executionJobName,
      scheduledKey,
      error: errorMessage,
      stack: workerError?.stack,
    });

    // The job is already atomically claimed as running. Always make it
    // retryable/visible as failed, even when execution-history persistence
    // itself fails.
    try {
      await q(
        `UPDATE public.one_time_report_email_jobs
            SET status = 'failed',
                last_attempt_at = now(),
                last_error = $2,
                updated_at = now()
          WHERE id = $1`,
        [id, errorMessage],
      );
    } catch (jobUpdateError) {
      console.error("One-time report email failed-job state update failed", {
        jobId: id,
        error: jobUpdateError?.message || String(jobUpdateError),
        stack: jobUpdateError?.stack,
      });
    }

    if (executionJobName && scheduledKey) {
      try {
        await updateExecutionHistory(executionJobName, scheduledKey, {
          status: "failed",
          startedAt: new Date(startedAt).toISOString(),
          completedAt: null,
          durationMs,
          errorMessage,
        });
      } catch {
        // updateExecutionHistory already logs the detailed persistence error.
      }
    }

    console.error("One-time report email failed", {
      jobId: id,
      error: errorMessage,
      stack: workerError?.stack,
    });

    if (job) {
      void notifyAdminFailure({
        category: "custom-scheduler-email",
        schedulerName: job.name || `Scheduled report #${id}`,
        schedulerOwnerName: job.owner_name || null,
        schedulerOwnerEmail: job.owner_email || null,
        schedulerSchedule: `one-time at ${job.scheduled_for || "unknown"}`,
        failureTime: new Date().toISOString(),
        failureMessage: errorMessage,
        stack: workerError?.stack,
      }).catch((notificationError) => {
        console.error("One-time report email admin failure notification failed", {
          jobId: id,
          error: notificationError?.message || String(notificationError),
          stack: notificationError?.stack,
        });
      });
    }
  }
}
