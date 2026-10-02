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

function drawCell(doc, value, column, x, y, width, height, textColor, fontSize) {
  const isProof = column === "proof_url" && value;
  const text = isProof ? "View Proof" : formatCell(value, column);

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
    const value = group[column] === null || group[column] === undefined || group[column] === ""
      ? "—"
      : formatCell(group[column], column);
    doc
      .fillColor("#1f2937")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(`${column.replace(/_/g, " ")}:`, x + 58, y + 5 + index * lineHeight, {
        width: 90,
      });
    doc
      .font("Helvetica")
      .text(value, x + 145, y + 5 + index * lineHeight, {
        width: width - 153,
        ellipsis: true,
      });
  });

  doc.y = y + height + 6;
}

function drawTable(doc, columns, rows, widths = null) {
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidths = widths || columns.map(() => usableWidth / Math.max(columns.length, 1));
  const headerHeight = 25;
  const rowHeight = 28;

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
      doc
        .fillColor(header ? "#ffffff" : "#1f2937")
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

function drawGroupHeader(doc, groupBy, group, groupIndex, groupCount) {
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const lineHeight = 16;
  const height = Math.max(40, 24 + groupBy.length * lineHeight);

  ensureSpace(doc, height + 12);
  const y = doc.y;

  doc.save();
  doc.fillColor("#e8f1fb").roundedRect(x, y, width, height, 5).fill();
  doc.restore();
  doc.strokeColor("#b8c7da").roundedRect(x, y, width, height, 5).stroke();

  doc
    .fillColor("#315f9f")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(`GROUP ${groupIndex + 1}${groupCount ? ` / ${groupCount}` : ""}`, x + 8, y + 6);

  groupBy.forEach((column, index) => {
    const rawValue = group[column];
    const value = rawValue === null || rawValue === undefined || rawValue === ""
      ? "—"
      : formatCell(rawValue, column);
    const yy = y + 22 + index * lineHeight;

    doc
      .fillColor("#1f2937")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(column.replace(/_/g, " "), x + 8, yy, {
        width: 95,
      });
    doc
      .font("Helvetica")
      .text(`: ${value}`, x + 103, yy, {
        width: width - 111,
        ellipsis: true,
      });
  });

  doc.y = y + height + 7;
}

function drawGroupedRaw(doc, report) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [];
  const groups = groupRows(report.rows || [], groupBy);
  const dataColumns = (report.columns || []).filter((column) => !groupBy.includes(column));

  if (!groups.length) {
    doc.fontSize(10).fillColor("#1f2937").text("No records match the selected filters.");
    return;
  }

  groups.forEach((group, groupIndex) => {
    // Each unique group selection is rendered as a distinct section, followed
    // immediately by only that group's rows, matching the grouped UI layout.
    if (groupIndex > 0) {
      doc.addPage();
    }

    drawGroupHeader(doc, groupBy, group.values, groupIndex, groups.length);
    drawTable(doc, dataColumns, group.rows);
  });
}

function drawGroupedSummary(doc, report) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [];
  const groups = report.rows || [];

  if (!groups.length) {
    doc.fontSize(10).fillColor("#1f2937").text("No records match the selected filters.");
    return;
  }

  groups.forEach((group, index) => {
    if (index > 0) {
      doc.addPage();
    }

    drawGroupHeader(doc, groupBy, group, index, groups.length);
    ensureSpace(doc, 32);
    const x = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const y = doc.y;
    doc.save();
    doc.fillColor("#f5f8fc").roundedRect(x, y, width, 28, 4).fill();
    doc.restore();
    doc.strokeColor("#d1dbe8").roundedRect(x, y, width, 28, 4).stroke();
    doc
      .fillColor("#1f2937")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("Total price", x + 8, y + 8);
    doc
      .fillColor("#1f2937")
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(money(group.total), x + width - 110, y + 7, { width: 102, align: "right" });
    doc.y = y + 28;
  });
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
    if (sortColumns.length) {
      doc
        .fontSize(9)
        .text(`Sort: ${sortColumns.map((item) => `${item.column} ${item.direction}`).join(", ")}`);
    }
    doc.fontSize(11).text(`Mode: ${report.mode}`);
    doc.moveDown(0.7);

    // Keep the PDF layout consistent with the report UI: when grouping is enabled,
    // render each group identity first and then its rows/data underneath it.
    if (Array.isArray(report.groupBy) && report.groupBy.length && report.mode === "grouped-raw") {
      drawGroupedRaw(doc, report);
    } else if (Array.isArray(report.groupBy) && report.groupBy.length && report.mode === "summary") {
      drawGroupedSummary(doc, report);
    } else {
      const pdfColumns = [...new Set(report.columns || [])];
      drawTable(doc, pdfColumns, report.rows || []);
    }

    doc.moveDown();
    doc.fontSize(11).text(`Total: ₹${Number(report.total || 0).toFixed(2)}`);
    doc.end();
  });
}
