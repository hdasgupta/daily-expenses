import PDFDocument from "pdfkit";
import { runPdfInWorker } from "./pdfWorkerPool.js";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function dateLabel(value) {
  const text = String(value ?? "").slice(0, 10);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value ?? "—");
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function prettyValue(value, column) {
  if (value == null || value === "") return "—";
  if (column === "year") return String(value);
  if (["date", "week", "month"].includes(column)) return dateLabel(value);
  return String(value);
}

function rowLabel(row, groupBy) {
  return groupBy.map((column) => prettyValue(row[column], column)).join(" · ");
}

function pivotSummary(rows, groupBy) {
  if (!Array.isArray(groupBy) || groupBy.length <= 1) return null;
  const rowColumns = groupBy.slice(0, -1);
  const columnColumn = groupBy[groupBy.length - 1];
  const columnValues = [];
  const columnKeys = new Set();
  const rowMap = new Map();

  for (const row of rows || []) {
    const columnValue = row[columnColumn];
    const columnKey = JSON.stringify(columnValue ?? null);
    if (!columnKeys.has(columnKey)) {
      columnKeys.add(columnKey);
      columnValues.push({ key: columnKey, value: columnValue });
    }
    const rowKey = rowColumns.map((column) => JSON.stringify(row[column] ?? null)).join("\u001f");
    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, {
        values: Object.fromEntries(rowColumns.map((column) => [column, row[column]])),
        cells: {},
        total: 0,
      });
    }
    const target = rowMap.get(rowKey);
    const amount = Number(row.total || 0);
    target.cells[columnKey] = Number(target.cells[columnKey] || 0) + amount;
    target.total += amount;
  }

  const compare = (a, b, column) =>
    String(a?.[column] ?? "").localeCompare(String(b?.[column] ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });

  const pivotRows = [...rowMap.values()].sort((a, b) => {
    for (const column of rowColumns) {
      const result = compare(a.values, b.values, column);
      if (result) return result;
    }
    return 0;
  });
  columnValues.sort((a, b) =>
    compare({ [columnColumn]: a.value }, { [columnColumn]: b.value }, columnColumn),
  );

  return { rowColumns, columnColumn, columnValues, rows: pivotRows };
}

function drawSimpleBarChart(doc, title, rows, groupBy) {
  doc.fontSize(13).text(title);
  doc.moveDown(0.35);
  if (!rows.length) {
    doc.fontSize(10).text("No summary data for this period.");
    doc.moveDown();
    return;
  }

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 170;
  const baseline = doc.y + chartHeight;
  const startX = doc.page.margins.left + 15;
  const max = Math.max(...rows.map((row) => Number(row.total) || 0), 1);
  const barWidth = Math.max(24, Math.min(68, (usableWidth - 30) / rows.length - 10));

  rows.forEach((row, index) => {
    const height = (Number(row.total || 0) / max) * (chartHeight - 35);
    const x = startX + index * (barWidth + 10);
    const y = baseline - height;
    doc.save();
    doc.fillColor("#315f9f");
    doc.rect(x, y, barWidth, height).fill();
    doc.restore();
    doc
      .fillColor("black")
      .fontSize(6.5)
      .text(rowLabel(row, groupBy), x - 8, baseline + 5, {
        width: barWidth + 16,
        align: "center",
      });
    doc.fontSize(7).text(money(row.total), x - 8, y - 12, {
      width: barWidth + 16,
      align: "center",
    });
  });
  doc.y = baseline + 30;
}

