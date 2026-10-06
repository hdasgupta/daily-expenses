import cron from "node-cron";
import { q } from "../db/index.js";
import { getDashboardDefinition, runDashboardReport } from "./dashboardReportService.js";
import { buildScheduledReportPdf } from "./scheduledReportPdfService.js";
import { sendReportEmail, sendNotificationEmail } from "./mailService.js";
import { signedObjectUrl } from "./storageService.js";
import { nowIso } from "../utils/dates.js";

const FREQUENCIES = new Set(["daily", "weekly", "monthly", "yearly"]);
function error(message, statusCode = 400) { const result = new Error(message); result.statusCode = statusCode; return result; }
export function reportFrequency(reportKey) { return String(reportKey || "").split("-")[0]; }
function validateTime(value) { const text=String(value||"").trim(); if(!/^\d{2}:\d{2}$/.test(text)) throw error("Choose a valid delivery time."); const [h,m]=text.split(":").map(Number); if(h>23||m>59) throw error("Choose a valid delivery time."); return text; }
function normalizePayload(data={}, existing=null) {
  const reportKey=String(data.reportKey??existing?.report_key??"").trim(), definition=getDashboardDefinition(reportKey); if(!definition) throw error("Choose a valid dashboard report.");
  const frequency=String(data.frequency??existing?.frequency??reportFrequency(reportKey)).trim(); if(!FREQUENCIES.has(frequency)) throw error("Choose daily, weekly, monthly, or yearly delivery."); if(frequency!==reportFrequency(reportKey)) throw error("The delivery frequency must match the dashboard report period.");
  const name=String(data.name??existing?.name??"").trim(); if(!name) throw error("Enter a name for this scheduled report."); if(name.length>150) throw error("The scheduled report name must be 150 characters or fewer.");
  const time=validateTime(data.time??existing?.time_of_day?.slice?.(0,5)??"06:00"); let dayOfWeek=null,dayOfMonth=null,monthOfYear=null;
  if(frequency==="weekly"){dayOfWeek=Number(data.dayOfWeek??existing?.day_of_week??0);if(!Number.isInteger(dayOfWeek)||dayOfWeek<0||dayOfWeek>6)throw error("Choose a valid weekday.");}
  if(frequency==="monthly"){dayOfMonth=Number(data.dayOfMonth??existing?.day_of_month??1);if(!Number.isInteger(dayOfMonth)||dayOfMonth<1||dayOfMonth>28)throw error("Choose a day between 1 and 28 for monthly delivery.");}
  if(frequency==="yearly"){dayOfMonth=Number(data.dayOfMonth??existing?.day_of_month??1);monthOfYear=Number(data.monthOfYear??existing?.month_of_year??1);if(!Number.isInteger(dayOfMonth)||dayOfMonth<1||dayOfMonth>28)throw error("Choose a day between 1 and 28 for yearly delivery.");if(!Number.isInteger(monthOfYear)||monthOfYear<1||monthOfYear>12)throw error("Choose a valid month for yearly delivery.");}
  const [hour,minute]=time.split(":").map(Number); const cronExpression=frequency==="daily"?`${minute} ${hour} * * *`:frequency==="weekly"?`${minute} ${hour} * * ${dayOfWeek}`:frequency==="monthly"?`${minute} ${hour} ${dayOfMonth} * *`:`${minute} ${hour} ${dayOfMonth} ${monthOfYear} *`; if(!cron.validate(cronExpression))throw error("The selected schedule is not valid.");
  return {name,reportKey,frequency,time,dayOfWeek,dayOfMonth,monthOfYear,cronExpression};
}
function decorateJob(row){let nextRunAt=null;if(row.cron_expression&&row.active){try{const task=cron.schedule(row.cron_expression,()=>{},{timezone:"Asia/Kolkata"});const next=task.getNextRun();nextRunAt=next instanceof Date&&!Number.isNaN(next.getTime())?next.toISOString():null;task.stop();task.destroy();}catch(e){console.error(`Unable to calculate next run for scheduled report ${row.id}`,e);}}const definition=getDashboardDefinition(row.report_key);return {...row,time_of_day:String(row.time_of_day||"").slice(0,5),report_label:definition?.label||row.report_key,report_help:definition?.help||"Dashboard report",next_run_at:nextRunAt};}

