import express from "express";
import cors from "cors";
import { env, loadEnv } from "./config/env.js";
import { initDb, pool } from "./db/index.js";
import { seedApplication } from "./services/bootstrapService.js";
import { createRouter } from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { startEmailSchedulers } from "../scripts/scheduler.js";
import { startScheduledReportScheduler } from "./services/scheduledReportScheduler.js";

loadEnv();

const app = express();
const origins = env.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = origins.includes("*") ? true : origins;

app.disable("x-powered-by");
app.use(
  cors({
    origin: corsOrigin || true,
    credentials: false,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(requestLogger);
app.use("/api", createRouter(env.maxUploadBytes));
app.use(notFound);
app.use(errorHandler);

app.locals.ready = false;
app.locals.starting = true;
app.locals.startupError = null;

let httpServer = null;
let shuttingDown = false;

process.on("uncaughtException", (error) => {
  console.error(
    JSON.stringify({
      event: "uncaught_exception",
      message: error?.message || String(error),
      stack: error?.stack,
    }),
  );
  process.exitCode = 1;
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  console.error(
    JSON.stringify({
      event: "unhandled_rejection",
      message: reason?.message || String(reason),
      stack: reason?.stack,
    }),
  );
  process.exitCode = 1;
  void shutdown("unhandledRejection");
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.locals.ready = false;
  app.locals.starting = false;

  console.log(JSON.stringify({ event: "shutdown_started", signal }));

  const closeServer = new Promise((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(() => resolve());
  });

  try {
    await Promise.race([
      closeServer,
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
  } catch (error) {
    console.error("HTTP server shutdown error", error);
  }

  try {
    await pool.end();
  } catch (error) {
    console.error("Database pool shutdown error", error);
  }

  console.log(JSON.stringify({ event: "shutdown_completed", signal }));
  if (signal === "SIGTERM" || signal === "SIGINT") process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

async function start() {
  httpServer = app.listen(env.port, "0.0.0.0", () => {
    console.log(
      JSON.stringify({
        event: "http_server_listening",
        port: env.port,
        pid: process.pid,
        nodeEnv: env.nodeEnv,
      }),
    );
  });

  httpServer.on("error", (error) => {
    console.error(
      JSON.stringify({
        event: "http_server_error",
        message: error?.message || String(error),
        stack: error?.stack,
      }),
    );
    void shutdown("httpServerError");
  });

  try {
    console.log("Backend startup: initializing database");
    await initDb();
    console.log("Backend startup: database initialized");

    console.log("Backend startup: seeding application");
    await seedApplication();
    console.log("Backend startup: application seeded");

    startEmailSchedulers();
    startScheduledReportScheduler();

    app.locals.starting = false;
    app.locals.ready = true;
    console.log(
      JSON.stringify({
        event: "application_ready",
        pid: process.pid,
        uptimeSeconds: process.uptime(),
      }),
    );
  } catch (error) {
    app.locals.starting = false;
    app.locals.startupError = error?.message || String(error);
    console.error(
      JSON.stringify({
        event: "fatal_startup_error",
        message: error?.message || String(error),
        stack: error?.stack,
      }),
    );
    await shutdown("startupFailure");
    process.exit(1);
  }
}

void start();

export default app;
