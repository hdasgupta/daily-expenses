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

async function start() {
  await initDb();
  await seedApplication();
  startEmailSchedulers();
  app.listen(env.port, "0.0.0.0", () => {
    console.log(`Expense tracker backend listening on port ${env.port}`);
  });
}

start().catch(async (error) => {
  console.error("Fatal startup error", error);
  await pool.end();
  process.exit(1);
});

export default app;
