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

function drawSurvivorBarChart(doc, rows, periodKey, survivors, labelFormatter) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 175;
  const startX = doc.page.margins.left + 20;
  const baseline = doc.y + chartHeight;
  const totals = rows.map((row) => survivors.reduce((sum, survivor) => sum + Number(row[survivor] || 0), 0));
  const max = Math.max(...totals, 1);
  const groupWidth = Math.max(35, (width - 20) / Math.max(rows.length, 1) - 12);
  const barWidth = Math.max(12, Math.min(52, groupWidth));
  const palette = ["#315f9f", "#4f81bd", "#70ad47", "#ed7d31", "#a5a5a5", "#8064a2", "#ffc000", "#5b9bd5"];

  if (!rows.length || !survivors.length) {
    doc.fontSize(10).text("No survivor data for this period.").moveDown();
    return;
  }

  rows.forEach((row, index) => {
    const x = startX + index * (barWidth + 18);
    let y = baseline;
    for (let survivorIndex = 0; survivorIndex < survivors.length; survivorIndex += 1) {
      const value = Number(row[survivors[survivorIndex]] || 0);
      const height = (value / max) * (chartHeight - 45);
      if (height > 0) {
        y -= height;
        doc.save();
        doc.fillColor(palette[survivorIndex % palette.length]);
        doc.rect(x, y, barWidth, height).fill();
        doc.restore();
      }
    }
    doc.fillColor("black").fontSize(7).text(labelFormatter(row[periodKey]), x - 10, baseline + 5, {
      width: barWidth + 20,
      align: "center",
    });
  });

  const legendY = baseline + 28;
  let legendX = startX;
  survivors.forEach((survivor, index) => {
    const labelWidth = Math.min(110, Math.max(45, doc.widthOfString(survivor, { fontSize: 7 }) + 16));
    if (legendX + labelWidth > doc.page.width - doc.page.margins.right) legendX = startX;
    doc.save();
    doc.fillColor(palette[index % palette.length]).rect(legendX, legendY, 8, 8).fill();
    doc.restore();
    doc.fillColor("black").fontSize(7).text(survivor, legendX + 11, legendY - 1, { width: labelWidth - 11 });
    legendX += labelWidth;
  });
  doc.y = legendY + 20;
}

function drawPivotTable(doc, periodHeader, rows, survivors) {
  const columns = [periodHeader, ...survivors];
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const firstWidth = 100;
  const survivorWidth = (usableWidth - firstWidth) / Math.max(survivors.length, 1);
  const widths = [firstWidth, ...survivors.map(() => survivorWidth)];
  drawTable(doc, columns, rows.map((row) => {
    const result = { [periodHeader]: row[periodHeader] };
    survivors.forEach((survivor) => { result[survivor] = money(row[survivor]); });
    return result;
  }), widths);
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
    const weeklyPivot = pivotSurvivorRows(
      report.survivorSummary.map((row) => ({ ...row, period: row.weekStart })),
      "period",
      report.weeklySummary.map((row) => row.weekStart),
    );
    const weeklyLabels = new Map(report.survivorSummary.map((row) => [row.weekStart, weekLabel(row.weekStart, row.weekEnd)]));
    drawSurvivorBarChart(doc, weeklyPivot.rows, "period", weeklyPivot.survivors, (value) => weeklyLabels.get(value) || value);
    doc.moveDown(0.6);
    drawPivotTable(
      doc,
      "week",
      weeklyPivot.rows.map((row) => ({ ...row, week: weeklyLabels.get(row.period) || row.period })),
      weeklyPivot.survivors,
    );

    doc.addPage();
    doc.fontSize(14).text("4. Expense data dump - last 4 completed weeks");
    doc.moveDown(0.4);
    drawTable(doc, ["date", "category", "item", "share", "comment", "proof"], uiShareDumpRows(report.dump).map((row) => ({
      date: dateLabel(row.date),
      category: row.category,
      item: row.item,
      share: row.share,
      comment: row.comment,
      proof: row.proofUrl,
    })), [55, 90, 100, 125, 75, 55]);

    doc.end();
  });
}
