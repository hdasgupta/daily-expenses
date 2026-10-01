import cron from "node-cron";
import { env } from "../src/config/env.js";
import { sendDashboardToManagers } from "../src/services/dashboardService.js";

let started = false;

export function startDashboardScheduler() {
  if (started) return;
  started = true;
  if (!cron.validate(env.dashboardCron)) {
    console.error(`Invalid DASHBOARD_CRON: ${env.dashboardCron}`);
    return;
  }
  cron.schedule(
    env.dashboardCron,
    async () => {
      try {
        const result = await sendDashboardToManagers();
        console.log(`Dashboard job sent to ${result.recipients} manager(s)`);
      } catch (error) {
        console.error("Dashboard job failed", error);
      }
    },
    { timezone: env.dashboardTimezone },
  );
  console.log(`Dashboard scheduler enabled: ${env.dashboardCron} (${env.dashboardTimezone})`);
}
