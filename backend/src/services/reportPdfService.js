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
    return money(value);
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

    if (!map.has(key)) {
      map.set(key, { ...row, survivorShares: [] });
    }

    const target = map.get(key);

    if (row.survivor && row.survivor !== "—") {
      target.survivorShares.push({
        name: row.survivor,
        amount: Number(row.share_price || 0),
      });
    }

    if (target.total_cost == null && row.total_cost != null) {
      target.total_cost = Number(row.total_cost);
    }
  }

  return [...map.values()].map((row) => {
    const shares = row.survivorShares;
    const total = Number(row.total_cost || shares.reduce((sum, item) => sum + item.amount, 0));

    const share = shares.length
      ? shares
          .map((item) => {
            const percentage = total ? ` (${((item.amount / total) * 100).toFixed(2)}%)` : "";
            return `${item.name}: ${money(item.amount)}${percentage}`;
          })
          .join(", ")
      : "No survivor share recorded";

    const { survivorShares, survivor, ...clean } = row;

    return {
      ...clean,
      share,
    };
  });
}

function drawCell(doc, value, column, x, y, width, height, textColor, fontSize) {
  const isProof = column === "proof_url" && value;
  const text = isProof ? "Open proof" : formatCell(value, column);

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
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function drawSectionTitle(doc, title, subtitle = "") {
  ensureSpace(doc, subtitle ? 48 : 30);
  doc.fontSize(13).font("Helvetica-Bold").fillColor("#000000").text(title);
  if (subtitle) {
    doc.moveDown(0.15);
    doc.fontSize(8).font("Helvetica").fillColor("#555555").text(subtitle);
  }
  doc.moveDown(0.45);
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

  doc.fillColor("#315f9f").font("Helvetica-Bold").fontSize(8).text("GROUP", x + 8, y + 5);

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
      .text(value, x + 145, y + 5 + index * lineHeight, {
        width: width - 153,
        ellipsis: true,
      });
  });

  doc.y = y + height + 6;
}

function drawTable(doc, columns, rows, widths = null, options = {}) {
  if (!columns.length) return;

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidths = widths || columns.map(() => usableWidth / columns.length);
  const headerHeight = options.headerHeight || 25;
  const rowHeight = options.rowHeight || 28;

  const drawRow = (values, header = false, index = 0) => {
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

  drawRow(
    Object.fromEntries(columns.map((column) => [column, column.replace(/_/g, " ").toUpperCase()])),
    true,
  );

  rows.forEach((item, index) => drawRow(item, false, index));
}

function groupRows(rows, groupBy) {
  const groups = new Map();

  for (const row of rows || []) {
    const key = groupBy.map((column) => String(row[column] ?? "—")).join("\u0001");

    if (!groups.has(key)) {
      groups.set(key, {
        values: Object.fromEntries(groupBy.map((column) => [column, row[column]])),
        rows: [],
      });
    }

    groups.get(key).rows.push(row);
  }

  return [...groups.values()];
}

function valueForSort(row, column) {
  if (column === "date") return row.expense_date || "";
  if (column === "price") {
    const value = row.total_cost ?? row.report_amount ?? row.share_price;
    return Number(value || 0);
  }
  return String(row[column] ?? "").toLowerCase();
}

function sortRows(rows, config = {}) {
  const sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [];
  const groupBy = Array.isArray(config.groupBy) ? config.groupBy : [];
  const active = [
    ...sortColumns,
    ...groupBy
      .filter((column) => !sortColumns.some((sort) => sort.column === column))
      .map((column) => ({ column, direction: "asc" })),
  ];

  if (!active.length) return [...rows];

  return [...rows].sort((a, b) => {
    for (const sort of active) {
      const left = valueForSort(a, sort.column);
      const right = valueForSort(b, sort.column);
      const direction = sort.direction === "desc" ? -1 : 1;

      if (left < right) return -1 * direction;
      if (left > right) return 1 * direction;
    }

    return 0;
  });
}

function drawGroupedRaw(doc, rows, groupBy, config) {
  const sourceRows = sortRows(rows, config);
  const shareRows = buildUiShareRows(sourceRows);
  const groups = groupRows(shareRows, groupBy);

  drawSectionTitle(
    doc,
    "Group-by detail tables",
    "Each table corresponds directly to a group represented in the summary table above.",
  );

  const preferred = ["expense_date", "category", "item", "share", "total_cost", "comment", "proof_url"];

  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) doc.moveDown(0.8);
    drawGroupIdentity(doc, groupBy, group.values);

    const first = group.rows[0] || {};
    const columns = preferred.filter((column) => Object.prototype.hasOwnProperty.call(first, column));
    const extras = Object.keys(first).filter(
      (column) =>
        !columns.includes(column) &&
        !["survivor", "survivorShares", "proof_key", "report_amount", "id", "expense_id"].includes(
          column,
        ),
    );

    drawTable(doc, [...columns, ...extras], group.rows);
  });

  if (!groups.length) {
    doc.fontSize(10).font("Helvetica").text("No records match the selected filters.");
  }
}

