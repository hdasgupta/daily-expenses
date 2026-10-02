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


function buildUiShareRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.expense_id ?? `${row.expense_date}|${row.category}|${row.item}|${row.comment}|${row.proof_key}`;
    if (!map.has(key)) {
      map.set(key, {
        ...row,
        survivorShares: [],
      });
    }
    const target = map.get(key);
    if (row.survivor && row.survivor !== "—") {
      target.survivorShares.push({ name: row.survivor, amount: Number(row.share_price || 0) });
    }
    if (target.total_cost == null && row.total_cost != null) target.total_cost = Number(row.total_cost);
  }

  return [...map.values()].map((row) => {
    const shares = row.survivorShares;
    const total = Number(row.total_cost || shares.reduce((sum, item) => sum + item.amount, 0));
    const survivor = shares.length ? shares.map((item) => item.name).join(", ") : "—";
    let share;
    if (!shares.length) {
      share = "No survivor share recorded";
    } else if (shares.length === 1) {
      const item = shares[0];
      const pct = total ? ` (${((item.amount / total) * 100).toFixed(2)}%)` : "";
      share = `${item.name}: ₹${item.amount.toFixed(2)}${pct}`;
    } else {
      share = shares
        .map((item) => {
          const pct = total ? ` (${((item.amount / total) * 100).toFixed(2)}%)` : "";
          return `${item.name}: ₹${item.amount.toFixed(2)}${pct}`;
        })
        .join(", ");
    }

    return {
      ...row,
      survivor,
      share,
    };
  });
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

      if (header) {
        doc
          .fillColor(textColor)
          .fontSize(7)
          .font("Helvetica-Bold")
          .text(column.replace(/_/g, " ").toUpperCase(), x + 3, y + 5, {
            width: columnWidth - 6,
            height: height - 7,
            ellipsis: true,
          });
      } else {
        drawCell(doc, row[column], column, x, y, columnWidth, height, textColor, 6);
      }
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

    // Match the normal report UI: one expense row with all survivors and a dynamic share detail.
    const isNormalRaw = report.mode === "raw" && (report.columns || []).includes("share_price");
    const sourceRows = isNormalRaw ? buildUiShareRows(report.rows || []) : report.rows || [];
    const pdfColumns = isNormalRaw
      ? [...new Set((report.columns || []).map((column) => column === "share_price" ? "share" : column))]
      : [...new Set(report.columns || [])];
    drawTable(doc, pdfColumns, sourceRows);

    doc.moveDown();
    doc.fontSize(11).text(`Total: ₹${Number(report.total || 0).toFixed(2)}`);
    doc.end();
  });
}
