import PDFDocument from "pdfkit";
import { env } from "../config/env.js";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${String(date.getDate()).padStart(2, "0")}, ${date.toLocaleString("en-IN", { month: "short" })}, ${String(date.getFullYear()).slice(-2)}`;
}

function formatCell(value, column) {
  if (value === null || value === undefined || value === "") return "—";
  if (["total", "total_cost", "report_amount", "share_price"].includes(column)) {
    return `₹${Number(value).toFixed(2)}`;
  }
  if (column === "expense_date") return formatDate(value);
  return String(value);
}

function buildUiShareRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key =
      row.expense_id ??
      `${row.expense_date}|${row.category}|${row.item}|${row.comment}|${row.proof_key}`;
    if (!map.has(key)) map.set(key, { ...row, survivorShares: [] });
    const target = map.get(key);
    if (row.survivor && row.survivor !== "—") {
      target.survivorShares.push({ name: row.survivor, amount: Number(row.share_price || 0) });
    }
    if (target.total_cost == null && row.total_cost != null)
      target.total_cost = Number(row.total_cost);
  }
  return [...map.values()].map((row) => {
    const shares = row.survivorShares;
    const total = Number(row.total_cost || shares.reduce((sum, item) => sum + item.amount, 0));
    const share = shares.length
      ? shares
          .map(
            (item) =>
              `${item.name}: ₹${item.amount.toFixed(2)}${total ? ` (${((item.amount / total) * 100).toFixed(2)}%)` : ""}`,
          )
          .join(", ")
      : "No survivor share recorded";
    const { survivorShares, survivor, ...clean } = row;
    return { ...clean, share };
  });
}

function drawCell(doc, value, column, x, y, width, height, textColor, fontSize) {
  const isProof = column === "proof_url" && value;
  const text = isProof ? "Download Proof" : formatCell(value, column);
  doc
    .fillColor(textColor)
    .fontSize(fontSize)
    .font(isProof ? "Helvetica-Bold" : "Helvetica")
    .text(text, x + 3, y + 5, {
      width: width - 6,
      height: height - 7,
      ellipsis: true,
      link: isProof ? String(value) : undefined,
      underline: Boolean(isProof),
    });
}

function ensureSpace(doc, height = 40) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function drawGroupIdentity(doc, groupBy, group) {
  ensureSpace(doc, 46);
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const lineHeight = 16;
  const height = Math.max(34, groupBy.length * lineHeight + 12);
  const y = doc.y;

  doc.save();
  doc.fillColor("#e8f1fb").roundedRect(x, y, width, height, 5).fill();
  doc.restore();
  doc.strokeColor("#b8c7da").roundedRect(x, y, width, height, 5).stroke();
  doc
    .fillColor("#315f9f")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("GROUP", x + 8, y + 5);

  groupBy.forEach((column, index) => {
    const value =
      group[column] === null || group[column] === undefined || group[column] === ""
        ? "—"
        : formatCell(group[column], column);
    doc
      .fillColor("#1f2937")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(`${column.replace(/_/g, " ")}:`, x + 58, y + 5 + index * lineHeight, { width: 90 });
    doc
      .font("Helvetica")
      .text(value, x + 145, y + 5 + index * lineHeight, { width: width - 153, ellipsis: true });
  });
  doc.y = y + height + 6;
}

function drawTable(doc, columns, rows, widths = null, options = {}) {
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidths = widths || columns.map(() => usableWidth / Math.max(columns.length, 1));
  const headerHeight = 25;
  const rowHeight = options.rowHeight || 28;

  const row = (values, header = false, index = 0) => {
    const height = header ? headerHeight : rowHeight;
    ensureSpace(doc, height);
    const y = doc.y;
    let x = doc.page.margins.left;
    columns.forEach((column, columnIndex) => {
      const width = columnWidths[columnIndex];
      doc.save();
      doc.fillColor(header ? "#315f9f" : index % 2 ? "#ffffff" : "#eef4fb");
      doc.rect(x, y, width, height).fill();
      doc.restore();
      doc.strokeColor("#b8c7da").rect(x, y, width, height).stroke();
      if (header) {
        doc
          .fillColor("#ffffff")
          .fontSize(7)
          .font("Helvetica-Bold")
          .text(column.replace(/_/g, " ").toUpperCase(), x + 3, y + 5, {
            width: width - 6,
            height: height - 7,
            ellipsis: true,
          });
      } else {
        drawCell(doc, values[column], column, x, y, width, height, "#1f2937", 6);
      }
      x += width;
    });
    doc.y = y + height;
  };

  row(
    Object.fromEntries(columns.map((column) => [column, column.replace(/_/g, " ").toUpperCase()])),
    true,
  );
  rows.forEach((item, index) => row(item, false, index));
}

function groupRows(rows, groupBy) {
  const groups = new Map();
  for (const row of rows) {
    const key = groupBy.map((column) => String(row[column] ?? "—")).join("\u0001");
    if (!groups.has(key))
      groups.set(key, {
        values: Object.fromEntries(groupBy.map((column) => [column, row[column]])),
        rows: [],
      });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}

function drawGroupedRaw(doc, report) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [];
  const hasShareData = (report.columns || []).includes("share_price");
  const sourceRows =
    hasShareData && !groupBy.includes("survivor")
      ? buildUiShareRows(report.rows || [])
      : report.rows || [];
  const columns = hasShareData
    ? [
        ...new Set(
          (report.columns || [])
            .filter((column) => column !== "survivor")
            .map((column) => (column === "share_price" ? "share" : column)),
        ),
      ]
    : [...new Set(report.columns || [])];
  const groups = groupRows(sourceRows, groupBy);
  const dataColumns = columns.filter((column) => !groupBy.includes(column));

  doc.fontSize(13).font("Helvetica-Bold").fillColor("#000000").text("Grouped data");
  doc.moveDown(0.5);
  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) doc.moveDown(0.8);
    drawGroupIdentity(doc, groupBy, group.values);
    drawTable(doc, dataColumns, group.rows);
  });
  if (!groups.length) doc.fontSize(10).text("No records match the selected filters.");
}

function drawBarChart(doc, chartData) {
  const data = (chartData || []).filter((item) => Number.isFinite(Number(item.value))).slice(0, 20);
  if (!data.length) return;
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const height = 175;
  ensureSpace(doc, height + 20);
  const y = doc.y;
  doc.fontSize(13).font("Helvetica-Bold").fillColor("#000000").text("Summary chart", x, y);
  const chartY = y + 22;
  const chartH = height - 38;
  const max = Math.max(...data.map((item) => Number(item.value)), 1);
  const barW = Math.max(8, Math.min(34, (width - 30) / data.length - 8));

  doc
    .strokeColor("#b8c7da")
    .moveTo(x, chartY + chartH)
    .lineTo(x + width, chartY + chartH)
    .stroke();
  data.forEach((item, index) => {
    const value = Number(item.value);
    const barH = (value / max) * (chartH - 25);
    const bx = x + 12 + index * ((width - 24) / data.length);
    const by = chartY + chartH - barH;
    doc.save();
    doc.fillColor("#315f9f").rect(bx, by, barW, barH).fill();
    doc.restore();
    doc
      .fillColor("#1f2937")
      .fontSize(6)
      .font("Helvetica-Bold")
      .text(money(value), bx - 5, by - 10, { width: barW + 10, align: "center", ellipsis: true });
    const label = String(item.label || "").replace(/\s+/g, " ");
    doc
      .font("Helvetica")
      .fontSize(5.5)
      .text(label, bx - 12, chartY + chartH + 4, {
        width: barW + 24,
        height: 22,
        align: "center",
        ellipsis: true,
      });
  });
  doc.y = chartY + height;
}

function drawPivotSummary(doc, report) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [];
  const rows = report.rows || [];
  if (!rows.length) {
    doc.fontSize(10).text("No records match the selected filters.");
    return;
  }
  if (groupBy.length <= 1) {
    const columns = [...groupBy, "total"];
    drawTable(doc, columns, rows, null, { rowHeight: 30 });
    return;
  }

  const rowGroups = groupBy.slice(0, -1);
  const pivotColumn = groupBy[groupBy.length - 1];
  const pivotValues = [...new Set(rows.map((row) => String(row[pivotColumn] ?? "—")))];
  const byKey = new Map(
    rows.map((row) => [
      rowGroups.map((column) => String(row[column] ?? "—")).join("\u0001") +
        "\u0002" +
        String(row[pivotColumn] ?? "—"),
      row,
    ]),
  );
  const rowKeys = [
    ...new Set(
      rows.map((row) => rowGroups.map((column) => String(row[column] ?? "—")).join("\u0001")),
    ),
  ];
  const cols = [...rowGroups, ...pivotValues, "total"];
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const groupWidth = (usableWidth * 0.42) / Math.max(rowGroups.length, 1);
  const valueWidth = (usableWidth * 0.58) / (pivotValues.length + 1);
  const widths = rowGroups
    .map(() => groupWidth)
    .concat(
      pivotValues.map(() => valueWidth),
      valueWidth,
    );

  ensureSpace(doc, 45);
  const x0 = doc.page.margins.left;
  const headerY = doc.y;
  let x = x0;
  const headerH = 30;
  cols.forEach((column, i) => {
    const w = widths[i];
    doc.save();
    doc.fillColor("#315f9f").rect(x, headerY, w, headerH).fill();
    doc.restore();
    doc.strokeColor("#b8c7da").rect(x, headerY, w, headerH).stroke();
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .text(String(column).replace(/_/g, " ").toUpperCase(), x + 3, headerY + 8, {
        width: w - 6,
        height: headerH - 10,
        align: "center",
        ellipsis: true,
      });
    x += w;
  });
  doc.y = headerY + headerH;

  // Merged group cells: a repeated row-group value is drawn once over its full span.
  for (let r = 0; r < rowKeys.length; r += 1) {
    const key = rowKeys[r];
    const parts = key.split("\u0001");
    let span = 1;
    while (
      r + span < rowKeys.length &&
      rowKeys[r + span].split("\u0001").slice(0, rowGroups.length).join("\u0001") ===
        parts.slice(0, rowGroups.length).join("\u0001")
    )
      span += 1;
    const h = 28 * span;
    ensureSpace(doc, h);
    const y = doc.y;
    let xx = x0;
    rowGroups.forEach((column, i) => {
      const w = widths[i];
      const val = parts[i] ?? "—";
      let start = r;
      let count = 1;
      while (start + count < r + span && rowKeys[start + count].split("\u0001")[i] === val)
        count += 1;
      const cellH = 28 * count;
      const cellY = y + 28 * (start - r);
      doc.save();
      doc.fillColor("#eef4fb").rect(xx, cellY, w, cellH).fill();
      doc.restore();
      doc.strokeColor("#b8c7da").rect(xx, cellY, w, cellH).stroke();
      doc
        .fillColor("#1f2937")
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(formatCell(val, column), xx + 3, cellY + cellH / 2 - 4, {
          width: w - 6,
          height: 12,
          ellipsis: true,
        });
      xx += w;
    });
    const rowGroupRows = rowKeys.slice(r, r + span);
    rowGroupRows.forEach((rowKey, localIndex) => {
      const yy = y + localIndex * 28;
      pivotValues.forEach((pivot, pIndex) => {
        const w = widths[rowGroups.length + pIndex];
        const row = byKey.get(rowKey + "\u0002" + pivot);
        doc.save();
        doc
          .fillColor(localIndex % 2 ? "#ffffff" : "#f8fbff")
          .rect(xx, yy, w, 28)
          .fill();
        doc.restore();
        doc.strokeColor("#b8c7da").rect(xx, yy, w, 28).stroke();
        doc
          .fillColor("#1f2937")
          .font("Helvetica")
          .fontSize(6.5)
          .text(row ? money(row.total) : "—", xx + 3, yy + 8, {
            width: w - 6,
            align: "right",
            ellipsis: true,
          });
        xx += w;
      });
      const total = rowGroupRows.reduce(
        (sum, rowKey) =>
          sum +
          pivotValues.reduce(
            (s, pivot) => s + Number(byKey.get(rowKey + "\u0002" + pivot)?.total || 0),
            0,
          ),
        0,
      );
      const tw = widths[widths.length - 1];
      doc.save();
      doc.fillColor("#f5f8fc").rect(xx, yy, tw, 28).fill();
      doc.restore();
      doc.strokeColor("#b8c7da").rect(xx, yy, tw, 28).stroke();
      doc
        .fillColor("#1f2937")
        .font("Helvetica-Bold")
        .fontSize(6.5)
        .text(money(total), xx + 3, yy + 8, { width: tw - 6, align: "right" });
      xx = x0 + rowGroups.reduce((s, _, i) => s + widths[i], 0);
    });
    doc.y = y + h;
    r += span - 1;
  }
}

function drawRawDump(doc, rows) {
  doc.addPage();
  doc.fontSize(14).font("Helvetica-Bold").fillColor("#000000").text("Raw dump");
  doc.moveDown(0.5);
  const sourceRows = rows || [];
  if (!sourceRows.length) {
    doc.fontSize(10).text("No records match the selected filters.");
    return;
  }

  // The report query is survivor-share based, but the raw dump must represent
  // the original expense as one row. Recombine all survivor shares here.
  const unsplitRows = sourceRows.some((row) =>
    Object.prototype.hasOwnProperty.call(row, "share_price"),
  )
    ? buildUiShareRows(sourceRows)
    : sourceRows;
  const preferred = [
    "expense_date",
    "category",
    "item",
    "share",
    "total_cost",
    "comment",
    "proof_url",
  ];
  const columns = preferred.filter((column) =>
    Object.prototype.hasOwnProperty.call(unsplitRows[0], column),
  );
  const extras = Object.keys(unsplitRows[0]).filter(
    (column) =>
      !columns.includes(column) &&
      !["survivor", "survivorShares", "proof_key", "report_amount", "id", "expense_id"].includes(
        column,
      ),
  );
  drawTable(doc, [...columns, ...extras], unsplitRows);
}

export function buildReportPdf(report, config = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .fontSize(15)
      .font("Helvetica-Bold")
      .fillColor("#1f2937")
      .text(env.organizationName || "West Bengal Forum for Mental Health", { align: "center" });
    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .fillColor("#000000")
      .text("Rehabilitation Center Expense Report", { align: "center" });
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        `Generated: ${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" }).format(new Date())}`,
      );
    doc.fillColor("black").moveDown();

    const groupBy = Array.isArray(config.groupBy) ? config.groupBy : [];
    const sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [];
    if (groupBy.length) doc.fontSize(9).text(`Group by: ${groupBy.join(", ")}`);
    if (sortColumns.length)
      doc
        .fontSize(9)
        .text(`Sort: ${sortColumns.map((item) => `${item.column} ${item.direction}`).join(", ")}`);
    doc.fontSize(11).text(`Mode: ${report.mode}`);
    doc.moveDown(0.7);

    const isSummary = report.mode === "summary";
    if (isSummary) {
      drawBarChart(doc, report.chartData);
      doc.moveDown(0.5);
      if (groupBy.length) drawPivotSummary(doc, report);
      else drawTable(doc, ["total"], report.rows || []);
    } else if (report.mode === "grouped-raw") {
      drawGroupedRaw(doc, report);
    } else {
      const pdfColumns = [...new Set(report.columns || [])];
      drawTable(doc, pdfColumns, report.rows || []);
    }

    if (report.mode !== "grouped-raw" && report.mode !== "summary") {
      doc.moveDown();
      doc.fontSize(11).text(`Total: ₹${Number(report.total || 0).toFixed(2)}`);
    }

    // Raw dump is intentionally omitted only for a pure filter/sort raw report.
    if (report.includeRawDump) drawRawDump(doc, report.rawRows || report.rows || []);
    doc.end();
  });
}
