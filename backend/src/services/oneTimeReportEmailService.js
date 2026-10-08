import { q, pool } from "../db/index.js";
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

  // Older deployments may have created scheduled_for as a timestamp without
  // timezone. Treat those existing wall-clock values as Asia/Kolkata before
  // converting the column permanently to timestamptz.
  await q(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM information_schema.columns
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

  if (filters.date && String(filters.date) > today) {
    return true;
  }

  if (filters.dateFrom && String(filters.dateFrom) > today) {
    return true;
  }

  if (filters.dateTo && String(filters.dateTo) > today) {
    return true;
  }

  if (filters.month) {
    const month = String(filters.month);
    const currentMonth = today.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month) && month > currentMonth) {
      return true;
    }
    if (/^\d{4}-\d{2}$/.test(month) && month === currentMonth) {
      return true;
    }
  }

  if (filters.year) {
    const year = String(filters.year);
    const currentYear = today.slice(0, 4);
    if (/^\d{4}$/.test(year) && year > currentYear) {
      return true;
    }
    if (/^\d{4}$/.test(year) && year === currentYear) {
      return true;
    }
  }

  return false;
}

async function resolveScheduledFor(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    throw error("Choose a valid future date and time.");
  }

  // Convert the user-entered Asia/Kolkata wall-clock time to an absolute UTC
  // instant once. Never rely on the PostgreSQL session timezone for this value.
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

  // A report with no current data can still be scheduled when its configured
  // date scope includes future dates. This allows data entered later to be included.
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

  // Only administrators may schedule on behalf of managers.
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

  // Insert all recipient jobs in one statement so a multi-manager schedule is
  // all-or-nothing. Existing job ownership makes each manager see their own job.
  // Store an absolute instant. The explicit cast keeps this deterministic even
  // when the Render/PostgreSQL session timezone is not Asia/Kolkata.
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

async function claimJob(client, id) {
  const lockKey = `one-time-report-email:${id}`;
  const lock = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [lockKey]);
  if (!lock.rows[0]?.locked) return null;

  const result = await client.query(
    `SELECT j.*, u.email AS owner_email, u.full_name AS owner_name
       FROM public.one_time_report_email_jobs j
       JOIN public.users u ON u.id = j.owner_user_id
      WHERE j.id = $1
        AND j.scheduled_for <= clock_timestamp()
        AND j.status IN ('pending', 'failed')
      FOR UPDATE`,
    [id],
  );

  if (!result.rows[0]) {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    return null;
  }

  return { job: result.rows[0], lockKey };
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

export function startOneTimeReportEmailScheduler() {
  if (schedulerStarted) return;

  schedulerStarted = true;
  console.log("One-time report email scheduler enabled (5-second polling, Asia/Kolkata schedules normalized to UTC)");

  const poll = () => {
    void processDueOneTimeReportEmailJobs().catch((error) => {
      console.error("One-time report email scheduler poll failed", {
        error: error?.message || String(error),
        stack: error?.stack,
      });
    });
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
        pollingMs: 5000,
      }));
      poll();
      schedulerTimer = setInterval(poll, 5_000);
      // Keep the scheduler timer referenced. The HTTP server normally keeps the
      // process alive, but unref could allow the worker to disappear in a
      // non-standard Render/process lifecycle.
    } catch (error) {
      console.error("One-time report email scheduler initialization failed", {
        error: error?.message || String(error),
        stack: error?.stack,
      });
      schedulerStarted = false;
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

  if (due.rows.length) {
    console.log(JSON.stringify({
      event: "one_time_report_email_due_jobs_found",
      count: due.rows.length,
      jobIds: due.rows.map((row) => row.id),
    }));
  }

  for (const row of due.rows) {
    void executeOneTimeReportEmailJob(row.id).catch((error) => {
      console.error("One-time report email worker failed unexpectedly", {
        jobId: row.id,
        error: error?.message || String(error),
        stack: error?.stack,
      });
    });
  }
}

async function executeOneTimeReportEmailJob(id) {
  const client = await pool.connect();
  let execution = null;

  try {
    execution = await claimJob(client, id);
    if (!execution) return;

    const { job, lockKey } = execution;
    const executionJobName = `one-time-report:${id}:user:${job.owner_user_id}`;
    const scheduledKey = String(job.scheduled_for);
    const startedAt = Date.now();

    await client.query(
      `UPDATE public.one_time_report_email_jobs
          SET last_attempt_at = now(), updated_at = now(), last_error = NULL
        WHERE id = $1`,
      [id],
    );

    await client.query(
      `INSERT INTO public.scheduler_job_runs
        (job_name, scheduled_key, status, started_at, completed_at, duration_ms, error_message)
       VALUES ($1, $2, 'running', now(), NULL, NULL, NULL)
       ON CONFLICT (job_name, scheduled_key) DO UPDATE
         SET status = 'running',
             started_at = now(),
             completed_at = NULL,
             duration_ms = NULL,
             error_message = NULL`,
      [executionJobName, scheduledKey],
    );

    try {
      const report = await buildReportPdfData(job.config || {});

      if (!report.rows?.length && !report.rawRows?.length) {
        throw error("No report data to email.");
      }

      const pdf = await buildReportPdf(report, report.pdfConfig || job.config || {});

      await sendReportEmail(job.owner_email, pdf, {
        subject: `Scheduled Expense Report PDF — ${job.name}`,
        htmlBody: `<p>Your scheduled expense report PDF <strong>${job.name}</strong> is attached.</p>`,
      });

      const durationMs = Date.now() - startedAt;

      await client.query(
        `UPDATE public.scheduler_job_runs
            SET status = 'completed',
                completed_at = now(),
                duration_ms = $3,
                error_message = NULL
          WHERE job_name = $1
            AND scheduled_key = $2`,
        [executionJobName, scheduledKey, durationMs],
      );

      await client.query(`DELETE FROM public.one_time_report_email_jobs WHERE id = $1`, [id]);

      console.log(
        JSON.stringify({
          event: "one_time_report_email_completed",
          jobId: id,
          ownerUserId: job.owner_user_id,
          executionJobName,
          scheduledKey,
        }),
      );
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = error?.message || String(error);

      await client.query(
        `UPDATE public.one_time_report_email_jobs
            SET status = 'failed',
                last_attempt_at = now(),
                last_error = $2,
                updated_at = now()
          WHERE id = $1`,
        [id, errorMessage],
      );

      await client.query(
        `UPDATE public.scheduler_job_runs
            SET status = 'failed',
                completed_at = NULL,
                duration_ms = $3,
                error_message = $4
          WHERE job_name = $1
            AND scheduled_key = $2`,
        [executionJobName, scheduledKey, durationMs, errorMessage],
      );

      console.error("One-time report email failed", {
        jobId: id,
        error: errorMessage,
        stack: error?.stack,
      });

      void notifyAdminFailure({
        category: "custom-scheduler-email",
        schedulerName: job.name || `Scheduled report #${id}`,
        schedulerOwnerName: job.owner_name || null,
        schedulerOwnerEmail: job.owner_email || null,
        schedulerSchedule: `one-time at ${job.scheduled_for || "unknown"}`,
        failureTime: new Date().toISOString(),
        failureMessage: errorMessage,
        stack: error?.stack,
      });
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    }
  } finally {
    client.release();
  }
}