function drawPivotBarChart(doc, title, rows, groupBy) {
  const groups = Array.isArray(groupBy) ? groupBy : [];
  const period = groups.find((column) => ["date", "week", "month", "year"].includes(column));
  const category = groups.includes("category") ? "category" : null;
  const survivor = groups.includes("survivor") ? "survivor" : null;
  const xColumn = period || groups.find((column) => column !== category && column !== survivor) || groups[0];
  const palette = ["#315f9f", "#d97706", "#059669", "#7c3aed", "#dc2626", "#0891b2", "#be185d", "#65a30d"];
  doc.fontSize(13).text(title);
  doc.moveDown(0.35);
  if (!rows.length) { doc.fontSize(10).text("No summary data for this period."); doc.moveDown(); return; }

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 170;
  const baseline = doc.y + chartHeight;
  const startX = doc.page.margins.left + 12;
  const xMap = new Map();
  const categoryMap = new Map();
  const survivorMap = new Map();
  const seriesColumn = groups.find((column) => column !== xColumn) || groups[1];
  const values = new Map();

  rows.forEach((row) => {
    const xKey = String(row[xColumn] ?? "—");
    if (!xMap.has(xKey)) xMap.set(xKey, { key: xKey, label: prettyValue(row[xColumn], xColumn) });
    if (category && survivor) {
      const categoryKey = String(row[category] ?? "—");
      const survivorKey = String(row[survivor] ?? "—");
      if (!categoryMap.has(categoryKey)) categoryMap.set(categoryKey, { key: categoryKey, label: prettyValue(row[category], category) });
      if (!survivorMap.has(survivorKey)) survivorMap.set(survivorKey, { key: survivorKey, label: prettyValue(row[survivor], survivor) });
      const key = `${xKey}\u0002${categoryKey}\u0002${survivorKey}`;
      values.set(key, (values.get(key) || 0) + Number(row.total || 0));
    } else {
      const seriesKey = String(row[seriesColumn] ?? "—");
      if (!categoryMap.has(seriesKey)) categoryMap.set(seriesKey, { key: seriesKey, label: prettyValue(row[seriesColumn], seriesColumn) });
      const key = `${xKey}\u0002${seriesKey}`;
      values.set(key, (values.get(key) || 0) + Number(row.total || 0));
    }
  });

  const xItems = [...xMap.values()];
  const outerItems = [...categoryMap.values()];
  const innerItems = [...survivorMap.values()];
  const max = Math.max(...xItems.map((xItem) => category && survivor ? outerItems.reduce((sum, outer) => sum + innerItems.reduce((s, inner) => s + (values.get(`${xItem.key}\u0002${outer.key}\u0002${inner.key}`) || 0), 0), 0) : outerItems.reduce((sum, outer) => sum + (values.get(`${xItem.key}\u0002${outer.key}`) || 0), 0)), 1);
  const slot = usableWidth / Math.max(xItems.length, 1);
  const stackWidth = Math.max(8, Math.min(24, (slot - 12) / Math.max(outerItems.length, 1) - 3));

  xItems.forEach((xItem, xIndex) => {
    const groupWidth = outerItems.length * (stackWidth + 3) - 3;
    const groupStart = startX + xIndex * slot + Math.max((slot - groupWidth) / 2, 0);
    outerItems.forEach((outer, outerIndex) => {
      const bx = groupStart + outerIndex * (stackWidth + 3);
      let y = baseline;
      let total = 0;
      if (category && survivor) {
        innerItems.forEach((inner) => {
          const value = Number(values.get(`${xItem.key}\u0002${outer.key}\u0002${inner.key}`) || 0);
          if (!value) return;
          const height = (value / max) * (chartHeight - 40);
          y -= height; total += value;
          doc.save().fillColor(palette[outerIndex % palette.length]).rect(bx, y, stackWidth, height).fill().restore();
        });
      } else {
        total = Number(values.get(`${xItem.key}\u0002${outer.key}`) || 0);
        const height = (total / max) * (chartHeight - 40);
        y -= height;
        doc.save().fillColor(palette[outerIndex % palette.length]).rect(bx, y, stackWidth, height).fill().restore();
      }
      if (total) doc.fontSize(5.5).fillColor("black").text(money(total), bx - 8, y - 10, { width: stackWidth + 16, align: "center", ellipsis: true });
    });
    doc.fontSize(5.8).fillColor("black").text(xItem.label, startX + xIndex * slot, baseline + 5, { width: slot - 2, align: "center", ellipsis: true });
  });

  let legendX = startX;
  const legendY = baseline + 28;
  outerItems.forEach((item, index) => {
    const labelWidth = Math.min(115, Math.max(48, doc.widthOfString(item.label, { fontSize: 7 }) + 16));
    if (legendX + labelWidth > doc.page.width - doc.page.margins.right) legendX = startX;
    doc.save().fillColor(palette[index % palette.length]).rect(legendX, legendY, 8, 8).fill().restore();
    doc.fillColor("black").fontSize(7).text(item.label, legendX + 11, legendY - 1, { width: labelWidth - 11, ellipsis: true });
    legendX += labelWidth;
  });
  doc.y = legendY + 19;
}

function drawTable(doc, columns, rows, widths = null) {
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidths = widths || columns.map(() => usableWidth / Math.max(columns.length, 1));
  const drawRow = (values, header = false, index = 0) => {
    const height = header ? 25 : 29;
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
      const value = values[column];
      const isProof = !header && column === "proof" && value;
      doc
        .fillColor(header ? "#ffffff" : isProof ? "#2563eb" : "#1f2937")
        .fontSize(header ? 7 : 6)
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .text(isProof ? "Download Proof" : String(value ?? "—"), x + 3, y + 5, {
          width: width - 6,
          height: height - 7,
          ellipsis: true,
          link: isProof ? String(value) : undefined,
          underline: Boolean(isProof),
        });
      x += width;
    });
    doc.y = y + height;
  };

  drawRow(
    Object.fromEntries(columns.map((column) => [column, column.replace(/_/g, " ").toUpperCase()])),
    true,
  );
  rows.forEach((row, index) => drawRow(row, false, index));
}

