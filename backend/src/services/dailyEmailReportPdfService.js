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

function drawBarChart(doc, data) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 170;
  const startX = doc.page.margins.left + 20;
  const baseline = doc.y + chartHeight;
  const max = Math.max(...data.map((item) => Number(item.total) || 0), 1);
  const barWidth = Math.max(24, (width - 30) / Math.max(data.length, 1) - 10);

  if (!data.length) {
    doc.fontSize(10).text("No expense data for this period.").moveDown();
    return;
  }

  data.forEach((item, index) => {
    const height = (Number(item.total) / max) * (chartHeight - 30);
    const x = startX + index * (barWidth + 10);
    const y = baseline - height;
    doc.rect(x, y, barWidth, height).fill();
    doc.fillColor("black").fontSize(7).text(dateLabel(item.date), x - 4, baseline + 5, {
      width: barWidth + 8,
      align: "center",
    });
    doc.fontSize(7).text(money(item.total), x - 8, y - 12, {
      width: barWidth + 16,
      align: "center",
    });
  });
  doc.y = baseline + 30;
}

function drawTable(doc, columns, rows, widths = null) {
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidths = widths || columns.map(() => usableWidth / columns.length);
  const headerHeight = 25;
  const rowHeight = 28;

  const row = (values, header = false, index = 0) => {
    const height = header ? headerHeight : rowHeight;
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
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

  row(Object.fromEntries(columns.map((column) => [column, column.replace(/_/g, " ").toUpperCase()])), true);
  rows.forEach((item, index) => row(item, false, index));
}

export function buildDailyEmailReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Rehabilitation Center Expense - 7 Day Report");
    doc.fontSize(9).fillColor("#555").text(`Generated: ${report.generatedAt}`);
    doc.fillColor("black").moveDown();

    doc.fontSize(14).text("1. Daily expense bar chart");
    doc.moveDown(0.4);
    drawBarChart(doc, report.dailySummary);

    doc.moveDown();
    doc.fontSize(14).text("2. Daily summary");
    doc.moveDown(0.4);
    drawTable(
      doc,
      ["date", "total", "expense_count"],
      report.dailySummary.map((row) => ({
        date: dateLabel(row.date),
        total: money(row.total),
        expense_count: row.expense_count,
      })),
    );

    doc.addPage();
    doc.fontSize(14).text("3. Daily group by survivor");
    doc.moveDown(0.4);
    drawTable(
      doc,
      ["date", "survivor", "total"],
      report.survivorSummary.map((row) => ({
        date: dateLabel(row.date),
        survivor: row.survivor,
        total: money(row.total),
      })),
    );

    doc.addPage();
    doc.fontSize(14).text("4. Expense data dump - last 7 completed days");
    doc.moveDown(0.4);
    drawTable(
      doc,
      ["date", "category", "item", "survivor", "price", "comment"],
      report.dump.map((row) => ({
        date: dateLabel(row.date),
        category: row.category,
        item: row.item,
        survivor: row.survivor,
        price: money(row.price),
        comment: row.comment,
      })),
      [60, 100, 115, 100, 65, 145],
    );

    doc.end();
  });
}
