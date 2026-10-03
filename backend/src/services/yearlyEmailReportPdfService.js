import PDFDocument from "pdfkit";

function money(value) { return `₹${Number(value || 0).toFixed(2)}`; }
function dateLabel(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function monthLabel(start, end) { return `${dateLabel(start)} - ${dateLabel(end)}`; }
function pivotSurvivorRows(rows, periodKey, periods = []) {
  const survivors = [...new Set(rows.map((row) => row.survivor || "Unknown"))].sort();
  const grouped = new Map(periods.map((period) => [period, { [periodKey]: period }]));
  for (const row of rows) {
    const key = row[periodKey];
    if (!grouped.has(key)) grouped.set(key, { [periodKey]: key });
    grouped.get(key)[row.survivor || "Unknown"] = Number(row.total || 0);
  }
  return { survivors, rows: [...grouped.values()] };
}
function drawBarChart(doc, data) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 170;
  const startX = doc.page.margins.left + 10;
  const baseline = doc.y + chartHeight;
  const max = Math.max(...data.map((item) => Number(item.total) || 0), 1);
  const barWidth = Math.max(32, Math.min(52, (width - 30) / Math.max(data.length, 1) - 10));
  data.forEach((item, index) => {
    const height = (Number(item.total) / max) * (chartHeight - 35);
    const x = startX + index * (barWidth + 10);
    const y = baseline - height;
    doc.rect(x, y, barWidth, height).fill();
    doc.fillColor("black").fontSize(6).text(dateLabel(item.monthStart).slice(3, 11), x - 5, baseline + 5, { width: barWidth + 10, align: "center" });
    doc.fontSize(7).text(money(item.total), x - 8, y - 12, { width: barWidth + 16, align: "center" });
  });
  doc.y = baseline + 28;
}
function drawSurvivorBarChart(doc, rows, periodKey, survivors, labelFormatter) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 175;
  const startX = doc.page.margins.left + 10;
  const baseline = doc.y + chartHeight;
  const totals = rows.map((row) => survivors.reduce((sum, survivor) => sum + Number(row[survivor] || 0), 0));
  const max = Math.max(...totals, 1);
  const barWidth = Math.max(20, Math.min(42, (width - 20) / Math.max(rows.length, 1) - 8));
  const palette = ["#315f9f", "#4f81bd", "#70ad47", "#ed7d31", "#a5a5a5", "#8064a2", "#ffc000", "#5b9bd5"];
  if (!rows.length || !survivors.length) { doc.fontSize(10).text("No survivor data for this period."); return; }
  rows.forEach((row, index) => {
    const x = startX + index * (barWidth + 8);
    let y = baseline;
    for (let survivorIndex = 0; survivorIndex < survivors.length; survivorIndex += 1) {
      const value = Number(row[survivors[survivorIndex]] || 0);
      const height = (value / max) * (chartHeight - 45);
      if (height > 0) { y -= height; doc.save(); doc.fillColor(palette[survivorIndex % palette.length]); doc.rect(x, y, barWidth, height).fill(); doc.restore(); }
    }
    doc.fillColor("black").fontSize(5.5).text(labelFormatter(row[periodKey]), x - 5, baseline + 5, { width: barWidth + 10, align: "center" });
  });
  const legendY = baseline + 25;
  let legendX = startX;
  survivors.forEach((survivor, index) => {
    const labelWidth = Math.min(100, Math.max(45, doc.widthOfString(survivor, { fontSize: 7 }) + 16));
    if (legendX + labelWidth > doc.page.width - doc.page.margins.right) { legendX = startX; }
    doc.save(); doc.fillColor(palette[index % palette.length]).rect(legendX, legendY, 8, 8).fill(); doc.restore();
    doc.fillColor("black").fontSize(7).text(survivor, legendX + 11, legendY - 1, { width: labelWidth - 11 });
    legendX += labelWidth;
  });
  doc.y = legendY + 18;
}
function drawTable(doc, columns, rows, widths = null) {
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidths = widths || columns.map(() => usableWidth / columns.length);
  const rowHeight = 28;
  const drawRow = (values, header = false, index = 0) => {
    const height = header ? 25 : rowHeight;
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y; let x = doc.page.margins.left;
    columns.forEach((column, columnIndex) => {
      const width = columnWidths[columnIndex];
      doc.save(); doc.fillColor(header ? "#315f9f" : index % 2 ? "#ffffff" : "#eef4fb"); doc.rect(x, y, width, height).fill(); doc.restore();
      doc.strokeColor("#b8c7da").rect(x, y, width, height).stroke();
      const value = values[column]; const isProof = !header && column === "proof" && value;
      doc.fillColor(header ? "#ffffff" : isProof ? "#2563eb" : "#1f2937").fontSize(header ? 7 : 6).font(header ? "Helvetica-Bold" : "Helvetica").text(isProof ? "Download Proof" : String(value ?? "—"), x + 3, y + 5, { width: width - 6, height: height - 7, ellipsis: true, link: isProof ? String(value) : undefined, underline: Boolean(isProof) });
      x += width;
    });
    doc.y = y + height;
  };
  drawRow(Object.fromEntries(columns.map((c) => [c, c.replace(/_/g, " ").toUpperCase()])), true);
  rows.forEach((row, index) => drawRow(row, false, index));
}
function drawPivotTable(doc, periodHeader, rows, survivors) {
  const columns = [periodHeader, ...survivors];
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const firstWidth = 82;
  drawTable(doc, columns, rows.map((row) => {
    const result = { [periodHeader]: row[periodHeader] };
    survivors.forEach((survivor) => { result[survivor] = money(row[survivor]); });
    return result;
  }), [firstWidth, ...survivors.map(() => (usableWidth - firstWidth) / Math.max(survivors.length, 1))]);
}
function uiShareDumpRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.expenseId ?? `${row.date}|${row.category}|${row.item}|${row.comment}`;
    if (!map.has(key)) map.set(key, { ...row, shares: [] });
    const target = map.get(key);
    if (row.survivor && row.survivor !== "—") target.shares.push({ name: row.survivor, amount: Number(row.price || 0) });
  }
  return [...map.values()].map((row) => {
    const total = Number(row.totalCost || row.shares.reduce((sum, item) => sum + item.amount, 0));
    const share = row.shares.length ? row.shares.map((item) => `${item.name}: ₹${item.amount.toFixed(2)}${total ? ` (${((item.amount / total) * 100).toFixed(2)}%)` : ""}`).join(", ") : "No survivor share recorded";
    return { ...row, share };
  });
}
export function buildYearlyEmailReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(20).text("Rehabilitation Center Expense - 12 Month Report");
    doc.fontSize(9).fillColor("#555").text(`Generated: ${report.generatedAt}`);
    doc.fillColor("black").moveDown();
    doc.fontSize(14).text("1. Twelve-month monthly expense bar chart");
    doc.moveDown(0.4); drawBarChart(doc, report.yearlySummary);
    doc.moveDown(); doc.fontSize(14).text("2. Twelve-month monthly summary"); doc.moveDown(0.4);
    drawTable(doc, ["month", "total", "expense_count"], report.yearlySummary.map((row) => ({ month: monthLabel(row.monthStart, row.monthEnd), total: money(row.total), expense_count: row.expenseCount })));
    doc.addPage(); doc.fontSize(14).text("3. Twelve-month monthly group by survivor"); doc.moveDown(0.4);
    const pivot = pivotSurvivorRows(report.survivorSummary.map((row) => ({ ...row, period: row.monthStart })), "period", report.yearlySummary.map((row) => row.monthStart));
    const labels = new Map(report.yearlySummary.map((row) => [row.monthStart, monthLabel(row.monthStart, row.monthEnd)]));
    drawSurvivorBarChart(doc, pivot.rows, "period", pivot.survivors, (value) => labels.get(value) || value);
    doc.moveDown(0.6); drawPivotTable(doc, "month", pivot.rows.map((row) => ({ ...row, month: labels.get(row.period) || row.period })), pivot.survivors);
    doc.addPage(); doc.fontSize(14).text("4. Expense data dump - last 12 completed months"); doc.moveDown(0.4);
    drawTable(doc, ["date", "category", "item", "share", "comment", "proof"], uiShareDumpRows(report.dump).map((row) => ({ date: dateLabel(row.date), category: row.category, item: row.item, share: row.share, comment: row.comment, proof: row.proofUrl })), [55, 90, 100, 125, 75, 55]);
    doc.end();
  });
}
