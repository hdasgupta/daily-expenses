import { q, pool } from "../db/index.js";
import { cleanConfig, buildReportPdfData } from "./reportService.js";
import { buildReportPdf } from "./reportPdfService.js";
import { sendReportEmail } from "./mailService.js";
import { notifyAdminFailure } from "./adminAlertService.js";

const TIMEZONE = "Asia/Kolkata";

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

  const result = await q(`SELECT $1::timestamp AT TIME ZONE $2 AS scheduled_for`, [text, TIMEZONE]);
  const scheduledFor = result.rows[0]?.scheduled_for;
  const timestamp = scheduledFor ? new Date(scheduledFor).getTime() : NaN;

  if (!Number.isFinite(timestamp) || timestamp <= Date.now() + 30_000) {
    throw error("Choose a date and time at least 30 seconds in the future.");
  }

  return scheduledFor;
}

export async function scheduleOneTimeReportEmail({ config, scheduledFor, name, user, ownerUserId, ownerUserIds }) {
  const requestedIds = Array.isArray(ownerUserIds) && ownerUserIds.length
    ? [...new Set(ownerUserIds.map((id) => String(id)).filter(Boolean))]
    : ownerUserId != null ? [String(ownerUserId)] : [String(user.id)];
  let recipients = [user];
  if (requestedIds.some((id) => id !== String(user.id))) {
    if (user.role !== "admin") throw error("Only admins can schedule reports for another manager.", 403);
    const target = await q(
      `SELECT u.id, u.email, u.full_name FROM public.users u JOIN public.roles r ON r.id = u.role_id WHERE u.id = ANY($1::int[]) AND lower(r.name) = 'manager'`,
      [requestedIds.map(Number)],
    );
    const byId = new Map(target.rows.map((row) => [String(row.id), row]));
    if (requestedIds.some((id) => !byId.has(id))) throw error("Choose valid manager accounts.", 400);
    recipients = requestedIds.map((id) => byId.get(id));
  }
  const clean = cleanConfig(config || {});
  const when = await resolveScheduledFor(scheduledFor);
  const scheduleName = normalizeName(name);
  const report = await buildReportPdfData(clean);
  const hasCurrentData = Boolean(report.rows?.length || report.rawRows?.length);
  if (!hasCurrentData && !hasFutureDateInReportConfig(clean)) {
    throw error("Cannot schedule an email for a report with no data unless the report includes a future date.");
  }
  const jobs = [];
  for (const recipient of recipients) {
    const result = await q(
      `INSERT INTO public.one_time_report_email_jobs (owner_user_id, name, config, scheduled_for, status)
       VALUES ($1, $2, $3::jsonb, $4, 'pending')
       RETURNING id, name, scheduled_for, status, created_at`,
      [recipient.id, scheduleName, JSON.stringify(clean), when],
    );
    jobs.push({ ...result.rows[0], report_email: recipient.email, timezone: TIMEZONE });
  }
  return jobs.length === 1 ? jobs[0] : jobs;
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
        AND j.scheduled_for <= now()
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
    throw error(
      "Scheduled report email not found or you do not have permission to remove it.",
      404,
    );
  }
}

export async function processDueOneTimeReportEmailJobs() {
  const due = await q(
    `SELECT id
       FROM public.one_time_report_email_jobs
      WHERE scheduled_for <= now()
        AND status IN ('pending', 'failed')
      ORDER BY scheduled_for ASC, id ASC
      LIMIT 20`,
  );

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

    await client.query(
      `UPDATE public.one_time_report_email_jobs
          SET last_attempt_at = now(), updated_at = now(), last_error = NULL
        WHERE id = $1`,
      [id],
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

      await client.query(`DELETE FROM public.one_time_report_email_jobs WHERE id = $1`, [id]);

      console.log(
        JSON.stringify({
          event: "one_time_report_email_completed",
          jobId: id,
          ownerUserId: job.owner_user_id,
        }),
      );
    } catch (error) {
      await client.query(
        `UPDATE public.one_time_report_email_jobs
            SET status = 'failed',
                last_attempt_at = now(),
                last_error = $2,
                updated_at = now()
          WHERE id = $1`,
        [id, error?.message || String(error)],
      );

      console.error("One-time report email failed", {
        jobId: id,
        error: error?.message || String(error),
        stack: error?.stack,
      });

      void notifyAdminFailure({
        category: "custom-scheduler-email",
        schedulerName: job.name || `Scheduled report #${id}`,
        schedulerOwnerName: job.owner_name || null,
        schedulerOwnerEmail: job.owner_email || null,
        schedulerSchedule: `one-time at ${job.scheduled_for || "unknown"}`,
        failureTime: new Date().toISOString(),
        failureMessage: error?.message || String(error),
        stack: error?.stack,
      });
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    }
  } finally {
    client.release();
  }
}
