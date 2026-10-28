import PDFDocument from "pdfkit";
import { runPdfInWorker } from "./pdfWorkerPool.js";

const PIVOT_COLUMNS_PER_PAGE = 8;

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function normalizeIsoDateText(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return text.slice(0, 10);
}

function dateLabel(value) {
  const text = normalizeIsoDateText(value);
  const date = new Date(`${text}T00:00:00Z`);
  if (!text || Number.isNaN(date.getTime())) return String(value ?? "—");
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
  const left = doc.page.margins.left;
  doc.x = left;
  doc.fontSize(13).text(title, left, doc.y);
  doc.moveDown(0.35);
  if (!rows.length) {
    doc.fontSize(10).text("No summary data for this period.", left, doc.y);
    doc.moveDown();
    return;
  }

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 170;
  if (doc.y + chartHeight + 40 > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
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
  doc.x = left;
  doc.y = baseline + 30;
}

function drawPivotBarChart(doc, title, rows, groupBy) {
  const left = doc.page.margins.left;
  const groups = Array.isArray(groupBy) ? groupBy : [];
  const period = groups.find((column) => ["date", "week", "month", "year"].includes(column));
  const category = groups.includes("category") ? "category" : null;
  const survivor = groups.includes("survivor") ? "survivor" : null;
  const xColumn = period || groups.find((column) => column !== category && column !== survivor) || groups[0];
  const palette = ["#315f9f", "#d97706", "#059669", "#7c3aed", "#dc2626", "#0891b2", "#be185d", "#65a30d"];
  doc.x = left;
  doc.fontSize(13).text(title, left, doc.y);
  doc.moveDown(0.35);
  if (!rows.length) {
    doc.fontSize(10).text("No summary data for this period.", left, doc.y);
    doc.moveDown();
    return;
  }

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartHeight = 170;
  if (doc.y + chartHeight + 60 > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
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
  const max = Math.max(
    ...xItems.flatMap((xItem) =>
      category && survivor
        ? outerItems.map((outer) =>
            innerItems.reduce(
              (s, inner) => s + (values.get(`${xItem.key}\u0002${outer.key}\u0002${inner.key}`) || 0),
              0,
            ),
          )
        : outerItems.map((outer) => values.get(`${xItem.key}\u0002${outer.key}`) || 0),
    ),
    1,
  );
  const slot = usableWidth / Math.max(xItems.length, 1);
  const stackWidth = Math.max(6, Math.min(24, (slot - 10) / Math.max(outerItems.length, 1) - 2));

  xItems.forEach((xItem, xIndex) => {
    const groupWidth = outerItems.length * (stackWidth + 2) - 2;
    const groupStart = startX + xIndex * slot + Math.max((slot - groupWidth) / 2, 0);
    outerItems.forEach((outer, outerIndex) => {
      const bx = groupStart + outerIndex * (stackWidth + 2);
      let y = baseline;
      let total = 0;
      if (category && survivor) {
        innerItems.forEach((inner) => {
          const value = Number(values.get(`${xItem.key}\u0002${outer.key}\u0002${inner.key}`) || 0);
          if (!value) return;
          const height = (value / max) * (chartHeight - 40);
          y -= height;
          total += value;
          doc.save().fillColor(palette[outerIndex % palette.length]).rect(bx, y, stackWidth, height).fill().restore();
        });
      } else {
        total = Number(values.get(`${xItem.key}\u0002${outer.key}`) || 0);
        const height = (total / max) * (chartHeight - 40);
        y -= height;
        doc.save().fillColor(palette[outerIndex % palette.length]).rect(bx, y, stackWidth, height).fill().restore();
      }
      if (total) {
        doc.fontSize(5.5).fillColor("black").text(money(total), bx - 8, y - 10, {
          width: stackWidth + 16,
          align: "center",
          ellipsis: true,
        });
      }
    });
    doc.fontSize(5.8).fillColor("black").text(xItem.label, startX + xIndex * slot, baseline + 5, {
      width: Math.max(slot - 2, 12),
      align: "center",
      ellipsis: true,
    });
  });

  let legendX = startX;
  let legendY = baseline + 28;
  outerItems.forEach((item, index) => {
    const labelWidth = Math.min(115, Math.max(48, doc.widthOfString(item.label, { fontSize: 7 }) + 16));
    if (legendX + labelWidth > doc.page.width - doc.page.margins.right) {
      legendX = startX;
      legendY += 13;
    }
    if (legendY + 14 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      legendX = startX;
      legendY = doc.page.margins.top;
    }
    doc.save().fillColor(palette[index % palette.length]).rect(legendX, legendY, 8, 8).fill().restore();
    doc.fillColor("black").fontSize(7).text(item.label, legendX + 11, legendY - 1, {
      width: labelWidth - 11,
      ellipsis: true,
    });
    legendX += labelWidth;
  });
  doc.x = left;
  doc.y = legendY + 19;
}

function drawTable(doc, columns, rows, widths = null) {
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const usablePageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  const columnWidths = widths || columns.map(() => usableWidth / Math.max(columns.length, 1));

  const measureRowHeight = (values) => {
    let maxTextHeight = 0;
    columns.forEach((column, columnIndex) => {
      const width = columnWidths[columnIndex];
      const value = values[column];
      const isProof = column === "proof" && value;
      const cellText = isProof ? "Download Proof" : String(value ?? "—");
      doc.font(isProof ? "Helvetica-Bold" : "Helvetica").fontSize(6);
      const h = doc.heightOfString(cellText, { width: Math.max(width - 6, 4) });
      if (h > maxTextHeight) maxTextHeight = h;
    });
    return Math.min(usablePageHeight, Math.max(29, Math.ceil(maxTextHeight + 12)));
  };

  const drawRow = (values, header = false, index = 0) => {
    const height = header ? 25 : measureRowHeight(values);
    if (doc.y + height > doc.page.height - doc.page.margins.bottom && doc.y > doc.page.margins.top + 1) {
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
      const value = values[column];
      const isProof = !header && column === "proof" && value;
      const cellText = isProof ? "Download Proof" : String(value ?? "—");
      const textOptions = header
        ? {
            width: Math.max(width - 6, 4),
            height: height - 7,
            ellipsis: true,
          }
        : {
            width: Math.max(width - 6, 4),
            lineBreak: true,
            link: isProof ? String(value) : undefined,
            underline: Boolean(isProof),
          };
      doc
        .fillColor(header ? "#ffffff" : isProof ? "#2563eb" : "#1f2937")
        .fontSize(header ? 7 : 6)
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .text(cellText, x + 3, y + 5, textOptions);
      x += width;
    });
    doc.x = doc.page.margins.left;
    doc.y = y + height;
  };

  drawRow(
    Object.fromEntries(columns.map((column) => [column, column.replace(/_/g, " ").toUpperCase()])),
    true,
  );
  rows.forEach((row, index) => drawRow(row, false, index));
}

function drawPivotTableChunk(doc, pivot, chunkValues, includeTotal) {
  const valueColumns = chunkValues.map((_, index) => `pivot_${index}`);
  const columns = [
    ...pivot.rowColumns,
    ...valueColumns,
    ...(includeTotal ? ["total"] : []),
  ];
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rowColumnWidths = pivot.rowColumns.map((_, index) =>
    index === 0 ? Math.min(130, Math.max(80, usableWidth * 0.14)) : Math.min(110, Math.max(75, usableWidth * 0.12)),
  );
  const totalRowColumnsWidth = rowColumnWidths.reduce((sum, w) => sum + w, 0);
  const dataColumnCount = valueColumns.length + (includeTotal ? 1 : 0);
  const dataWidth = Math.max(36, (usableWidth - totalRowColumnsWidth) / Math.max(dataColumnCount, 1));
  const widths = [
    ...rowColumnWidths,
    ...Array.from({ length: dataColumnCount }, () => dataWidth),
  ];

  const tableRows = pivot.rows.map((row) => {
    const result = Object.fromEntries(
      pivot.rowColumns.map((column) => [column, prettyValue(row.values[column], column)]),
    );
    chunkValues.forEach(({ key }, index) => {
      result[`pivot_${index}`] = money(row.cells[key] || 0);
    });
    if (includeTotal) {
      result.total = money(row.total);
    }
    return result;
  });

  const headerLabels = [
    ...pivot.rowColumns.map((column) => column.replace(/_/g, " ").toUpperCase()),
    ...chunkValues.map(({ value }) => prettyValue(value, pivot.columnColumn)),
    ...(includeTotal ? ["TOTAL"] : []),
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
          width: Math.max(width - 6, 4),
          height: height - 7,
          ellipsis: true,
        });
      x += width;
    });
    doc.x = doc.page.margins.left;
    doc.y = y + height;
  };

  drawRow(null, true);
  tableRows.forEach((row, index) => drawRow(row, false, index));
}

