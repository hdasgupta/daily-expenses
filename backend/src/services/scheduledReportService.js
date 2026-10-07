import cron from "node-cron";
import { q } from "../db/index.js";
import { getDashboardDefinition, runDashboardReport } from "./dashboardReportService.js";
import { buildScheduledReportPdf } from "./scheduledReportPdfService.js";
import { sendReportEmail } from "./mailService.js";
import { signedObjectUrl } from "./storageService.js";
import { nowIso } from "../utils/dates.js";

const FREQUENCIES = new Set(["daily", "weekly", "monthly", "yearly"]);

function error(message, statusCode = 400) {
  const result = new Error(message);
  result.statusCode = statusCode;
  return result;
}

export function reportFrequency(reportKey) {
  return String(reportKey || "").split("-")[0];
}

function validateTime(value) {
  const text = String(value || "").trim();

  if (!/^\d{2}:\d{2}$/.test(text)) {
    throw error("Choose a valid delivery time.");
  }

  const [hour, minute] = text.split(":").map(Number);

  if (hour > 23 || minute > 59) {
    throw error("Choose a valid delivery time.");
  }

  return text;
}

function normalizePayload(data = {}, existing = null) {
  const reportKey = String(data.reportKey ?? existing?.report_key ?? "").trim();

  const definition = getDashboardDefinition(reportKey);

  if (!definition) {
    throw error("Choose a valid dashboard report.");
  }

  const frequency = String(
    data.frequency ?? existing?.frequency ?? reportFrequency(reportKey),
  ).trim();

  if (!FREQUENCIES.has(frequency)) {
    throw error("Choose daily, weekly, monthly, or yearly delivery.");
  }

  if (frequency !== reportFrequency(reportKey)) {
    throw error("The delivery frequency must match the dashboard report period.");
  }

  const name = String(data.name ?? existing?.name ?? "").trim();

  if (!name) {
    throw error("Enter a name for this scheduled report.");
  }

  if (name.length > 150) {
    throw error("The scheduled report name must be 150 characters or fewer.");
  }

  const time = validateTime(data.time ?? existing?.time_of_day?.slice?.(0, 5) ?? "06:00");

  let dayOfWeek = null;
  let dayOfMonth = null;
  let monthOfYear = null;

  if (frequency === "weekly") {
    dayOfWeek = Number(data.dayOfWeek ?? existing?.day_of_week ?? 0);

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw error("Choose a valid weekday.");
    }
  }

  if (frequency === "monthly") {
    dayOfMonth = Number(data.dayOfMonth ?? existing?.day_of_month ?? 1);

    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
      throw error("Choose a day between 1 and 28 for monthly delivery.");
    }
  }

  if (frequency === "yearly") {
    dayOfMonth = Number(data.dayOfMonth ?? existing?.day_of_month ?? 1);

    monthOfYear = Number(data.monthOfYear ?? existing?.month_of_year ?? 1);

    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
      throw error("Choose a day between 1 and 28 for yearly delivery.");
    }

    if (!Number.isInteger(monthOfYear) || monthOfYear < 1 || monthOfYear > 12) {
      throw error("Choose a valid month for yearly delivery.");
    }
  }

  const [hour, minute] = time.split(":").map(Number);

  const cronExpression =
    frequency === "daily"
      ? `${minute} ${hour} * * *`
      : frequency === "weekly"
        ? `${minute} ${hour} * * ${dayOfWeek}`
        : frequency === "monthly"
          ? `${minute} ${hour} ${dayOfMonth} * *`
          : `${minute} ${hour} ${dayOfMonth} ${monthOfYear} *`;

  if (!cron.validate(cronExpression)) {
    throw error("The selected schedule is not valid.");
  }

  return {
    name,
    reportKey,
    frequency,
    time,
    dayOfWeek,
    dayOfMonth,
    monthOfYear,
    cronExpression,
  };
}

function decorateJob(row) {
  let nextRunAt = null;

  if (row.cron_expression && row.active) {
    try {
      const task = cron.schedule(row.cron_expression, () => {}, {
        timezone: "Asia/Kolkata",
      });

      const next = task.getNextRun();

      nextRunAt = next instanceof Date && !Number.isNaN(next.getTime()) ? next.toISOString() : null;

      task.stop();
      task.destroy();
    } catch (e) {
      console.error(`Unable to calculate next run for scheduled report ${row.id}`, e);
    }
  }

  const definition = getDashboardDefinition(row.report_key);

  return {
    ...row,
    time_of_day: String(row.time_of_day || "").slice(0, 5),
    report_label: definition?.label || row.report_key,
    report_help: definition?.help || "Dashboard report",
    next_run_at: nextRunAt,
  };
}

