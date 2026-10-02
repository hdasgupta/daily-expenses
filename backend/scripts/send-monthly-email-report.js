import { loadEnv } from "../src/config/env.js";
import { sendMonthlyEmailReportToManagers } from "../src/services/monthlyEmailReportService.js";

loadEnv();

try {
  const result = await sendMonthlyEmailReportToManagers();
  console.log(
    `3-month email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
  );
} catch (error) {
  console.error("3-month email report failed", error);
  process.exitCode = 1;
}
