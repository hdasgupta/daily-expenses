import PDFDocument from "pdfkit";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function dateLabel(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function weekLabel(start, end) {
  return `${dateLabel(start)} - ${dateLabel(end)}`;
}

function drawBarChart(doc, data) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 170;
  const startX = doc.page.margins.left + 20;
  const baseline = doc.y + chartHeight;
  const max = Math.max(...data.map((item) => Number(item.total) || 0), 1);
  const barWidth = Math.max(55, (width - 30) / Math.max(data.length, 1) - 18);

  data.forEach((item, index) => {
    const height = (Number(item.total) / max) * (chartHeight - 30);
    const x = startX + index * (barWidth + 18);
    const y = baseline - height;
    doc.rect(x, y, barWidth, height).fill();
    doc.fillColor("black").fontSize(7).text(
      weekLabel(item.weekStart, item.weekEnd),
      x - 10,
      baseline + 5,
      { width: barWidth + 20, align: "center" },
    );
    doc.fontSize(8).text(money(item.total), x - 10, y - 13, {
      width: barWidth + 20,
      align: "center",
    });
  });
  doc.y = baseline + 35;
}

function uiShareDumpRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.expenseId ?? `${row.date}|${row.category}|${row.item}|${row.comment}`;
    if (!map.has(key)) map.set(key, { ...row, shares: [] });
    const target = map.get(key);
    if (row.survivor && row.survivor !== "—") {
      target.shares.push({ name: row.survivor, amount: Number(row.price || 0) });
    }
  }
  return [...map.values()].map((row) => {
    const total = Number(row.totalCost || row.shares.reduce((sum, item) => sum + item.amount, 0));
    const survivor = row.shares.length ? row.shares.map((item) => item.name).join(", ") : "—";
    const share = row.shares.length
      ? row.shares.map((item) => `${item.name}: ₹${item.amount.toFixed(2)}${total ? ` (${((item.amount / total) * 100).toFixed(2)}%)` : ""}`).join(", ")
      : "No survivor share recorded";
    return { ...row, survivor, share };
  });
}

function drawTable(doc, columns, rows, widths = null) {
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidths = widths || columns.map(() => usableWidth / columns.length);
  const headerHeight = 25;
  const rowHeight = 28;

  const row = (values, header = false, index = 0) => {
    const height = header ? headerHeight : rowHeight;
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    let x = doc.page.margins.left;
    columns.forEach((column, columnIndex) => {
      const width = columnWidths[columnIndex];
      doc.save();
      doc.fillColor(header ? "#315f9f" : index % 2 ? "#ffffff" : "#eef4fb");
      doc.rect(x, y, width, height).fill();
      doc.restore();
      doc.strokeColor("#b8c7da").rect(x, y, width, height).stroke();
      doc.fillColor(header ? "#ffffff" : "#1f2937")
        .fontSize(header ? 7 : 6)
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .text(String(values[column] ?? "—"), x + 3, y + 5, {
          width: width - 6,
          height: height - 7,
          ellipsis: true,
        });
      x += width;
    });
    doc.y = y + height;
  };

  row(Object.fromEntries(columns.map((c) => [c, c.replace(/_/g, " ").toUpperCase()])), true);
  rows.forEach((item, index) => row(item, false, index));
}

export function buildWeeklyEmailReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Rehabilitation Center Expense - 4 Week Report");
    doc.fontSize(9).fillColor("#555").text(`Generated: ${report.generatedAt}`);
    doc.fillColor("black").moveDown();

    doc.fontSize(14).text("1. Four-week weekly expense bar chart");
    doc.moveDown(0.4);
    drawBarChart(doc, report.weeklySummary);

    doc.moveDown();
    doc.fontSize(14).text("2. Four-week weekly summary");
    doc.moveDown(0.4);
    drawTable(doc, ["week", "total", "expense_count"], report.weeklySummary.map((row) => ({
      week: weekLabel(row.weekStart, row.weekEnd),
      total: money(row.total),
      expense_count: row.expenseCount,
    })));

    doc.addPage();
    doc.fontSize(14).text("3. Four-week weekly group by survivor");
    doc.moveDown(0.4);
    drawTable(doc, ["week", "survivor", "total"], report.survivorSummary.map((row) => ({
      week: weekLabel(row.weekStart, row.weekEnd),
      survivor: row.survivor,
      total: money(row.total),
    })));

    doc.addPage();
    doc.fontSize(14).text("4. Expense data dump - last 4 completed weeks");
    doc.moveDown(0.4);
    drawTable(doc, ["date", "category", "item", "share", "comment"], report.dump.map((row) => ({
      date: dateLabel(row.date),
      category: row.category,
      item: row.item,
      survivor: row.survivor,
      price: money(row.price),
      comment: row.comment,
    })), [60, 100, 115, 100, 65, 145]);

    doc.end();
  });
}