export async function listScheduledReportRecipients() {
  const result = await q(
    `SELECT u.id, u.full_name, u.email
       FROM public.users u
       JOIN public.roles r ON r.id = u.role_id
      WHERE r.name = 'manager'
        AND u.is_disabled = false
      ORDER BY u.full_name ASC, u.email ASC`,
  );

  return result.rows;
}

export async function listScheduledReportJobs({ userId, isAdmin = false }) {
  const result = await q(
    `SELECT j.id, j.name, j.owner_user_id, j.created_by_user_id, j.report_key, j.frequency,
            j.time_of_day, j.day_of_week, j.day_of_month, j.month_of_year,
            j.cron_expression, j.active, j.created_at, j.updated_at,
            u.full_name AS owner_name, u.email AS owner_email,
            c.full_name AS creator_name, c.email AS creator_email
       FROM public.scheduled_report_jobs j
       JOIN public.users u ON u.id = j.owner_user_id
       LEFT JOIN public.users c ON c.id = j.created_by_user_id
      WHERE ($1 = TRUE OR j.owner_user_id = $2)
      ORDER BY CASE j.frequency
                 WHEN 'daily' THEN 1
                 WHEN 'weekly' THEN 2
                 WHEN 'monthly' THEN 3
                 WHEN 'yearly' THEN 4
                 ELSE 5
               END,
               j.time_of_day,
               j.name`,
    [Boolean(isAdmin), userId],
  );

  return result.rows.map(decorateJob);
}

async function getJob(id) {
  const result = await q(
    `SELECT *
       FROM public.scheduled_report_jobs
      WHERE id = $1`,
    [id],
  );

  return result.rows[0] || null;
}

function canManage(job, user) {
  return user.role === "admin" || String(job.owner_user_id) === String(user.id);
}

export async function createScheduledReportJob(data, user) {
  const config = normalizePayload(data);
  const requestedIds = [...new Set(
    (Array.isArray(data.managerIds) ? data.managerIds : [])
      .map((id) => String(id).trim())
      .filter(Boolean),
  )];

  let recipientIds = [String(user.id)];

  if (requestedIds.length) {
    if (user.role !== "admin") {
      throw error("Only administrators can schedule report jobs for managers.", 403);
    }

    if (requestedIds.some((id) => !/^\d+$/.test(id))) {
      throw error("One or more selected managers are invalid.");
    }

    const valid = await q(
      `SELECT u.id
         FROM public.users u
         JOIN public.roles r ON r.id = u.role_id
        WHERE u.id = ANY($1::bigint[])
          AND r.name = 'manager'
          AND u.is_disabled = false`,
      [requestedIds],
    );

    const validIds = new Set(valid.rows.map((row) => String(row.id)));
    if (validIds.size !== requestedIds.length) {
      throw error("One or more selected accounts are not active managers.");
    }

    recipientIds = requestedIds;
  }

  const result = await q(
    `INSERT INTO public.scheduled_report_jobs
      (name, owner_user_id, created_by_user_id, report_key, frequency, time_of_day, day_of_week,
       day_of_month, month_of_year, cron_expression, active)
     SELECT $1, recipient.id, $3, $4, $5, $6, $7, $8, $9, $10, $11
       FROM public.users recipient
      WHERE recipient.id = ANY($2::bigint[])
     RETURNING *`,
    [
      config.name,
      recipientIds,
      user.id,
      config.reportKey,
      config.frequency,
      config.time,
      config.dayOfWeek,
      config.dayOfMonth,
      config.monthOfYear,
      config.cronExpression,
      data.active !== false,
    ],
  );

  const jobs = result.rows.map(decorateJob);

  if (requestedIds.length > 1) {
    return {
      jobs,
      count: jobs.length,
    };
  }

  return jobs[0];
}

export async function updateScheduledReportJob(id, data, user) {
  const existing = await getJob(id);

  if (!existing) {
    throw error("Scheduled report not found.", 404);
  }

  if (!canManage(existing, user)) {
    throw error("You can only edit your own scheduled reports.", 403);
  }

  const config = normalizePayload(data, existing);

  const active = data.active == null ? Boolean(existing.active) : Boolean(data.active);

  const result = await q(
    `UPDATE public.scheduled_report_jobs
        SET name = $1,
            report_key = $2,
            frequency = $3,
            time_of_day = $4,
            day_of_week = $5,
            day_of_month = $6,
            month_of_year = $7,
            cron_expression = $8,
            active = $9,
            updated_at = now()
      WHERE id = $10
      RETURNING *`,
    [
      config.name,
      config.reportKey,
      config.frequency,
      config.time,
      config.dayOfWeek,
      config.dayOfMonth,
      config.monthOfYear,
      config.cronExpression,
      active,
      id,
    ],
  );

  return decorateJob(result.rows[0]);
}

