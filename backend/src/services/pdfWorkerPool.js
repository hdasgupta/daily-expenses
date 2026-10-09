import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";

const maxWorkers = Math.max(1, Math.min(2, availableParallelism() - 1));
const queue = [];
let activeWorkers = 0;

/** Run CPU-heavy PDF rendering away from the HTTP event loop. */
export function runPdfInWorker(type, payload) {
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
  try {
    worker = new Worker(new URL("./pdfWorker.js", import.meta.url), {
      workerData: { type: job.type, payload: job.payload },
    });
  } catch (error) {
    activeWorkers -= 1;
    job.reject(error);
    processQueue();
    return;
  }

  const finish = (error, result) => {
    if (settled) return;
    settled = true;
    activeWorkers -= 1;
    if (error) job.reject(error);
    else job.resolve(Buffer.from(result));
    void worker.terminate().catch(() => {}).finally(processQueue);
  };

  worker.once("message", (message) => {
    if (!message?.ok) {
      finish(new Error(message?.error || "PDF generation failed"));
      return;
    }
    finish(null, message.pdf);
  });
  worker.once("error", (error) => finish(error));
  worker.once("exit", (code) => {
    if (!settled) {
      finish(new Error(`PDF worker exited unexpectedly with code ${code}`));
    }
  });
}
