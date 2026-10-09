import PDFDocument from "pdfkit";

/** CPU-intensive image decoding and PDF rendering, intended for a worker thread. */
export function imageToPdfInProcess(buffer, mimeType) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      doc.fontSize(12).text("Expense proof", { align: "center" });
      doc.moveDown();
      doc.image(buffer, 36, 72, { fit: [523, 700], align: "center", valign: "center" });
      doc.end();
    } catch (error) {
      reject(new Error(`Unable to convert ${mimeType} to PDF: ${error.message}`));
    }
  });
}
