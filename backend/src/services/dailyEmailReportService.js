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
  const config = {
    dateFilterType: "range",
    filters: { dateFrom, dateTo },
    groupBy: [],
    sortColumns: [],
    summarise: false,
  };
  const report = await runReport(config);
  return { report, config, dateFrom, dateTo };
}

export async function sendDailyEmailReportToManagers() {
  const { report, config } = await buildDailyEmailReport();
  const pdf = await buildReportPdf(report, config);
  const result = await q(userSql.managers);

  for (const row of result.rows) {
    await sendReportEmail(row.email, pdf);
  }

  return { recipients: result.rows.length, rows: report.rows.length };
}
