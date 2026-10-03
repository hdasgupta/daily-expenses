import { userSql } from "../../scripts/sql/userSql.js";
import { q } from "../db/index.js";
import { buildReportPdf } from "./reportPdfService.js";
import { runReport } from "./reportService.js";
import { sendReportEmail } from "./mailService.js";

function localDateParts(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return Object.fromEntries(
    parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]),
  );
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDailyReportRange() {
  const { year, month, day } = localDateParts("Asia/Kolkata");
  const today = `${year}-${month}-${day}`;
  return {
    dateFrom: shiftDate(today, -7),
    dateTo: shiftDate(today, -1),
  };
}

export async function buildDailyEmailReport() {
  const { dateFrom, dateTo } = getDailyReportRange();
  console.log(
    JSON.stringify({
      event: "daily_email_report_build_started",
      timestamp: new Date().toISOString(),
      timezone: "Asia/Kolkata",
      dateFrom,
      dateTo,
    }),
  );

  const config = {
    dateFilterType: "range",
    filters: { dateFrom, dateTo },
    groupBy: [],
    sortColumns: [],
    summarise: false,
  };
  const report = await runReport(config);

  console.log(
    JSON.stringify({
      event: "daily_email_report_build_completed",
      timestamp: new Date().toISOString(),
      dateFrom,
      dateTo,
      rows: report.rows.length,
    }),
  );

  return { report, config, dateFrom, dateTo };
}

export async function sendDailyEmailReportToManagers() {
  console.log(
    JSON.stringify({
      event: "daily_email_report_send_started",
      timestamp: new Date().toISOString(),
    }),
  );

  try {
    const { report, config } = await buildDailyEmailReport();
    const pdf = await buildReportPdf(report, config);
    const result = await q(userSql.managers);

    console.log(
      JSON.stringify({
        event: "daily_email_report_recipients_loaded",
        timestamp: new Date().toISOString(),
        recipients: result.rows.length,
        rows: report.rows.length,
        pdfBytes: pdf.length,
      }),
    );

    let sent = 0;
    for (const row of result.rows) {
      try {
        await sendReportEmail(row.email, pdf);
        sent += 1;
        console.log(
          JSON.stringify({
            event: "daily_email_report_recipient_sent",
            timestamp: new Date().toISOString(),
            recipient: row.email,
            sent,
            total: result.rows.length,
          }),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "daily_email_report_recipient_failed",
            timestamp: new Date().toISOString(),
            recipient: row.email,
            error: error?.message || String(error),
            stack: error?.stack,
          }),
        );
        throw error;
      }
    }

    console.log(
      JSON.stringify({
        event: "daily_email_report_send_completed",
        timestamp: new Date().toISOString(),
        recipients: sent,
        rows: report.rows.length,
      }),
    );

    return { recipients: sent, rows: report.rows.length };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "daily_email_report_send_failed",
        timestamp: new Date().toISOString(),
        error: error?.message || String(error),
        stack: error?.stack,
      }),
    );
    throw error;
  }
}
