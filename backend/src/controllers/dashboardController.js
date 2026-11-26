import { buildDashboard } from "../services/dashboardService.js";
import { runDashboardReport } from "../services/dashboardReportService.js";
import {
  deleteUserDashboardFilterPreset,
  getUserDashboardFilters,
  listUserDashboardFilterPresets,
  saveUserDashboardFilterPreset,
  saveUserDashboardFilters,
} from "../services/dashboardFilterService.js";

export async function overview(req, res) {
  res.json(await buildDashboard());
}

export async function queryReport(req, res) {
  const reportKey = String(req.body?.reportKey || "");
  const mode = req.body?.mode === "drilldown" ? "drilldown" : "summary";
  const selection =
    req.body?.selection && typeof req.body.selection === "object" ? req.body.selection : {};
  res.json(await runDashboardReport(reportKey, mode, selection));
}

export async function getFilters(req, res) {
  res.json(await getUserDashboardFilters(req.user.id, req.params.reportKey));
}

export async function saveFilters(req, res) {
  res.json(await saveUserDashboardFilters(req.user.id, req.params.reportKey, req.body || {}));
}

export async function listFilterPresets(req, res) {
  res.json(await listUserDashboardFilterPresets(req.user.id));
}

export async function saveFilterPreset(req, res) {
  res.json(await saveUserDashboardFilterPreset(req.user.id, req.body || {}));
}

export async function deleteFilterPreset(req, res) {
  res.json(await deleteUserDashboardFilterPreset(req.user.id, req.params.id));
}
