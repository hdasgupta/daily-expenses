import { parentPort, workerData } from "node:worker_threads";
import { buildReportPdfInProcess } from "./reportPdfService.js";
import { buildScheduledReportPdfInProcess } from "./scheduledReportPdfService.js";
import { buildDailyEmailReportPdfInProcess } from "./dailyEmailReportPdfService.js";
import { buildWeeklyEmailReportPdfInProcess } from "./weeklyEmailReportPdfService.js";
import { buildMonthlyEmailReportPdfInProcess } from "./monthlyEmailReportPdfService.js";
import { buildYearlyEmailReportPdfInProcess } from "./yearlyEmailReportPdfService.js";
import { buildDashboardPdfInProcess } from "./dashboardPdfService.js";
import { imageToPdfInProcess } from "./proofPdfRender.js";

const { type, payload } = workerData;

try {
  let pdf;
  switch (type) {
    case "report":
      pdf = await buildReportPdfInProcess(payload.report, payload.config);
      break;
    case "scheduled":
      pdf = await buildScheduledReportPdfInProcess(payload);
      break;
    case "daily":
      pdf = await buildDailyEmailReportPdfInProcess(payload.report);
      break;
    case "weekly":
      pdf = await buildWeeklyEmailReportPdfInProcess(payload.report);
      break;
    case "monthly":
      pdf = await buildMonthlyEmailReportPdfInProcess(payload.report);
      break;
    case "yearly":
      pdf = await buildYearlyEmailReportPdfInProcess(payload.report);
      break;
    case "dashboard":
      pdf = await buildDashboardPdfInProcess(payload.dashboard);
      break;
    case "proof-image":
      pdf = await imageToPdfInProcess(payload.buffer, payload.mimeType);
      break;
    default:
      throw new Error(`Unknown PDF worker task: ${type}`);
  }
  parentPort.postMessage({ ok: true, pdf });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error?.message || String(error),
  });
}
