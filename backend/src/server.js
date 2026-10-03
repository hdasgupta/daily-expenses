import express from "express";
import cors from "cors";
import { env, loadEnv } from "./config/env.js";
import { initDb, pool } from "./db/index.js";
import { seedApplication } from "./services/bootstrapService.js";
import { createRouter } from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { startEmailSchedulers } from "../scripts/scheduler.js";

loadEnv();

const app = express();
const origins = env.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = origins.includes("*") ? true : origins;

app.use(
  cors({
    origin: corsOrigin || true,
    credentials: false,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use("/api", createRouter(env.maxUploadBytes));
app.use(notFound);
app.use(errorHandler);

app.locals.ready = false;

async function start() {
  const server = app.listen(env.port, "0.0.0.0", () => {
    console.log(`Expense tracker backend listening on port ${env.port}`);
  });

  server.on("error", (error) => {
    console.error("HTTP server error", error);
    process.exitCode = 1;
  });

  try {
    console.log("Backend startup: initializing database");
    await initDb();
    console.log("Backend startup: database initialized");

    console.log("Backend startup: seeding application");
    await seedApplication();
    console.log("Backend startup: application seeded");

    startEmailSchedulers();
    app.locals.ready = true;
    console.log("Backend startup: application ready");
  } catch (error) {
    app.locals.startupError = error?.message || String(error);
    console.error("Fatal startup error", error);
    await pool.end();
    server.close(() => process.exit(1));
  }
}

start();

export default app;
