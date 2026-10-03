import PDFDocument from "pdfkit";
function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}
function dateLabel(value) {
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-IN", {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(d);
}
function yearLabel(start) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", year: "numeric" }).format(
    new Date(`${String(start).slice(0, 10)}T00:00:00Z`),
  );
}
function pivot(rows, periods) {
  const survivors = [...new Set(rows.map((r) => r.survivor || "Unknown"))].sort();
  const map = new Map(periods.map((p) => [p, { period: p }]));
  for (const r of rows) {
    if (!map.has(r.yearStart)) map.set(r.yearStart, { period: r.yearStart });
    map.get(r.yearStart)[r.survivor || "Unknown"] = Number(r.total || 0);
  }
  return { survivors, rows: [...map.values()] };
}
function drawBarChart(doc, data) {
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right,
    h = 170,
    x0 = doc.page.margins.left + 35,
    base = doc.y + h,
    max = Math.max(...data.map((r) => Number(r.total) || 0), 1),
    bw = Math.max(100, Math.min(180, (w - 40) / Math.max(data.length, 1) - 25));
  data.forEach((r, i) => {
    const bh = (Number(r.total) / max) * (h - 35),
      x = x0 + i * (bw + 25),
      y = base - bh;
    doc.rect(x, y, bw, bh).fill();
    doc
      .fillColor("black")
      .fontSize(9)
      .text(yearLabel(r.yearStart), x - 10, base + 6, { width: bw + 20, align: "center" });
    doc.fontSize(9).text(money(r.total), x - 10, y - 15, { width: bw + 20, align: "center" });
  });
  doc.y = base + 35;
}
function drawSurvivorChart(doc, rows, survivors) {
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right,
    h = 175,
    x0 = doc.page.margins.left + 45,
    base = doc.y + h,
    max = Math.max(...rows.map((r) => survivors.reduce((s, k) => s + Number(r[k] || 0), 0)), 1),
    bw = Math.max(70, Math.min(150, (w - 30) / Math.max(rows.length, 1) - 25)),
    palette = [
      "#315f9f",
      "#4f81bd",
      "#70ad47",
      "#ed7d31",
      "#a5a5a5",
      "#8064a2",
      "#ffc000",
      "#5b9bd5",
    ];
  rows.forEach((r, idx) => {
    const x = x0 + idx * (bw + 25);
    let y = base;
    survivors.forEach((s, i) => {
      const bh = (Number(r[s] || 0) / max) * (h - 45);
      if (bh > 0) {
        y -= bh;
        doc.save();
        doc.fillColor(palette[i % palette.length]);
        doc.rect(x, y, bw, bh).fill();
        doc.restore();
      }
    });
    doc
      .fillColor("black")
      .fontSize(9)
      .text(yearLabel(r.period), x - 10, base + 6, { width: bw + 20, align: "center" });
  });
  let ly = base + 28,
    lx = x0;
  survivors.forEach((s, i) => {
    const lw = Math.min(120, Math.max(50, doc.widthOfString(s, { fontSize: 7 }) + 18));
    if (lx + lw > doc.page.width - doc.page.margins.right) lx = x0;
    doc.save();
    doc
      .fillColor(palette[i % palette.length])
      .rect(lx, ly, 8, 8)
      .fill();
    doc.restore();
    doc
      .fillColor("black")
      .fontSize(7)
      .text(s, lx + 11, ly - 1, { width: lw - 11 });
    lx += lw;
  });
  doc.y = ly + 20;
}
function drawTable(doc, columns, rows, widths = null) {
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right,
    ws = widths || columns.map(() => usable / columns.length);
  const row = (v, head = false, i = 0) => {
    const ht = head ? 25 : 28;
    if (doc.y + ht > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    let x = doc.page.margins.left;
    columns.forEach((c, j) => {
      const ww = ws[j];
      doc.save();
      doc.fillColor(head ? "#315f9f" : i % 2 ? "#fff" : "#eef4fb");
      doc.rect(x, y, ww, ht).fill();
      doc.restore();
      doc.strokeColor("#b8c7da").rect(x, y, ww, ht).stroke();
      const proof = !head && c === "proof" && v[c];
      doc
        .fillColor(head ? "#fff" : proof ? "#2563eb" : "#1f2937")
        .fontSize(head ? 7 : 6)
        .font(head ? "Helvetica-Bold" : "Helvetica")
        .text(proof ? "Download Proof" : String(v[c] ?? "—"), x + 3, y + 5, {
          width: ww - 6,
          height: ht - 7,
          ellipsis: true,
          link: proof ? String(v[c]) : undefined,
          underline: Boolean(proof),
        });
      x += ww;
    });
    doc.y = y + ht;
  };
  row(Object.fromEntries(columns.map((c) => [c, c.replace(/_/g, " ").toUpperCase()])), true);
  rows.forEach((r, i) => row(r, false, i));
}
function uiShareDumpRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.expenseId ?? `${r.date}|${r.category}|${r.item}|${r.comment}`;
    if (!map.has(k)) map.set(k, { ...r, shares: [] });
    const t = map.get(k);
    if (r.survivor && r.survivor !== "—")
      t.shares.push({ name: r.survivor, amount: Number(r.price || 0) });
  }
  return [...map.values()].map((r) => {
    const total = Number(r.totalCost || r.shares.reduce((s, x) => s + x.amount, 0));
    const share = r.shares.length
      ? r.shares
          .map(
            (x) =>
              `${x.name}: ₹${x.amount.toFixed(2)}${total ? ` (${((x.amount / total) * 100).toFixed(2)}%)` : ""}`,
          )
          .join(", ")
      : "No survivor share recorded";
    return { ...r, share };
  });
}
export function buildYearlyEmailReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape" }),
      chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(20).text("Rehabilitation Center Expense - 2 Year Report");
    doc.fontSize(9).fillColor("#555").text(`Generated: ${report.generatedAt}`);
    doc.fillColor("black").moveDown();
    doc.fontSize(14).text("1. Two-year yearly expense bar chart");
    doc.moveDown(0.4);
    drawBarChart(doc, report.yearlySummary);
    doc.moveDown();
    doc.fontSize(14).text("2. Two-year yearly summary");
    doc.moveDown(0.4);
    drawTable(
      doc,
      ["year", "total", "expense_count"],
      report.yearlySummary.map((r) => ({
        year: yearLabel(r.yearStart),
        total: money(r.total),
        expense_count: r.expenseCount,
      })),
    );
    doc.addPage();
    doc.fontSize(14).text("3. Two-year group by survivor pivot");
    doc.moveDown(0.4);
    const p = pivot(
      report.survivorSummary,
      report.yearlySummary.map((r) => r.yearStart),
    );
    drawSurvivorChart(doc, p.rows, p.survivors);
    doc.moveDown(0.5);
    drawTable(
      doc,
      ["year", ...p.survivors],
      p.rows.map((r) => ({
        year: yearLabel(r.period),
        ...Object.fromEntries(p.survivors.map((s) => [s, money(r[s])])),
      })),
    );
    doc.addPage();
    doc.fontSize(14).text("4. Expense data dump - last 2 completed years");
    doc.moveDown(0.4);
    drawTable(
      doc,
      ["date", "category", "item", "share", "comment", "proof"],
      uiShareDumpRows(report.dump).map((r) => ({
        date: dateLabel(r.date),
        category: r.category,
        item: r.item,
        share: r.share,
        comment: r.comment,
        proof: r.proofUrl,
      })),
      [55, 85, 100, 135, 75, 60],
    );
    doc.end();
  });
}
