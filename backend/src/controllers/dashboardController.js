import { buildDashboard } from "../services/dashboardService.js";

export async function overview(req, res) {
  res.json(await buildDashboard());
}