export async function listScheduledReportJobs({userId,isAdmin=false}){const result=await q(`SELECT j.id,j.name,j.owner_user_id,j.created_by_user_id,j.report_key,j.frequency,j.time_of_day,j.day_of_week,j.day_of_month,j.month_of_year,j.cron_expression,j.active,j.created_at,j.updated_at,u.full_name AS owner_name,u.email AS owner_email,c.full_name AS creator_name,c.email AS creator_email FROM public.scheduled_report_jobs j JOIN public.users u ON u.id=j.owner_user_id LEFT JOIN public.users c ON c.id=j.created_by_user_id WHERE ($1=TRUE OR j.owner_user_id=NULLIF($2::text,'')::bigint) ORDER BY CASE j.frequency WHEN 'daily' THEN 1 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 3 WHEN 'yearly' THEN 4 ELSE 5 END,j.time_of_day,j.name`,[Boolean(isAdmin),userId]);return result.rows.map(decorateJob);}
export async function listScheduleRecipients(){const r=await q(`SELECT u.id,u.full_name,u.email FROM public.users u JOIN public.roles r ON r.id=u.role_id WHERE LOWER(r.name)='manager' AND u.is_disabled=FALSE ORDER BY u.full_name,u.email`);return r.rows;}
async function getJob(id){const r=await q(`SELECT * FROM public.scheduled_report_jobs WHERE id=$1`,[id]);return r.rows[0]||null;}
function canManage(job,user){return user.role==='admin'||String(job.owner_user_id)===String(user.id);}
async function notifyManagers(rows,creator){for(const row of rows){if(!row.owner_email||String(row.owner_user_id)===String(creator.id))continue;try{await sendNotificationEmail(row.owner_email,{subject:`Scheduled report created for you — ${row.name}`,htmlBody:`<p>An administrator scheduled <strong>${row.name}</strong> for you.</p><p><strong>Report:</strong> ${row.report_label||row.report_key}<br/><strong>Description:</strong> ${row.report_help||"Dashboard report"}<br/><strong>Frequency:</strong> ${row.frequency}<br/><strong>Next execution:</strong> ${row.next_run_at?new Date(row.next_run_at).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}):"—"}<br/><strong>Scheduled by:</strong> ${creator.full_name||creator.email}</p>`});}catch(e){console.error("Unable to notify manager about scheduled report",{jobId:row.id,ownerEmail:row.owner_email,error:e?.message||String(e),stack:e?.stack});}}}
export async function createScheduledReportJob(data,user){const config=normalizePayload(data);const targets=user.role==='admin'?Array.isArray(data.targetUserIds)&&data.targetUserIds.length?data.targetUserIds:[user.id]:[user.id];const ids=[...new Set(targets.map(Number).filter(Number.isInteger))];if(!ids.length)throw error("Choose at least one manager.");if(user.role!=='admin'&&ids.some(id=>id!==Number(user.id)))throw error("Only an administrator can schedule for other users.");const recipients=await q(`SELECT u.id,u.full_name,u.email FROM public.users u JOIN public.roles r ON r.id=u.role_id WHERE u.id=ANY($1::bigint[]) AND LOWER(r.name)='manager' AND u.is_disabled=FALSE`,[ids]);if(recipients.rows.length!==ids.length)throw error("One or more selected managers are invalid.");const created=[];for(const recipient of recipients.rows){const r=await q(`INSERT INTO public.scheduled_report_jobs(name,owner_user_id,created_by_user_id,report_key,frequency,time_of_day,day_of_week,day_of_month,month_of_year,cron_expression,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[config.name,recipient.id,user.id,config.reportKey,config.frequency,config.time,config.dayOfWeek,config.dayOfMonth,config.monthOfYear,config.cronExpression,data.active!==false]);created.push({...decorateJob(r.rows[0]),owner_name:recipient.full_name,owner_email:recipient.email});}if(user.role==='admin')await notifyManagers(created,user);return created.length===1?created[0]:{jobs:created};}
export async function updateScheduledReportJob(id,data,user){const existing=await getJob(id);if(!existing)throw error("Scheduled report not found.",404);if(!canManage(existing,user))throw error("You can only edit your own scheduled reports.",403);const config=normalizePayload(data,existing),active=data.active==null?Boolean(existing.active):Boolean(data.active);const r=await q(`UPDATE public.scheduled_report_jobs SET name=$1,report_key=$2,frequency=$3,time_of_day=$4,day_of_week=$5,day_of_month=$6,month_of_year=$7,cron_expression=$8,active=$9,updated_at=now() WHERE id=$10 RETURNING *`,[config.name,config.reportKey,config.frequency,config.time,config.dayOfWeek,config.dayOfMonth,config.monthOfYear,config.cronExpression,active,id]);return decorateJob(r.rows[0]);}
export async function deleteScheduledReportJob(id,user){const existing=await getJob(id);if(!existing)throw error("Scheduled report not found.",404);if(!canManage(existing,user))throw error("You can only remove your own scheduled reports.",403);await q(`DELETE FROM public.scheduled_report_jobs WHERE id=$1`,[id]);}
export async function getScheduledReportForExecution(id){const r=await q(`SELECT j.*,u.email AS owner_email,u.full_name AS owner_name FROM public.scheduled_report_jobs j JOIN public.users u ON u.id=j.owner_user_id WHERE j.id=$1 AND j.active=TRUE`,[id]);return r.rows[0]||null;}
// Execution helpers below intentionally retain the existing implementation.

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