function drawPivotTable(doc, pivot) {
  if (!pivot.columnValues.length) {
    drawPivotTableChunk(doc, pivot, [], true);
    return;
  }

  for (let start = 0; start < pivot.columnValues.length; start += PIVOT_COLUMNS_PER_PAGE) {
    const chunk = pivot.columnValues.slice(start, start + PIVOT_COLUMNS_PER_PAGE);
    const isLastChunk = start + PIVOT_COLUMNS_PER_PAGE >= pivot.columnValues.length;
    if (start > 0) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.fontSize(12).text("2. Pivot summary table (continued)", doc.page.margins.left, doc.y);
      doc.moveDown(0.4);
    }
    drawPivotTableChunk(doc, pivot, chunk, isLastChunk);
  }
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

    const left = doc.page.margins.left;
    const groupBy = summary.groupBy || [];
    doc.fontSize(20).text(`Expense Report - ${summary.title}`, left, doc.y);
    doc.fontSize(9).fillColor("#555").text(`Generated: ${generatedAt}`, left, doc.y);
    doc.fontSize(9).text(`Report range: ${summary.rangeLabel}`, left, doc.y);
    doc.fillColor("black").moveDown();

    if (groupBy.length > 1) {
      drawPivotBarChart(doc, "1. Pivot bar chart", summary.rows || [], groupBy);
      doc.moveDown(0.5);
    } else {
      drawSimpleBarChart(doc, "1. Summary bar chart", summary.rows || [], groupBy);
      doc.moveDown(0.5);
    }

    if (doc.y + 70 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    doc.x = left;
    doc.fontSize(14).text(groupBy.length > 1 ? "2. Pivot summary table" : "2. Summary table", left, doc.y);
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
    doc.x = left;
    doc.fontSize(14).text("3. Raw expense data for the report period", left, doc.y);
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        "Each expense is kept as one row. Survivor shares are combined into the Share column and proof links are clickable.",
        left,
        doc.y,
      );
    doc.fillColor("black").moveDown(0.4);
    drawTable(
      doc,
      ["date", "category", "item", "share", "total", "comment", "proof"],
      normaliseRawRows(raw),
      [62, 92, 105, 185, 65, 195, 65],
    );
    doc.end();
  });
}

export function buildScheduledReportPdf({ summary, raw, generatedAt }) {
  return runPdfInWorker("scheduled", { summary, raw, generatedAt });
}