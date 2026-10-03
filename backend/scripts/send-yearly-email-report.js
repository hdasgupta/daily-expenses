import { loadEnv } from "../src/config/env.js";
import { sendYearlyEmailReportToManagers } from "../src/services/yearlyEmailReportService.js";

loadEnv();

try {
  const result = await sendYearlyEmailReportToManagers();
  console.log(
    `2-year email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s)`,
  );
} catch (error) {
  console.error("2-year email report failed", error);
  process.exitCode = 1;
}