function drawGroupedBarChart(doc, report) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [];
  const rows = report.rows || [];

  if (!rows.length) return;

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x = doc.page.margins.left;
  const chartHeight = 210;
  const chartTop = doc.y + 22;
  const chartHeightInner = chartHeight - 62;
  const max = Math.max(...rows.map((row) => Number(row.total || 0)), 1);

  ensureSpace(doc, chartHeight + 30);
  doc.fontSize(13).font("Helvetica-Bold").fillColor("#000000").text("Pivot grouped bar chart");

  if (groupBy.length <= 1) {
    const data = rows.slice(0, 24);
    const slot = usableWidth / Math.max(data.length, 1);
    const barWidth = Math.max(8, Math.min(28, slot * 0.62));

    doc.strokeColor("#9aa8b8").moveTo(x, chartTop + chartHeightInner).lineTo(x + usableWidth, chartTop + chartHeightInner).stroke();

    data.forEach((row, index) => {
      const value = Number(row.total || 0);
      const barHeight = (value / max) * (chartHeightInner - 20);
      const bx = x + index * slot + (slot - barWidth) / 2;
      const by = chartTop + chartHeightInner - barHeight;

      doc.save();
      doc.fillColor("#315f9f").rect(bx, by, barWidth, barHeight).fill();
      doc.restore();

      doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(5.5).text(money(value), bx - 8, by - 10, {
        width: barWidth + 16,
        align: "center",
        ellipsis: true,
      });

      doc.font("Helvetica").fontSize(5.5).text(String(row[groupBy[0]] ?? row.label ?? "Total"), bx - 14, chartTop + chartHeightInner + 4, {
        width: barWidth + 28,
        height: 25,
        align: "center",
        ellipsis: true,
      });
    });

    doc.y = chartTop + chartHeight;
    return;
  }

  const rowGroups = groupBy.slice(0, -1);
  const pivotColumn = groupBy[groupBy.length - 1];
  const pivotValues = [...new Set(rows.map((row) => String(row[pivotColumn] ?? "—")))].slice(0, 10);
  const groupKeys = [...new Set(rows.map((row) => rowGroups.map((column) => String(row[column] ?? "—")).join("\u0001")))].slice(0, 16);
  const byKey = new Map(
    rows.map((row) => [
      rowGroups.map((column) => String(row[column] ?? "—")).join("\u0001") + "\u0002" + String(row[pivotColumn] ?? "—"),
      row,
    ]),
  );
  const slot = usableWidth / Math.max(groupKeys.length, 1);
  const barGap = 2;
  const seriesWidth = Math.max(5, Math.min(18, (slot - 8) / Math.max(pivotValues.length, 1)));
  const palette = ["#315f9f", "#d97706", "#059669", "#7c3aed", "#dc2626", "#0891b2", "#be185d", "#65a30d", "#475569", "#92400e"];

  doc.strokeColor("#9aa8b8").moveTo(x, chartTop + chartHeightInner).lineTo(x + usableWidth, chartTop + chartHeightInner).stroke();

  groupKeys.forEach((groupKey, groupIndex) => {
    pivotValues.forEach((pivot, pivotIndex) => {
      const row = byKey.get(groupKey + "\u0002" + pivot);
      const value = Number(row?.total || 0);
      const barHeight = (value / max) * (chartHeightInner - 24);
      const bx = x + groupIndex * slot + 4 + pivotIndex * (seriesWidth + barGap);
      const by = chartTop + chartHeightInner - barHeight;

      doc.save();
      doc.fillColor(palette[pivotIndex % palette.length]).rect(bx, by, seriesWidth, barHeight).fill();
      doc.restore();

      if (barHeight > 18) {
        doc.fillColor("#1f2937").font("Helvetica").fontSize(4.5).text(money(value), bx - 5, by - 8, {
          width: seriesWidth + 10,
          align: "center",
          ellipsis: true,
        });
      }
    });

    const label = groupKey.replace(/\u0001/g, " • ");
    doc.fillColor("#1f2937").font("Helvetica").fontSize(5).text(label, x + groupIndex * slot, chartTop + chartHeightInner + 4, {
      width: slot - 2,
      height: 28,
      align: "center",
      ellipsis: true,
    });
  });

  const legendY = chartTop + chartHeightInner + 34;
  pivotValues.forEach((pivot, index) => {
    const lx = x + index * Math.min(115, usableWidth / Math.max(pivotValues.length, 1));
    doc.save();
    doc.fillColor(palette[index % palette.length]).rect(lx, legendY, 8, 8).fill();
    doc.restore();
    doc.fillColor("#1f2937").font("Helvetica").fontSize(5.5).text(pivot, lx + 11, legendY - 1, {
      width: 100,
      ellipsis: true,
    });
  });

  doc.y = legendY + 14;
}

