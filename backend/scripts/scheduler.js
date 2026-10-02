import cron from "node-cron";
import { env } from "../src/config/env.js";
import { sendDashboardToManagers } from "../src/services/dashboardService.js";
import { sendDailyEmailReportToManagers } from "../src/services/dailyEmailReportService.js";
import { sendWeeklyEmailReportToManagers } from "../src/services/weeklyEmailReportService.js";

let started = false;

export function startDashboardScheduler() {
  if (started) return;
  started = true;

  if (!cron.validate(env.dashboardCron)) {
    console.error(`Invalid DASHBOARD_CRON: ${env.dashboardCron}`);
  } else {
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

  if (!cron.validate(env.dailyEmailReportCron)) {
    console.error(`Invalid DAILY_EMAIL_REPORT_CRON: ${env.dailyEmailReportCron}`);
    return;
  }

  cron.schedule(
    env.dailyEmailReportCron,
    async () => {
      try {
        const result = await sendDailyEmailReportToManagers();
        console.log(
          `7-day email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
        );
      } catch (error) {
        console.error("7-day email report job failed", error);
      }
    },
    { timezone: env.dailyEmailReportTimezone },
  );
  console.log(
    `7-day email report scheduler enabled: ${env.dailyEmailReportCron} (${env.dailyEmailReportTimezone})`,
  );

  if (!cron.validate(env.weeklyEmailReportCron)) {
    console.error(`Invalid WEEKLY_EMAIL_REPORT_CRON: ${env.weeklyEmailReportCron}`);
    return;
  }

  cron.schedule(
    env.weeklyEmailReportCron,
    async () => {
      try {
        const result = await sendWeeklyEmailReportToManagers();
        console.log(
          `4-week email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
        );
      } catch (error) {
        console.error("4-week email report job failed", error);
      }
    },
    { timezone: env.weeklyEmailReportTimezone },
  );
  console.log(
    `4-week email report scheduler enabled: ${env.weeklyEmailReportCron} (${env.weeklyEmailReportTimezone})`,
  );

}
