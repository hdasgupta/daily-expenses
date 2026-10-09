import crypto from "crypto";
import { runPdfInWorker } from "./pdfWorkerPool.js";
import { uploadObject } from "./storageService.js";
import { setProofKey } from "../models/expenseModel.js";

const allowedPdf = "application/pdf";
const allowedImages = new Set(["image/png", "image/jpeg", "image/jpg"]);
function imageToPdf(buffer, mimeType) {
  return runPdfInWorker("proof-image", { buffer, mimeType });
}
export async function uploadExpenseProof(expenseId, file) {
  if (file.mimetype !== allowedPdf && !allowedImages.has(file.mimetype))
    throw new Error("Only PDF, PNG, or JPEG proof files are supported");
  const buffer = allowedImages.has(file.mimetype)
    ? await imageToPdf(file.buffer, file.mimetype)
    : file.buffer;
  const key = `expense-proofs/${expenseId}/${crypto.randomUUID()}.pdf`;
  await uploadObject(key, buffer, "application/pdf");
  await setProofKey(expenseId, key);
  return key;
}
export async function uploadRemoteProof(expenseId, url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") || allowedPdf)
    .split(";")[0]
    .trim()
    .toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  if (contentType.includes("text/html"))
    throw new Error(
      "Google Drive returned an HTML page instead of the file. Make the Drive file accessible to anyone with the link.",
    );
  const fileLike = { mimetype: contentType, buffer };
  return uploadExpenseProof(expenseId, fileLike);
}
