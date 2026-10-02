import { buildDashboard } from "../services/dashboardService.js";
import { runDashboardReport } from "../services/dashboardReportService.js";

export async function overview(req, res) {
  res.json(await buildDashboard());
}

export async function queryReport(req, res) {
  const reportKey = String(req.body?.reportKey || "");
  const mode = req.body?.mode === "drilldown" ? "drilldown" : "summary";
  const selection = req.body?.selection && typeof req.body.selection === "object" ? req.body.selection : {};
  res.json(await runDashboardReport(reportKey, mode, selection));
}
