import { initDb, pool } from "../src/db/index.js";
import { seedApplication } from "../src/services/bootstrapService.js";
import { sendDailyEmailReportToManagers } from "../src/services/dailyEmailReportService.js";

try {
  await initDb();
  await seedApplication();
  const result = await sendDailyEmailReportToManagers();
  console.log(
    `7-day email report sent to ${result.recipients} manager(s), ${result.rows} dump row(s).`,
  );
} catch (error) {
  console.error("7-day email report failed", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
