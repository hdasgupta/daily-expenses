import crypto from "crypto";
import PDFDocument from "pdfkit";
import { uploadObject } from "./storageService.js";
import { setProofKey } from "../models/expenseModel.js";

const allowedPdf = "application/pdf";
const allowedImages = new Set(["image/png", "image/jpeg", "image/jpg"]);
function imageToPdf(buffer, mimeType) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      doc.fontSize(12).text("Expense proof", { align: "center" });
      doc.moveDown();
      doc.image(buffer, 36, 72, {
        fit: [523, 700],
        align: "center",
        valign: "center",
      });
      doc.end();
    } catch (error) {
      reject(new Error(`Unable to convert ${mimeType} to PDF: ${error.message}`));
    }
  });
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
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") || allowedPdf).split(";")[0].trim();
  const buffer = Buffer.from(await response.arrayBuffer());
  const fileLike = { mimetype: contentType, buffer };
  return uploadExpenseProof(expenseId, fileLike);
}
