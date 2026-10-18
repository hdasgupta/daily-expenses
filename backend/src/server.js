import express from "express";
import cors from "cors";
import { env, loadEnv } from "./config/env.js";
import { initDb, pool } from "./db/index.js";
import { seedApplication } from "./services/bootstrapService.js";
import { createRouter } from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import {
  startEmailSchedulers,
  reconcileStaleEmailExecutions,
} from "../scripts/scheduler.js";
import {
  startScheduledReportScheduler,
  reconcileStaleScheduledReportRuns,
} from "./services/scheduledReportScheduler.js";
import {
  startOneTimeReportEmailScheduler,
  ensureOneTimeReportEmailSchedulerSchema,
  reconcileStaleOneTimeReportEmailJobs,
} from "./services/oneTimeReportEmailService.js";

loadEnv();

const app = express();
const isVercel = process.env.VERCEL === "1";
let startupPromise = null;
// Allow a warm Vercel instance to recover after a transient database connection
// timeout instead of returning 503 forever after its first failed startup.
let lastStartupAttemptAt = Date.now();

const configuredOrigins = env.corsOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/*
 * Capacitor Android serves the application from a localhost
 * origin rather than the Vite development port.
 *
 * Keep the explicitly configured web origins and add the
 * standard Capacitor localhost origins.
 */
const capacitorOrigins = [
  "http://localhost",
  "https://localhost",
  "capacitor://localhost",
  "ionic://localhost",
  "https://daily-expenses-wbffmh.vercel.app",
];

const origins = [...new Set([...configuredOrigins, ...capacitorOrigins])];

const corsOrigin = origins.includes("*") ? true : origins;

app.disable("x-powered-by");

app.use(
  cors({
    origin: corsOrigin,
    credentials: false,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(requestLogger);

// Vercel reuses serverless instances across requests. Wait for one-time
// database/bootstrap initialization before any API handler touches the pool.
if (isVercel) {
  app.use(async (req, res, next) => {
    // Keep health checks reachable even when startup has failed, so readiness
    // diagnostics can report the current state.
    if (req.path === "/api/health" || req.path === "/api/health/ready") {
      return next();
    }

    try {
      if (startupPromise) await startupPromise;

      // PostgreSQL pool connection timeouts can be transient under serverless
      // cold starts. Retry a failed initialization with a cooldown, while the
      // starting flag prevents duplicate concurrent retries in this instance.
      if (
        !app.locals.ready &&
        !app.locals.starting &&
        Date.now() - lastStartupAttemptAt >= 15000
      ) {
        app.locals.starting = true;
        lastStartupAttemptAt = Date.now();
        startupPromise = start();
        await startupPromise;
      }

      if (!app.locals.ready) {
        return res.status(503).json({
          error: "Backend initialization failed or is still in progress",
          status: app.locals.starting ? "starting" : "unavailable",
        });
      }
      return next();
    } catch (error) {
      console.error("Vercel request initialization failed", error);
      return res.status(503).json({ error: "Backend initialization failed" });
    }
  });
}

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

  if (!isVercel) {
    process.exitCode = 1;
    void shutdown("uncaughtException");
  }
});

process.on("unhandledRejection", (reason) => {
  console.error(
    JSON.stringify({
      event: "unhandled_rejection",
      message: reason?.message || String(reason),
      stack: reason?.stack,
    }),
  );

  if (!isVercel) {
    process.exitCode = 1;
    void shutdown("unhandledRejection");
  }
});

async function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;
  app.locals.ready = false;
  app.locals.starting = false;

  console.log(
    JSON.stringify({
      event: "shutdown_started",
      signal,
    }),
  );

  const closeServer = new Promise((resolve) => {
    if (!httpServer) return resolve();

    httpServer.close(() => resolve());
  });

  try {
    await Promise.race([closeServer, new Promise((resolve) => setTimeout(resolve, 10000))]);
  } catch (error) {
    console.error("HTTP server shutdown error", error);
  }

  try {
    await pool.end();
  } catch (error) {
    console.error("Database pool shutdown error", error);
  }

  console.log(
    JSON.stringify({
      event: "shutdown_completed",
      signal,
    }),
  );

  if (signal === "SIGTERM" || signal === "SIGINT") {
    process.exit(0);
  }

  process.exit(1);
}

if (!isVercel) {
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

async function start() {
  if (!isVercel) {
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
  }

  try {
    console.log("Backend startup: initializing database");

    await initDb();
    await ensureOneTimeReportEmailSchedulerSchema();

    console.log("Backend startup: database initialized");

    console.log("Backend startup: seeding application");

    await seedApplication();

    console.log("Backend startup: application seeded");

    await Promise.all([
      reconcileStaleScheduledReportRuns(),
      reconcileStaleEmailExecutions(),
      reconcileStaleOneTimeReportEmailJobs(),
    ]);

    if (!isVercel) {
      startEmailSchedulers();
      startScheduledReportScheduler();
      startOneTimeReportEmailScheduler();
    }

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

    if (!isVercel) {
      await shutdown("startupFailure");
      process.exit(1);
    }
  }
}

startupPromise = start();

export default app;