export async function deleteScheduledReportJob(id, user) {
  const existing = await getJob(id);

  if (!existing) {
    throw error("Scheduled report not found.", 404);
  }

  if (!canManage(existing, user)) {
    throw error("You can only remove your own scheduled reports.", 403);
  }

  await q(
    `DELETE FROM public.scheduled_report_jobs
      WHERE id = $1`,
    [id],
  );
}

export async function getScheduledReportForExecution(id) {
  const result = await q(
    `SELECT j.*, u.email AS owner_email, u.full_name AS owner_name
       FROM public.scheduled_report_jobs j
       JOIN public.users u ON u.id = j.owner_user_id
      WHERE j.id = $1
        AND j.active = TRUE`,
    [id],
  );

  return result.rows[0] || null;
}

function rawDumpSql(dateFrom, dateTo) {
  return `
    SELECT e.id AS expense_id,
           e.expense_date,
           c.name AS category,
           COALESCE(i.name, e.other_item, 'Total') AS item,
           e.total_cost,
           e.comment,
           e.proof_key,
           s.full_name AS survivor,
           es.amount AS share_price
      FROM public.expenses e
      JOIN public.categories c
        ON c.id = e.category_id
      LEFT JOIN public.items i
        ON i.id = e.item_id
      LEFT JOIN public.expense_shares es
        ON es.expense_id = e.id
      LEFT JOIN public.survivors s
        ON s.id = es.survivor_id
     WHERE e.expense_date >= $1
       AND e.expense_date <= $2
     ORDER BY e.expense_date,
              e.id,
              s.full_name
     LIMIT 5000`;
}

export async function buildScheduledReport(reportKey) {
  const summary = await runDashboardReport(reportKey, "summary");

  const rawResult = await runDashboardReport(reportKey, "drilldown");

  const match = String(summary.rangeLabel || "").match(
    /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/,
  );

  let dumpRows = rawResult.rows || [];

  if (match) {
    const dumpResult = await q(rawDumpSql(match[1], match[2]), [match[1], match[2]]);

    dumpRows = await Promise.all(
      dumpResult.rows.map(async (row) => ({
        ...row,
        total_cost: Number(row.total_cost || 0),
        share_price: row.share_price == null ? null : Number(row.share_price),
        proof_url: row.proof_key ? await signedObjectUrl(row.proof_key) : null,
      })),
    );
  }

  return {
    summary,
    raw: dumpRows,
    generatedAt: nowIso(),
  };
}

function formatScheduledEmailSubject(job, summary) {
  const definition = getDashboardDefinition(job.report_key);

  const reportLabel = definition?.label || "Expense Report";

  const rangeLabel = summary?.rangeLabel || "Selected reporting period";

  return "Scheduled Expense Report PDF Attached — " + reportLabel + " — " + rangeLabel;
}

function formatScheduledEmailBody(job, summary, raw) {
  const definition = getDashboardDefinition(job.report_key);

  const reportLabel = definition?.label || "Expense Report";

  const rangeLabel = summary?.rangeLabel || "the selected reporting period";

  const rowCount = Array.isArray(raw) ? raw.length : 0;

  return `
    <p>
      Attached is the scheduled <strong>${reportLabel}</strong>
      PDF for <strong>${rangeLabel}</strong>.
    </p>
    <p>
      The PDF contains the report summary and visual analysis,
      together with the underlying expense details and share
      information${rowCount ? ` (${rowCount} detail rows)` : ""}.
      Where available, expense proof links are included in the report.
    </p>
  `;
}

export async function sendScheduledReportJob(job) {
  const { summary, raw, generatedAt } = await buildScheduledReport(job.report_key);

  const pdf = await buildScheduledReportPdf({
    summary,
    raw,
    generatedAt,
  });

  const subject = formatScheduledEmailSubject(job, summary);

  const htmlBody = formatScheduledEmailBody(job, summary, raw);

  await sendReportEmail(job.owner_email, pdf, {
    subject,
    htmlBody,
  });

  return {
    recipients: 1,
    rows: raw.length,
    reportKey: job.report_key,
    reportTitle: getDashboardDefinition(job.report_key)?.label || job.report_key,
  };
}

export { normalizePayload };