function drawPivotSummary(doc, report) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [];
  const rows = report.rows || [];

  if (!rows.length) {
    doc.fontSize(10).text("No records match the selected filters.");
    return;
  }

  drawSectionTitle(doc, "Pivot grouped summary table", "The final grouping column is shown as the pivoted column; repeated group labels are merged visually where possible.");

  if (groupBy.length <= 1) {
    drawTable(doc, [...groupBy, "total"], rows, null, { rowHeight: 30 });
    return;
  }

  const rowGroups = groupBy.slice(0, -1);
  const pivotColumn = groupBy[groupBy.length - 1];
  const pivotValues = [...new Set(rows.map((row) => String(row[pivotColumn] ?? "—")))];
  const byKey = new Map(
    rows.map((row) => [
      rowGroups.map((column) => String(row[column] ?? "—")).join("\u0001") + "\u0002" + String(row[pivotColumn] ?? "—"),
      row,
    ]),
  );
  const rowKeys = [...new Set(rows.map((row) => rowGroups.map((column) => String(row[column] ?? "—")).join("\u0001")))];
  const cols = [...rowGroups, ...pivotValues, "total"];
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const groupWidth = (usableWidth * 0.42) / Math.max(rowGroups.length, 1);
  const valueWidth = (usableWidth * 0.58) / (pivotValues.length + 1);
  const widths = rowGroups.map(() => groupWidth).concat(pivotValues.map(() => valueWidth), valueWidth);

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
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(6.5).text(String(column).replace(/_/g, " ").toUpperCase(), x + 3, headerY + 8, {
      width: w - 6,
      height: headerH - 10,
      align: "center",
      ellipsis: true,
    });
    x += w;
  });

  doc.y = headerY + headerH;

  for (let r = 0; r < rowKeys.length; r += 1) {
    const key = rowKeys[r];
    const parts = key.split("\u0001");
    let span = 1;

    while (
      r + span < rowKeys.length &&
      rowKeys[r + span].split("\u0001").slice(0, rowGroups.length).join("\u0001") ===
        parts.slice(0, rowGroups.length).join("\u0001")
    ) {
      span += 1;
    }

    const h = 28 * span;
    ensureSpace(doc, h);
    const y = doc.y;
    let xx = x0;

    rowGroups.forEach((column, i) => {
      const w = widths[i];
      const val = parts[i] ?? "—";
      let count = 1;

      while (
        r + count < r + span &&
        rowKeys[r + count].split("\u0001")[i] === val
      ) {
        count += 1;
      }

      const cellH = 28 * count;
      doc.save();
      doc.fillColor("#eef4fb").rect(xx, y, w, cellH).fill();
      doc.restore();
      doc.strokeColor("#b8c7da").rect(xx, y, w, cellH).stroke();
      doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(7).text(formatCell(val, column), xx + 3, y + cellH / 2 - 4, {
        width: w - 6,
        height: 12,
        ellipsis: true,
      });
      xx += w;
    });

    const valueX = xx;
    const rowGroupRows = rowKeys.slice(r, r + span);

    rowGroupRows.forEach((rowKey, localIndex) => {
      const yy = y + localIndex * 28;
      let valueXCurrent = valueX;

      pivotValues.forEach((pivot, pIndex) => {
        const w = widths[rowGroups.length + pIndex];
        const row = byKey.get(rowKey + "\u0002" + pivot);
        doc.save();
        doc.fillColor(localIndex % 2 ? "#ffffff" : "#f8fbff").rect(valueXCurrent, yy, w, 28).fill();
        doc.restore();
        doc.strokeColor("#b8c7da").rect(valueXCurrent, yy, w, 28).stroke();
        doc.fillColor("#1f2937").font("Helvetica").fontSize(6.5).text(row ? money(row.total) : "—", valueXCurrent + 3, yy + 8, {
          width: w - 6,
          align: "right",
          ellipsis: true,
        });
        valueXCurrent += w;
      });

      const total = rowGroupRows.reduce(
        (sum, rowKey) =>
          sum + pivotValues.reduce((s, pivot) => s + Number(byKey.get(rowKey + "\u0002" + pivot)?.total || 0), 0),
        0,
      );
      const tw = widths[widths.length - 1];
      doc.save();
      doc.fillColor("#f5f8fc").rect(valueXCurrent, yy, tw, 28).fill();
      doc.restore();
      doc.strokeColor("#b8c7da").rect(valueXCurrent, yy, tw, 28).stroke();
      doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(6.5).text(money(total), valueXCurrent + 3, yy + 8, {
        width: tw - 6,
        align: "right",
      });
    });

    doc.y = y + h;
    r += span - 1;
  }
}

