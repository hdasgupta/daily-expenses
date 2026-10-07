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

  const result = await q(
    `SELECT $1::timestamp AT TIME ZONE $2 AS scheduled_for`,
    [text, TIMEZONE],
  );
  const scheduledFor = result.rows[0]?.scheduled_for;
  const timestamp = scheduledFor ? new Date(scheduledFor).getTime() : NaN;

  if (!Number.isFinite(timestamp) || timestamp <= Date.now() + 30_000) {
    throw error("Choose a date and time at least 30 seconds in the future.");
  }

  return scheduledFor;
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
  const result = await q(
    `INSERT INTO public.one_time_report_email_jobs
      (owner_user_id, created_by_user_id, name, config, scheduled_for, status)
     SELECT recipient.id, $2::bigint, $3, $4::jsonb, $5, 'pending'
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
    throw error("Scheduled report email not found or you do not have permission to remove it.", 404);
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

      await client.query(`UPDATE public.one_time_report_email_jobs SET status = 'completed', updated_at = now(), last_error = NULL WHERE id = $1`, [id]);

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
