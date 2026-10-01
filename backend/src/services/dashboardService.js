import { q } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { dashboardSql } from "../../scripts/sql/dashboardSql.js";
import { sendDashboardEmail } from "./mailService.js";
import { buildDashboardPdf } from "./dashboardPdfService.js";

const limits = { day: 7, week: 4, month: 3, year: 2 };
const publicNames = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };

export async function buildDashboard() {
  const periods = {};
  const breakdowns = {};
  for (const unit of Object.keys(limits)) {
    const def = dashboardSql.trend[unit];
    const result = await q(dashboardSql.trendQuery(def.expression, def.start), [
      unit,
      limits[unit],
    ]);
    periods[publicNames[unit]] = result.rows.map((row) => ({
      label: String(row.bucket).slice(0, 10),
      total: Number(row.total || 0),
    }));
    for (const by of Object.keys(dashboardSql.breakdown)) {
      const item = dashboardSql.breakdown[by];
      const data = await q(
        dashboardSql.breakdownQuery(
          def.expression,
          item.idField,
          item.field,
          item.amount,
          item.join,
          def.start,
        ),
        [unit, limits[unit]],
      );
      breakdowns[`${publicNames[unit]}${by[0].toUpperCase() + by.slice(1)}`] = data.rows.map(
        (row) => ({
          label: String(row.bucket).slice(0, 10),
          name: row.name || "Unknown",
          entityId: row.entity_id,
          total: Number(row.total || 0),
          unit,
          by,
        }),
      );
    }
  }
  return { generatedAt: new Date().toISOString(), periods, breakdowns };
}

export async function sendDashboardToManagers() {
  const dashboard = await buildDashboard();
  const pdf = await buildDashboardPdf(dashboard);
  const result = await q(userSql.managers);
  for (const row of result.rows)
    await sendDashboardEmail(row.email, pdf, dashboard.generatedAt.slice(0, 10));
  return { recipients: result.rows.length };
}
