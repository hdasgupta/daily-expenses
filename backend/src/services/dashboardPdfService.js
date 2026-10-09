import PDFDocument from "pdfkit";
import { runPdfInWorker } from "./pdfWorkerPool.js";

function formatMoney(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function drawBarChart(doc, title, data, width = 520) {
  doc.fontSize(13).text(title);
  doc.moveDown(0.4);
  if (!data.length) {
    doc.fontSize(10).text("No expense data for this period.");
    doc.moveDown();
    return;
  }
  const max = Math.max(...data.map((item) => Number(item.total) || 0), 1);
  const chartHeight = 170;
  const barWidth = Math.max(24, (width - 50) / data.length - 8);
  const startX = 45;
  const startY = doc.y + chartHeight;
  doc.fontSize(8);
  data.forEach((item, index) => {
    const height = (Number(item.total) / max) * (chartHeight - 25);
    const x = startX + index * (barWidth + 8);
    const y = startY - height;
    doc.rect(x, y, barWidth, height).fill();
    doc.fillColor("black").text(String(item.label).slice(0, 12), x - 5, startY + 5, {
      width: barWidth + 10,
      align: "center",
    });
    doc.text(formatMoney(item.total), x - 8, y - 12, { width: barWidth + 16, align: "center" });
  });
  doc.y = startY + 28;
}

export function buildDashboardPdfInProcess(dashboard) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Rehabilitation Center Expense Dashboard");
    doc.fontSize(9).fillColor("#555").text(`Generated: ${dashboard.generatedAt}`);
    doc.fillColor("black").moveDown();
    drawBarChart(doc, "Daily expenses - last 7 days", dashboard.periods.daily);
    drawBarChart(doc, "Weekly expenses - last 4 weeks", dashboard.periods.weekly);
    doc.addPage();
    drawBarChart(doc, "Monthly expenses - last 3 months", dashboard.periods.monthly);
    drawBarChart(doc, "Yearly expenses - last 2 years", dashboard.periods.yearly);
    doc.addPage();

    for (const [key, data] of Object.entries(dashboard.breakdowns)) {
      const title = key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
      const grouped = Object.values(
        data.reduce((acc, row) => {
          const bucket = `${row.label} / ${row.name}`;
          acc[bucket] = { label: bucket, total: row.total };
          return acc;
        }, {}),
      ).slice(0, 12);
      drawBarChart(doc, title, grouped);
      if (doc.y > 700) doc.addPage();
    }
    doc.end();
  });
}

export function buildDashboardPdf(dashboard) {
  return runPdfInWorker("dashboard", { dashboard });
}