function drawRawDump(doc, rows, config) {
  doc.addPage();

  drawSectionTitle(
    doc,
    "Raw dump — filtered expense data",
    "This section contains the underlying filtered expense records. The Share column lists each survivor share as amount and percentage of the expense total. Proof links are clickable where a proof file exists.",
  );

  const sourceRows = sortRows(rows || [], config);

  if (!sourceRows.length) {
    doc.fontSize(10).font("Helvetica").text("No records match the selected filters.");
    return;
  }

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

  const first = unsplitRows[0];
  const columns = preferred.filter((column) => Object.prototype.hasOwnProperty.call(first, column));
  const extras = Object.keys(first).filter(
    (column) =>
      !columns.includes(column) &&
      !["survivor", "survivorShares", "proof_key", "report_amount", "id", "expense_id"].includes(column),
  );

  drawTable(doc, [...columns, ...extras], unsplitRows, null, { rowHeight: 30 });
}

function drawSummaryTotal(doc, report) {
  drawSectionTitle(doc, "Summary total");
  drawTable(doc, ["total"], [{ total: report.total }], null, { rowHeight: 32 });
}

export function buildReportPdf(report, config = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(15).font("Helvetica-Bold").fillColor("#1f2937").text(
      env.organizationName || "West Bengal Forum for Mental Health",
      { align: "center" },
    );
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#000000").text("Rehabilitation Center Expense Report", {
      align: "center",
    });
    doc.fontSize(9).fillColor("#555555").text(
      `Generated: ${new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date())}`,
    );
    doc.fillColor("black").moveDown();

    const groupBy = Array.isArray(config.groupBy) ? config.groupBy : [];
    const sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [];
    const summarise = Boolean(config.summarise);

    if (groupBy.length) doc.fontSize(9).text(`Group by: ${groupBy.join(", ")}`);
    if (sortColumns.length) {
      doc.fontSize(9).text(
        `Sort: ${sortColumns.map((item) => `${item.column} ${item.direction}`).join(", ")}`,
      );
    }
    doc.fontSize(9).text(`Summarise: ${summarise ? "Yes" : "No"}`);
    doc.moveDown(0.7);

    /*
     * 1. Summarise selected:
     *    - pivot grouped bar chart
     *    - pivot grouped summary table
     *    - group-by detail tables
     *    - raw filtered dump
     *
     * 2. Summarise not selected + group-by selected:
     *    - group-by detail tables
     *    - raw filtered dump
     *
     * 3. Neither selected:
     *    - raw filtered dump
     */
    if (summarise) {
      if (groupBy.length) {
        drawGroupedBarChart(doc, report);
        doc.moveDown(0.5);
        drawPivotSummary(doc, report);
        doc.moveDown(0.8);
        drawGroupedRaw(doc, report.rawRows || [], groupBy, config);
      } else {
        drawGroupedBarChart(doc, report);
        drawSummaryTotal(doc, report);
      }
    } else if (groupBy.length) {
      drawGroupedRaw(doc, report.rawRows || report.rows || [], groupBy, config);
    }

    drawRawDump(doc, report.rawRows || report.rows || [], config);

    doc.end();
  });
}