function drawPivotTable(doc, pivot) {
  const valueColumns = pivot.columnValues.map((_, index) => `pivot_${index}`);
  const columns = [...pivot.rowColumns, ...valueColumns, "total"];
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const firstWidth = Math.min(150, Math.max(85, usableWidth * 0.16));
  const dataColumnCount = valueColumns.length + 1;
  const dataWidth = (usableWidth - firstWidth) / Math.max(dataColumnCount, 1);
  const widths = [
    ...pivot.rowColumns.map((_, index) => (index === 0 ? firstWidth : Math.min(100, dataWidth))),
    ...Array.from({ length: dataColumnCount }, () => dataWidth),
  ];

  const tableRows = pivot.rows.map((row) => {
    const result = Object.fromEntries(
      pivot.rowColumns.map((column) => [column, prettyValue(row.values[column], column)]),
    );
    pivot.columnValues.forEach(({ key }, index) => {
      result[`pivot_${index}`] = money(row.cells[key] || 0);
    });
    result.total = money(row.total);
    return result;
  });

  // drawTable uses the column keys as headers. Replace internal pivot keys
  // after drawing the header by using a dedicated display header row below.
  const headerLabels = [
    ...pivot.rowColumns.map((column) => column.replace(/_/g, " ").toUpperCase()),
    ...pivot.columnValues.map(({ value }) => prettyValue(value, pivot.columnColumn)),
    "TOTAL",
  ];
  const drawRow = (values, header = false, index = 0) => {
    const height = header ? 25 : 29;
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    let x = doc.page.margins.left;
    columns.forEach((column, columnIndex) => {
      const width = widths[columnIndex];
      doc.save();
      doc.fillColor(header ? "#315f9f" : index % 2 ? "#ffffff" : "#eef4fb");
      doc.rect(x, y, width, height).fill();
      doc.restore();
      doc.strokeColor("#b8c7da").rect(x, y, width, height).stroke();
      const value = header ? headerLabels[columnIndex] : values[column];
      doc
        .fillColor(header ? "#ffffff" : "#1f2937")
        .fontSize(header ? 7 : 6)
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .text(String(value ?? "—"), x + 3, y + 5, {
          width: width - 6,
          height: height - 7,
          ellipsis: true,
        });
      x += width;
    });
    doc.y = y + height;
  };

  drawRow(null, true);
  tableRows.forEach((row, index) => drawRow(row, false, index));
}

function normaliseRawRows(rows) {
  const byExpense = new Map();
  for (const row of rows || []) {
    const key = row.expense_id ?? `${row.expense_date}|${row.category}|${row.item}|${row.comment}`;
    if (!byExpense.has(key)) {
      byExpense.set(key, {
        date: dateLabel(row.expense_date),
        category: row.category || "—",
        item: row.item || "—",
        totalCost: Number(row.total_cost || 0),
        comment: row.comment || "—",
        proof: row.proof_url || null,
        shares: [],
      });
    }
    const target = byExpense.get(key);
    if (row.survivor && row.survivor !== "—") {
      target.shares.push({ name: row.survivor, amount: Number(row.share_price || 0) });
    }
    if (!target.proof && row.proof_url) target.proof = row.proof_url;
  }

  return [...byExpense.values()].map((row) => ({
    date: row.date,
    category: row.category,
    item: row.item,
    share: row.shares.length
      ? row.shares
          .map(
            (share) =>
              `${share.name}: ${money(share.amount)}${row.totalCost ? ` (${((share.amount / row.totalCost) * 100).toFixed(2)}%)` : ""}`,
          )
          .join(", ")
      : "No survivor share recorded",
    total: money(row.totalCost),
    comment: row.comment,
    proof: row.proof,
  }));
}

export function buildScheduledReportPdfInProcess({ summary, raw, generatedAt }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const groupBy = summary.groupBy || [];
    doc.fontSize(20).text(`Expense Report - ${summary.title}`);
    doc.fontSize(9).fillColor("#555").text(`Generated: ${generatedAt}`);
    doc.fontSize(9).text(`Report range: ${summary.rangeLabel}`);
    doc.fillColor("black").moveDown();

    if (groupBy.length > 1) {
      drawPivotBarChart(doc, "1. Pivot bar chart", summary.rows || [], groupBy);
      doc.moveDown(0.5);
    } else {
      drawSimpleBarChart(doc, "1. Summary bar chart", summary.rows || [], groupBy);
      doc.moveDown(0.5);
    }

    doc.fontSize(14).text(groupBy.length > 1 ? "2. Pivot summary table" : "2. Summary table");
    doc.moveDown(0.4);
    const pivot = pivotSummary(summary.rows || [], groupBy);
    if (pivot) {
      drawPivotTable(doc, pivot);
    } else {
      drawTable(
        doc,
        [...groupBy, "total"],
        (summary.rows || []).map((row) => ({
          ...Object.fromEntries(
            groupBy.map((column) => [column, prettyValue(row[column], column)]),
          ),
          total: money(row.total),
        })),
      );
    }

    doc.addPage();
    doc.fontSize(14).text("3. Raw expense data for the report period");
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        "Each expense is kept as one row. Survivor shares are combined into the Share column and proof links are clickable.",
      );
    doc.fillColor("black").moveDown(0.4);
    drawTable(
      doc,
      ["date", "category", "item", "share", "total", "comment", "proof"],
      normaliseRawRows(raw),
      [55, 80, 85, 150, 58, 95, 58],
    );
    doc.end();
  });
}

export function buildScheduledReportPdf({ summary, raw, generatedAt }) {
  return runPdfInWorker("scheduled", { summary, raw, generatedAt });
}
