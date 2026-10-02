import { loadEnv } from "../src/config/env.js";
import { sendWeeklyEmailReportToManagers } from "../src/services/weeklyEmailReportService.js";

loadEnv();

try {
  const result = await sendWeeklyEmailReportToManagers();
  console.log(
    `4-week email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
  );
} catch (error) {
  console.error("4-week email report failed", error);
  process.exitCode = 1;
}
