import { initDb, pool } from "../src/db/index.js";
import { seedApplication } from "../src/services/bootstrapService.js";
import { sendDashboardToManagers } from "../src/services/dashboardService.js";

try {
  await initDb();
  await seedApplication();
  const result = await sendDashboardToManagers();
  console.log(`Dashboard report sent to ${result.recipients} manager(s).`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
