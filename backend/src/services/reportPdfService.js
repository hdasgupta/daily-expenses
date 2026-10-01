import PDFDocument from "pdfkit";

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

function drawTable(doc, columns, rows) {
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidth = Math.max(60, usableWidth / Math.max(columns.length, 1));
  const rowHeight = 34;
  const headerHeight = 28;

  const drawRow = (row, header = false, rowIndex = 0) => {
    if (doc.y + (header ? headerHeight : rowHeight) > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }

    const y = doc.y;
    const fill = header ? "#315f9f" : rowIndex % 2 === 0 ? "#eef4fb" : "#ffffff";
    const textColor = header ? "#ffffff" : "#1f2937";

    columns.forEach((column, index) => {
      const x = doc.page.margins.left + index * columnWidth;
      const height = header ? headerHeight : rowHeight;

      doc.save();
      doc.fillColor(fill).rect(x, y, columnWidth, height).fill();
      doc.restore();
      doc.strokeColor("#b8c7da").rect(x, y, columnWidth, height).stroke();

      doc
        .fillColor(textColor)
        .fontSize(header ? 7 : 6)
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .text(
          header ? column.replace(/_/g, " ").toUpperCase() : formatCell(row[column], column),
          x + 3,
          y + 5,
          {
            width: columnWidth - 6,
            height: height - 7,
            ellipsis: true,
          },
        );
    });

    doc.fillColor("black");
    doc.y = y + (header ? headerHeight : rowHeight);
  };

  drawRow({}, true);
  rows.forEach((row, index) => drawRow(row, false, index));
}

export function buildReportPdf(report, config = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Rehabilitation Center Expense Report");
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

    const pdfColumns = (report.columns || []).filter((column) => column !== "proof_url");
    drawTable(doc, pdfColumns, report.rows || []);

    doc.moveDown();
    doc.fontSize(11).text(`Total: ₹${Number(report.total || 0).toFixed(2)}`);
    doc.end();
  });
}
