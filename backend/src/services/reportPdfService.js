import PDFDocument from "pdfkit";
import { env } from "../config/env.js";

function money(value) { return `₹${Number(value || 0).toFixed(2)}`; }
function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${String(date.getDate()).padStart(2, "0")}, ${date.toLocaleString("en-IN", { month: "short" })}, ${String(date.getFullYear()).slice(-2)}`;
}
function formatCell(value, column) {
  if (value === null || value === undefined || value === "") return "—";
  if (["total", "total_cost", "report_amount", "share_price"].includes(column)) return money(value);
  if (column === "expense_date") return formatDate(value);
  return String(value);
}
function buildUiShareRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = row.expense_id ?? `${row.expense_date}|${row.category}|${row.item}|${row.comment}|${row.proof_key}`;
    if (!map.has(key)) map.set(key, { ...row, survivorShares: [] });
    const target = map.get(key);
    if (row.survivor && row.survivor !== "—") target.survivorShares.push({ name: row.survivor, amount: Number(row.share_price || 0) });
    if (target.total_cost == null && row.total_cost != null) target.total_cost = Number(row.total_cost);
  }
  return [...map.values()].map((row) => {
    const shares = row.survivorShares;
    const total = Number(row.total_cost || shares.reduce((sum, item) => sum + item.amount, 0));
    const share = shares.length ? shares.map((item) => {
      const percentage = total ? ` (${((item.amount / total) * 100).toFixed(2)}%)` : "";
      return `${item.name}: ${money(item.amount)}${percentage}`;
    }).join(", ") : "No survivor share recorded";
    const { survivorShares, survivor, ...clean } = row;
    return { ...clean, share };
  });
}
function drawCell(doc, value, column, x, y, width, height, textColor, fontSize) {
  const isProof = column === "proof_url" && value;
  const text = isProof ? "Open proof" : formatCell(value, column);
  doc.fillColor(textColor).fontSize(fontSize).font(isProof ? "Helvetica-Bold" : "Helvetica").text(text, x + 3, y + 5, { width: width - 6, height: height - 7, ellipsis: true, link: isProof ? String(value) : undefined, underline: Boolean(isProof) });
}
function ensureSpace(doc, height = 40) { if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage(); }
function drawSectionTitle(doc, title, subtitle = "") {
  ensureSpace(doc, subtitle ? 48 : 30);
  doc.fontSize(13).font("Helvetica-Bold").fillColor("#000000").text(title);
  if (subtitle) { doc.moveDown(0.15); doc.fontSize(8).font("Helvetica").fillColor("#555555").text(subtitle); }
  doc.moveDown(0.45);
}
function drawGroupIdentity(doc, groupBy, group) {
  ensureSpace(doc, 46);
  const x = doc.page.margins.left, width = doc.page.width - doc.page.margins.left - doc.page.margins.right, lineHeight = 16;
  const height = Math.max(34, groupBy.length * lineHeight + 12), y = doc.y;
  doc.save(); doc.fillColor("#e8f1fb").roundedRect(x, y, width, height, 5).fill(); doc.restore();
  doc.strokeColor("#b8c7da").roundedRect(x, y, width, height, 5).stroke();
  doc.fillColor("#315f9f").font("Helvetica-Bold").fontSize(8).text("GROUP", x + 8, y + 5);
  groupBy.forEach((column, index) => {
    const value = group[column] === null || group[column] === undefined || group[column] === "" ? "—" : formatCell(group[column], column);
    doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(8).text(`${column.replace(/_/g, " ")}:`, x + 58, y + 5 + index * lineHeight, { width: 90 });
    doc.font("Helvetica").text(value, x + 145, y + 5 + index * lineHeight, { width: width - 153, ellipsis: true });
  });
  doc.y = y + height + 6;
}
function drawTable(doc, columns, rows, widths = null, options = {}) {
  if (!columns.length) return;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidths = widths || columns.map(() => usableWidth / columns.length);
  const headerHeight = options.headerHeight || 25, rowHeight = options.rowHeight || 28;
  const drawRow = (values, header = false, index = 0) => {
    const height = header ? headerHeight : rowHeight; ensureSpace(doc, height); const y = doc.y; let x = doc.page.margins.left;
    columns.forEach((column, columnIndex) => {
      const width = columnWidths[columnIndex];
      doc.save(); doc.fillColor(header ? "#315f9f" : index % 2 ? "#ffffff" : "#eef4fb").rect(x, y, width, height).fill(); doc.restore();
      doc.strokeColor("#b8c7da").rect(x, y, width, height).stroke();
      if (header) doc.fillColor("#ffffff").fontSize(7).font("Helvetica-Bold").text(column.replace(/_/g, " ").toUpperCase(), x + 3, y + 5, { width: width - 6, height: height - 7, ellipsis: true });
      else drawCell(doc, values[column], column, x, y, width, height, "#1f2937", 6);
      x += width;
    });
    doc.y = y + height;
  };
  drawRow(Object.fromEntries(columns.map((column) => [column, column.replace(/_/g, " ").toUpperCase()])), true);
  rows.forEach((item, index) => drawRow(item, false, index));
}
function groupRows(rows, groupBy) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = groupBy.map((column) => String(row[column] ?? "—")).join("\u0001");
    if (!groups.has(key)) groups.set(key, { values: Object.fromEntries(groupBy.map((column) => [column, row[column]])), rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}
function valueForSort(row, column) {
  if (column === "date") return row.expense_date || "";
  if (column === "price") return Number(row.total_cost ?? row.report_amount ?? row.share_price ?? 0);
  return String(row[column] ?? "").toLowerCase();
}
function sortRows(rows, config = {}) {
  const sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [], groupBy = Array.isArray(config.groupBy) ? config.groupBy : [];
  const active = [...sortColumns, ...groupBy.filter((column) => !sortColumns.some((sort) => sort.column === column)).map((column) => ({ column, direction: "asc" }))];
  if (!active.length) return [...rows];
  return [...rows].sort((a, b) => {
    for (const sort of active) {
      const left = valueForSort(a, sort.column), right = valueForSort(b, sort.column), direction = sort.direction === "desc" ? -1 : 1;
      if (left < right) return -1 * direction; if (left > right) return 1 * direction;
    }
    return 0;
  });
}
function drawGroupedRaw(doc, rows, groupBy, config) {
  const sourceRows = sortRows(rows, config), shareRows = buildUiShareRows(sourceRows), groups = groupRows(shareRows, groupBy);
  drawSectionTitle(doc, "Group-by detail tables", "Each table corresponds directly to a group represented in the summary table above.");
  const preferred = ["expense_date", "category", "item", "share", "total_cost", "comment", "proof_url"];
  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) doc.moveDown(0.8); drawGroupIdentity(doc, groupBy, group.values);
    const first = group.rows[0] || {}, columns = preferred.filter((column) => Object.prototype.hasOwnProperty.call(first, column));
    const extras = Object.keys(first).filter((column) => !columns.includes(column) && !["survivor", "survivorShares", "proof_key", "report_amount", "id", "expense_id"].includes(column));
    drawTable(doc, [...columns, ...extras], group.rows);
  });
  if (!groups.length) doc.fontSize(10).font("Helvetica").text("No records match the selected filters.");
}
function drawGroupedBarChart(doc, report) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [], rows = report.rows || [];
  if (!rows.length) return;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right, x = doc.page.margins.left, chartHeight = 210, chartTop = doc.y + 22, chartHeightInner = chartHeight - 62, max = Math.max(...rows.map((row) => Number(row.total || 0)), 1);
  ensureSpace(doc, chartHeight + 30); doc.fontSize(13).font("Helvetica-Bold").fillColor("#000000").text("Pivot grouped bar chart");
  if (groupBy.length <= 1) {
    const data = rows.slice(0, 24), slot = usableWidth / Math.max(data.length, 1), barWidth = Math.max(8, Math.min(28, slot * 0.62));
    doc.strokeColor("#9aa8b8").moveTo(x, chartTop + chartHeightInner).lineTo(x + usableWidth, chartTop + chartHeightInner).stroke();
    data.forEach((row, index) => {
      const value = Number(row.total || 0), barHeight = (value / max) * (chartHeightInner - 20), bx = x + index * slot + (slot - barWidth) / 2, by = chartTop + chartHeightInner - barHeight;
      doc.save(); doc.fillColor("#315f9f").rect(bx, by, barWidth, barHeight).fill(); doc.restore();
      doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(5.5).text(money(value), bx - 8, by - 10, { width: barWidth + 16, align: "center", ellipsis: true });
      doc.font("Helvetica").fontSize(5.5).text(String(row[groupBy[0]] ?? row.label ?? "Total"), bx - 14, chartTop + chartHeightInner + 4, { width: barWidth + 28, height: 25, align: "center", ellipsis: true });
    }); doc.y = chartTop + chartHeight; return;
  }
  const rowGroups = groupBy.slice(0, -1), pivotColumn = groupBy[groupBy.length - 1], pivotValues = [...new Set(rows.map((row) => String(row[pivotColumn] ?? "—")))].slice(0, 10), groupKeys = [...new Set(rows.map((row) => rowGroups.map((column) => String(row[column] ?? "—")).join("\u0001")))].slice(0, 16);
  const byKey = new Map(rows.map((row) => [rowGroups.map((column) => String(row[column] ?? "—")).join("\u0001") + "\u0002" + String(row[pivotColumn] ?? "—"), row]));
  const slot = usableWidth / Math.max(groupKeys.length, 1), barGap = 2, seriesWidth = Math.max(5, Math.min(18, (slot - 8) / Math.max(pivotValues.length, 1))), palette = ["#315f9f", "#d97706", "#059669", "#7c3aed", "#dc2626", "#0891b2", "#be185d", "#65a30d", "#475569", "#92400e"];
  doc.strokeColor("#9aa8b8").moveTo(x, chartTop + chartHeightInner).lineTo(x + usableWidth, chartTop + chartHeightInner).stroke();
  groupKeys.forEach((groupKey, groupIndex) => {
    pivotValues.forEach((pivot, pivotIndex) => {
      const row = byKey.get(groupKey + "\u0002" + pivot), value = Number(row?.total || 0), barHeight = (value / max) * (chartHeightInner - 24), bx = x + groupIndex * slot + 4 + pivotIndex * (seriesWidth + barGap), by = chartTop + chartHeightInner - barHeight;
      doc.save(); doc.fillColor(palette[pivotIndex % palette.length]).rect(bx, by, seriesWidth, barHeight).fill(); doc.restore();
      if (barHeight > 18) doc.fillColor("#1f2937").font("Helvetica").fontSize(4.5).text(money(value), bx - 5, by - 8, { width: seriesWidth + 10, align: "center", ellipsis: true });
    });
    doc.fillColor("#1f2937").font("Helvetica").fontSize(5).text(groupKey.replace(/\u0001/g, " • "), x + groupIndex * slot, chartTop + chartHeightInner + 4, { width: slot - 2, height: 28, align: "center", ellipsis: true });
  });
  const legendY = chartTop + chartHeightInner + 34;
  pivotValues.forEach((pivot, index) => { const lx = x + index * Math.min(115, usableWidth / Math.max(pivotValues.length, 1)); doc.save(); doc.fillColor(palette[index % palette.length]).rect(lx, legendY, 8, 8).fill(); doc.restore(); doc.fillColor("#1f2937").font("Helvetica").fontSize(5.5).text(pivot, lx + 11, legendY - 1, { width: 100, ellipsis: true }); });
  doc.y = legendY + 14;
}

function pivotValueKey(values) { return values.map((value) => String(value ?? "—")).join("\u0001"); }
function displayPivotValue(value) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function getPivotDimensions(rows, groupBy) {
  if (groupBy.length <= 1) return { rowGroups: [...groupBy], columnGroups: [] };
  if (groupBy.length === 2) return { rowGroups: [groupBy[0]], columnGroups: [groupBy[1]] };
  if (groupBy.length === 3) return { rowGroups: [groupBy[0]], columnGroups: [groupBy[1], groupBy[2]] };
  const scored = groupBy.map((column, index) => ({ column, index, cardinality: new Set(rows.map((row) => String(row[column] ?? "—"))).size }));
  const rowCount = Math.floor(groupBy.length / 2);
  const rowSet = new Set(scored.slice().sort((a, b) => b.cardinality - a.cardinality || a.index - b.index).slice(0, rowCount).map((item) => item.column));
  return { rowGroups: groupBy.filter((column) => rowSet.has(column)), columnGroups: groupBy.filter((column) => !rowSet.has(column)) };
}
function drawMergedPivotHeader(doc, x, y, width, height, value, level = 0) {
  doc.save(); doc.fillColor(level % 2 ? "#406fae" : "#315f9f").rect(x, y, width, height).fill(); doc.restore();
  doc.strokeColor("#b8c7da").rect(x, y, width, height).stroke();
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(6.2).text(displayPivotValue(value), x + 3, y + height / 2 - 4, { width: width - 6, height: 12, align: "center", ellipsis: true });
}
function drawPivotSummary(doc, report) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [], rows = report.rows || [];
  if (!rows.length) { doc.fontSize(10).text("No records match the selected filters."); return; }
  const dimensions = getPivotDimensions(rows, groupBy), rowGroups = dimensions.rowGroups, columnGroups = dimensions.columnGroups;
  if (!columnGroups.length) {
    drawSectionTitle(doc, "Pivot grouped summary table", `Group by column: ${rowGroups[0] || "expense"}. Each row is one ${rowGroups[0] || "expense"} group.`);
    const grouped = groupRows(rows, rowGroups).map((group) => ({ group_value: group.values[rowGroups[0]], total: group.rows.reduce((sum, row) => sum + Number(row.total || 0), 0) }));
    drawTable(doc, ["group_value", "total"], grouped, [usableWidthFor(doc) * 0.72, usableWidthFor(doc) * 0.28], { rowHeight: 30 });
    return;
  }
  drawSectionTitle(doc, "Pivot grouped summary table", `ROW GROUPS: ${rowGroups.join(" • ")}    |    COLUMN GROUPS: ${columnGroups.join(" • ")}    |    GROUP TOTAL`);
  const rowMap = new Map();
  const columnMap = new Map();
  for (const row of rows) {
    const rk = pivotValueKey(rowGroups.map((column) => row[column])), ck = pivotValueKey(columnGroups.map((column) => row[column]));
    if (!rowMap.has(rk)) rowMap.set(rk, rowGroups.map((column) => row[column]));
    if (!columnMap.has(ck)) columnMap.set(ck, columnGroups.map((column) => row[column]));
  }
  const rowKeys = [...rowMap.keys()], columnKeys = [...columnMap.keys()];
  const totals = new Map(), grandByRow = new Map();
  for (const row of rows) {
    const rk = pivotValueKey(rowGroups.map((column) => row[column])), ck = pivotValueKey(columnGroups.map((column) => row[column])), value = Number(row.total || 0);
    totals.set(`${rk}\u0002${ck}`, (totals.get(`${rk}\u0002${ck}`) || 0) + value); grandByRow.set(rk, (grandByRow.get(rk) || 0) + value);
  }
  const usableWidth = usableWidthFor(doc), rowWidth = Math.min(180, usableWidth * 0.30), totalWidth = Math.min(85, usableWidth * 0.12), columnArea = usableWidth - rowWidth - totalWidth, colWidth = columnArea / Math.max(columnKeys.length, 1), headerHeight = 24, headerLevels = columnGroups.length;
  ensureSpace(doc, 55 + headerLevels * headerHeight);
  const x0 = doc.page.margins.left, headerY = doc.y;
  let x = x0;
  rowGroups.forEach((column) => { const w = rowWidth / rowGroups.length; drawMergedPivotHeader(doc, x, headerY, w, headerLevels * headerHeight, column.replace(/_/g, " ").toUpperCase(), 0); x += w; });
  const columnStartX = x;
  for (let level = 0; level < columnGroups.length; level += 1) {
    const labels = columnKeys.map((key) => columnMap.get(key)[level]);
    let i = 0;
    while (i < labels.length) {
      let j = i + 1;
      while (j < labels.length && displayPivotValue(labels[j]) === displayPivotValue(labels[i])) j += 1;
      drawMergedPivotHeader(doc, columnStartX + i * colWidth, headerY + level * headerHeight, (j - i) * colWidth, headerHeight, labels[i], level);
      i = j;
    }
  }
  drawMergedPivotHeader(doc, x0 + rowWidth + columnArea, headerY, totalWidth, headerLevels * headerHeight, "GROUP TOTAL", 0);
  doc.y = headerY + headerLevels * headerHeight;
  for (const rowKey of rowKeys) {
    ensureSpace(doc, 30); const y = doc.y, values = rowMap.get(rowKey); let xx = x0;
    rowGroups.forEach((column, index) => { const w = rowWidth / rowGroups.length; doc.save(); doc.fillColor("#eef4fb").rect(xx, y, w, 30).fill(); doc.restore(); doc.strokeColor("#b8c7da").rect(xx, y, w, 30).stroke(); doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(6.5).text(formatCell(values[index], column), xx + 3, y + 9, { width: w - 6, align: "center", ellipsis: true }); xx += w; });
    for (const columnKey of columnKeys) { const value = totals.get(`${rowKey}\u0002${columnKey}`) || 0; doc.save(); doc.fillColor("#f8fbff").rect(xx, y, colWidth, 30).fill(); doc.restore(); doc.strokeColor("#b8c7da").rect(xx, y, colWidth, 30).stroke(); doc.fillColor("#1f2937").font("Helvetica").fontSize(6.2).text(value ? money(value) : "—", xx + 3, y + 9, { width: colWidth - 6, align: "right", ellipsis: true }); xx += colWidth; }
    doc.save(); doc.fillColor("#f5f8fc").rect(xx, y, totalWidth, 30).fill(); doc.restore(); doc.strokeColor("#b8c7da").rect(xx, y, totalWidth, 30).stroke(); doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(6.2).text(money(grandByRow.get(rowKey) || 0), xx + 3, y + 9, { width: totalWidth - 6, align: "right" }); doc.y = y + 30;
  }
  const splitText = `Intelligent layout: ${rowGroups.join(" • ")} kept row-wise; ${columnGroups.join(" • ")} shown column-wise. For 4+ fields, higher-cardinality dimensions are kept row-wise to control table width.`;
  doc.moveDown(0.35); doc.font("Helvetica").fontSize(6.5).fillColor("#555555").text(splitText);
}
function usableWidthFor(doc) { return doc.page.width - doc.page.margins.left - doc.page.margins.right; }
function drawRawDump(doc, rows, config) {
  doc.addPage();
  drawSectionTitle(doc, "Raw dump — filtered expense data", "This section contains the underlying filtered expense records. The Share column lists each survivor share as amount and percentage of the expense total. Proof links are clickable where a proof file exists.");
  const sourceRows = sortRows(rows || [], config);
  if (!sourceRows.length) { doc.fontSize(10).font("Helvetica").text("No records match the selected filters."); return; }
  const unsplitRows = sourceRows.some((row) => Object.prototype.hasOwnProperty.call(row, "share_price")) ? buildUiShareRows(sourceRows) : sourceRows;
  const preferred = ["expense_date", "category", "item", "share", "total_cost", "comment", "proof_url"], first = unsplitRows[0];
  const columns = preferred.filter((column) => Object.prototype.hasOwnProperty.call(first, column));
  const extras = Object.keys(first).filter((column) => !columns.includes(column) && !["survivor", "survivorShares", "proof_key", "report_amount", "id", "expense_id"].includes(column));
  drawTable(doc, [...columns, ...extras], unsplitRows, null, { rowHeight: 30 });
}
function drawSummaryTotal(doc, report) { drawSectionTitle(doc, "Summary total"); drawTable(doc, ["total"], [{ total: report.total }], null, { rowHeight: 32 }); }
export function buildReportPdf(report, config = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" }), chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.fontSize(15).font("Helvetica-Bold").fillColor("#1f2937").text(env.organizationName || "West Bengal Forum for Mental Health", { align: "center" });
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#000000").text("Rehabilitation Center Expense Report", { align: "center" });
    doc.fontSize(9).fillColor("#555555").text(`Generated: ${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" }).format(new Date())}`);
    doc.fillColor("black").moveDown();
    const groupBy = Array.isArray(config.groupBy) ? config.groupBy : [], sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [], summarise = Boolean(config.summarise);
    if (groupBy.length) doc.fontSize(9).text(`Group by: ${groupBy.join(", ")}`);
    if (sortColumns.length) doc.fontSize(9).text(`Sort: ${sortColumns.map((item) => `${item.column} ${item.direction}`).join(", ")}`);
    doc.fontSize(9).text(`Summarise: ${summarise ? "Yes" : "No"}`); doc.moveDown(0.7);
    if (summarise) {
      if (groupBy.length) { drawGroupedBarChart(doc, report); doc.moveDown(0.5); drawPivotSummary(doc, report); doc.moveDown(0.8); drawGroupedRaw(doc, report.rawRows || [], groupBy, config); }
      else { drawGroupedBarChart(doc, report); drawSummaryTotal(doc, report); }
    } else if (groupBy.length) drawGroupedRaw(doc, report.rawRows || report.rows || [], groupBy, config);
    drawRawDump(doc, report.rawRows || report.rows || [], config); doc.end();
  });
}
