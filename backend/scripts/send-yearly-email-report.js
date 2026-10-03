import { loadEnv } from "../src/config/env.js";
import { sendYearlyEmailReportToManagers } from "../src/services/yearlyEmailReportService.js";

loadEnv();

try {
  const result = await sendYearlyEmailReportToManagers();
  console.log(
    `12-month email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
  );
} catch (error) {
  console.error("12-month email report failed", error);
  process.exitCode = 1;
}
