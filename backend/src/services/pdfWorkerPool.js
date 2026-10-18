import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { buildReportPdfInProcess } from "./reportPdfService.js";
import { buildScheduledReportPdfInProcess } from "./scheduledReportPdfService.js";
import { buildDailyEmailReportPdfInProcess } from "./dailyEmailReportPdfService.js";
import { buildWeeklyEmailReportPdfInProcess } from "./weeklyEmailReportPdfService.js";
import { buildMonthlyEmailReportPdfInProcess } from "./monthlyEmailReportPdfService.js";
import { buildYearlyEmailReportPdfInProcess } from "./yearlyEmailReportPdfService.js";
import { buildDashboardPdfInProcess } from "./dashboardPdfService.js";
import { imageToPdfInProcess } from "./proofPdfRender.js";

const maxWorkers = Math.max(1, Math.min(2, availableParallelism() - 1));
const WORKER_TIMEOUT_MS = 45_000;
const queue = [];
let activeWorkers = 0;

async function runPdfInProcessFallback(type, payload) {
  switch (type) {
    case "report":
      return buildReportPdfInProcess(payload.report, payload.config);
    case "scheduled":
      return buildScheduledReportPdfInProcess(payload);
    case "daily":
      return buildDailyEmailReportPdfInProcess(payload.report);
    case "weekly":
      return buildWeeklyEmailReportPdfInProcess(payload.report);
    case "monthly":
      return buildMonthlyEmailReportPdfInProcess(payload.report);
    case "yearly":
      return buildYearlyEmailReportPdfInProcess(payload.report);
    case "dashboard":
      return buildDashboardPdfInProcess(payload.dashboard);
    case "proof-image":
      return imageToPdfInProcess(payload.buffer, payload.mimeType);
    default:
      throw new Error(`Unknown PDF worker task: ${type}`);
  }
}

/** Run CPU-heavy PDF rendering away from the HTTP event loop, with timeout and in-process fallback. */
export function runPdfInWorker(type, payload) {
  if (process.env.VERCEL === "1") {
    return runPdfInProcessFallback(type, payload);
  }

  return new Promise((resolve, reject) => {
    queue.push({ type, payload, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  while (activeWorkers < maxWorkers && queue.length) {
    const job = queue.shift();
    activeWorkers += 1;
    runJob(job);
  }
}

function runJob(job) {
  let settled = false;
  let worker;
  let timer;

  const fallbackOrFinish = (error, result) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    activeWorkers -= 1;

    const cleanupPromise = worker
      ? worker.terminate().catch(() => {})
      : Promise.resolve();

    cleanupPromise.finally(processQueue);

    if (!error && result) {
      job.resolve(Buffer.from(result));
      return;
    }

    // Fall back to in-process generation if worker failed to spawn or timed out
    runPdfInProcessFallback(job.type, job.payload)
      .then((pdf) => job.resolve(Buffer.from(pdf)))
      .catch(() => job.reject(error || new Error("PDF generation failed")));
  };

  try {
    worker = new Worker(new URL("./pdfWorker.js", import.meta.url), {
      workerData: { type: job.type, payload: job.payload },
    });
  } catch (error) {
    fallbackOrFinish(error, null);
    return;
  }

  timer = setTimeout(() => {
    fallbackOrFinish(new Error(`PDF worker timed out after ${WORKER_TIMEOUT_MS}ms`), null);
  }, WORKER_TIMEOUT_MS);

  worker.once("message", (message) => {
    if (!message?.ok) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      activeWorkers -= 1;
      void worker.terminate().catch(() => {}).finally(processQueue);
      job.reject(new Error(message?.error || "PDF generation failed"));
      return;
    }
    fallbackOrFinish(null, message.pdf);
  });
  worker.once("error", (error) => fallbackOrFinish(error, null));
  worker.once("exit", (code) => {
    if (!settled) {
      fallbackOrFinish(new Error(`PDF worker exited unexpectedly with code ${code}`), null);
    }
  });
}
