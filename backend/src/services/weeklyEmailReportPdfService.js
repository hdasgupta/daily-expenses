import PDFDocument from "pdfkit";
import { runPdfInWorker } from "./pdfWorkerPool.js";

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
  const iso = normalizeIsoDateText(value);
  const d = new Date(`${iso}T00:00:00Z`);

  return !iso || Number.isNaN(d.getTime())
    ? String(value ?? "—")
    : new Intl.DateTimeFormat("en-IN", {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(d);
}

function weekLabel(start, end) {
  return `${dateLabel(start)} - ${dateLabel(end)}`;
}

function weekEndFromStart(value) {
  const iso = normalizeIsoDateText(value);
  const start = new Date(`${iso}T00:00:00Z`);

  if (!iso || Number.isNaN(start.getTime())) {
    return null;
  }

  return new Date(start.getTime() + 6 * 86400000)
    .toISOString()
    .slice(0, 10);
}

function safeWeekLabel(start, end = null) {
  const startText = normalizeIsoDateText(start);
  const endText = end ? normalizeIsoDateText(end) : weekEndFromStart(startText);

  if (!startText || !endText) {
    return "Unknown week";
  }

  return weekLabel(startText, endText);
}

function pivot(rows, periods) {
  const validPeriods = periods.filter(
    (period) => weekEndFromStart(period) !== null,
  );

  const survivors = [
    ...new Set(
      rows
        .filter((row) => weekEndFromStart(row.weekStart) !== null)
        .map((row) => row.survivor || "Unknown"),
    ),
  ].sort();

  const map = new Map(
    validPeriods.map((period) => [
      period,
      {
        period,
      },
    ]),
  );

  for (const row of rows) {
    if (weekEndFromStart(row.weekStart) === null) {
      continue;
    }

    if (!map.has(row.weekStart)) {
      map.set(row.weekStart, {
        period: row.weekStart,
      });
    }

    map.get(row.weekStart)[row.survivor || "Unknown"] =
      Number(row.total || 0);
  }

  return {
    survivors,
    rows: [...map.values()],
  };
}

function drawBarChart(doc, data) {
  if (!data.length) {
    doc.fontSize(9).fillColor("#555").text("No expense data available.", doc.page.margins.left, doc.y);
    doc.fillColor("black");
    return;
  }

  const w =
      doc.page.width -
      doc.page.margins.left -
      doc.page.margins.right,
    h = 170,
    x0 = doc.page.margins.left + 15,
    base = doc.y + h,
    max = Math.max(
      ...data.map((row) => Number(row.total) || 0),
      1,
    ),
    bw = Math.max(
      50,
      Math.min(
        85,
        (w - 30) / Math.max(data.length, 1) - 15,
      ),
    );

  data.forEach((row, index) => {
    const bh =
        (Number(row.total) / max) * (h - 35),
      x = x0 + index * (bw + 15),
      y = base - bh;

    doc.rect(x, y, bw, bh).fill();

    doc
      .fillColor("black")
      .fontSize(6.5)
      .text(
        weekLabel(row.weekStart, row.weekEnd),
        x - 8,
        base + 5,
        {
          width: bw + 16,
          align: "center",
        },
      );

    doc
      .fontSize(7)
      .text(
        money(row.total),
        x - 8,
        y - 12,
        {
          width: bw + 16,
          align: "center",
        },
      );
  });

  doc.x = doc.page.margins.left;
  doc.y = base + 30;
}

function drawSurvivorChart(doc, rows, survivors) {
  if (!rows.length || !survivors.length) {
    doc
      .fontSize(9)
      .fillColor("#555")
      .text("No survivor share data available.", doc.page.margins.left, doc.y);

    doc.fillColor("black");
    return;
  }

  const w =
      doc.page.width -
      doc.page.margins.left -
      doc.page.margins.right,
    h = 175,
    x0 = doc.page.margins.left + 12,
    base = doc.y + h,
    max = Math.max(
      ...rows.map((row) =>
        survivors.reduce(
          (sum, survivor) =>
            sum + Number(row[survivor] || 0),
          0,
        ),
      ),
      1,
    ),
    bw = Math.max(
      25,
      Math.min(
        55,
        (w - 20) / Math.max(rows.length, 1) - 8,
      ),
    ),
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

  rows.forEach((row, index) => {
    const x = x0 + index * (bw + 8);
    let y = base;

    survivors.forEach((survivor, survivorIndex) => {
      const bh =
        (Number(row[survivor] || 0) / max) *
        (h - 45);

      if (bh > 0) {
        y -= bh;

        doc.save();
        doc
          .fillColor(
            palette[survivorIndex % palette.length],
          )
          .rect(x, y, bw, bh)
          .fill();
        doc.restore();
      }
    });

    doc
      .fillColor("black")
      .fontSize(5.5)
      .text(
        safeWeekLabel(row.period),
        x - 5,
        base + 5,
        {
          width: bw + 10,
          align: "center",
        },
      );
  });

  let ly = base + 25;
  let lx = x0;

  survivors.forEach((survivor, index) => {
    const lw = Math.min(
      100,
      Math.max(
        45,
        doc.widthOfString(survivor, {
          fontSize: 7,
        }) + 16,
      ),
    );

    if (
      lx + lw >
      doc.page.width - doc.page.margins.right
    ) {
      lx = x0;
      ly += 13;
    }

    doc.save();

    doc
      .fillColor(
        palette[index % palette.length],
      )
      .rect(lx, ly, 8, 8)
      .fill();

    doc.restore();

    doc
      .fillColor("black")
      .fontSize(7)
      .text(survivor, lx + 11, ly - 1, {
        width: lw - 11,
      });

    lx += lw;
  });

  doc.x = doc.page.margins.left;
  doc.y = ly + 18;
}

function drawTable(
  doc,
  columns,
  rows,
  widths = null,
) {
  const usable =
      doc.page.width -
      doc.page.margins.left -
      doc.page.margins.right,
    ws =
      widths ||
      columns.map(
        () => usable / columns.length,
      );

  const usablePageHeight =
    doc.page.height -
    doc.page.margins.top -
    doc.page.margins.bottom;

  const measureRowHeight = (values) => {
    let maxTextHeight = 0;
    columns.forEach((column, columnIndex) => {
      const width = ws[columnIndex];
      const proof = column === "proof" && values[column];
      const cellText = proof
        ? "Download Proof"
        : String(values[column] ?? "—");
      doc.font(proof ? "Helvetica-Bold" : "Helvetica").fontSize(6);
      const h = doc.heightOfString(cellText, {
        width: Math.max(width - 6, 4),
      });
      if (h > maxTextHeight) maxTextHeight = h;
    });
    return Math.min(
      usablePageHeight,
      Math.max(28, Math.ceil(maxTextHeight + 12)),
    );
  };

  const drawRow = (
    values,
    head = false,
    index = 0,
  ) => {
    const rowHeight = head ? 25 : measureRowHeight(values);

    if (
      doc.y + rowHeight >
        doc.page.height - doc.page.margins.bottom &&
      doc.y > doc.page.margins.top + 1
    ) {
      doc.addPage();
    }

    const y = doc.y;
    let x = doc.page.margins.left;

    columns.forEach((column, columnIndex) => {
      const width = ws[columnIndex];

      doc.save();

      doc
        .fillColor(
          head
            ? "#315f9f"
            : index % 2
              ? "#ffffff"
              : "#eef4fb",
        )
        .rect(x, y, width, rowHeight)
        .fill();

      doc.restore();

      doc
        .strokeColor("#b8c7da")
        .rect(x, y, width, rowHeight)
        .stroke();

      const proof =
        !head &&
        column === "proof" &&
        values[column];

      const cellText = proof
        ? "Download Proof"
        : String(values[column] ?? "—");

      const textOptions = head
        ? {
            width: Math.max(width - 6, 4),
            height: rowHeight - 7,
            ellipsis: true,
          }
        : {
            width: Math.max(width - 6, 4),
            lineBreak: true,
            link: proof ? String(values[column]) : undefined,
            underline: Boolean(proof),
          };

      doc
        .fillColor(
          head
            ? "#ffffff"
            : proof
              ? "#2563eb"
              : "#1f2937",
        )
        .fontSize(head ? 7 : 6)
        .font(
          head
            ? "Helvetica-Bold"
            : "Helvetica",
        )
        .text(
          cellText,
          x + 3,
          y + 5,
          textOptions,
        );

      x += width;
    });

    doc.x = doc.page.margins.left;
    doc.y = y + rowHeight;
  };

  drawRow(
    Object.fromEntries(
      columns.map((column) => [
        column,
        column
          .replace(/_/g, " ")
          .toUpperCase(),
      ]),
    ),
    true,
  );

  rows.forEach((row, index) => {
    drawRow(row, false, index);
  });
}

function uiShareDumpRows(rows) {
  const map = new Map();

  for (const row of rows) {
    const key =
      row.expenseId ??
      `${row.date}|${row.category}|${row.item}|${row.comment}`;

    if (!map.has(key)) {
      map.set(key, {
        ...row,
        shares: [],
      });
    }

    const target = map.get(key);

    if (
      row.survivor &&
      row.survivor !== "—"
    ) {
      target.shares.push({
        name: row.survivor,
        amount: Number(row.price || 0),
      });
    }
  }

  return [...map.values()].map((row) => {
    const total = Number(
      row.totalCost ||
        row.shares.reduce(
          (sum, share) =>
            sum + share.amount,
          0,
        ),
    );

    const share = row.shares.length
      ? row.shares
          .map((shareItem) => {
            const percentage = total
              ? (
                  (shareItem.amount /
                    total) *
                  100
                ).toFixed(2)
              : "0.00";

            return `${shareItem.name}: ${money(
              shareItem.amount,
            )} (${percentage}%)`;
          })
          .join(", ")
      : "No survivor share recorded";

    return {
      ...row,
      share,
    };
  });
}

export function buildWeeklyEmailReportPdfInProcess(
  report,
) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
        size: "A4",
        margin: 36,
        layout: "landscape",
      }),
      chunks = [];

    doc.on("data", (chunk) =>
      chunks.push(chunk),
    );

    doc.on("end", () =>
      resolve(Buffer.concat(chunks)),
    );

    doc.on("error", reject);

    const left = doc.page.margins.left;

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(
        "Rehabilitation Center Expense - 4 Week Weekly Report",
        left,
        doc.y,
      );

    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555")
      .text(
        `Generated: ${report.generatedAt}`,
        left,
        doc.y,
      );

    doc
      .fillColor("black")
      .moveDown();

    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(
        "1. Four-week weekly expense bar chart",
        left,
        doc.y,
      );

    doc.moveDown(0.4);

    drawBarChart(
      doc,
      report.weeklySummary,
    );

    doc.moveDown();

    doc.x = left;
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(
        "2. Four-week weekly summary table",
        left,
        doc.y,
      );

    doc.moveDown(0.4);

    drawTable(
      doc,
      [
        "week",
        "total",
        "expense_count",
      ],
      report.weeklySummary.map((row) => ({
        week: weekLabel(
          row.weekStart,
          row.weekEnd,
        ),
        total: money(row.total),
        expense_count:
          row.expenseCount,
      })),
    );

    doc.addPage();

    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(
        "3. Four-week weekly group-by-survivor summarized pivot bar chart",
        left,
        doc.y,
      );

    doc.moveDown(0.4);

    const survivorPivot = pivot(
      report.survivorSummary,
      report.weeklySummary.map(
        (row) => row.weekStart,
      ),
    );

    drawSurvivorChart(
      doc,
      survivorPivot.rows,
      survivorPivot.survivors,
    );

    doc.addPage();

    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(
        "4. Four-week weekly group-by-survivor summarized pivot data",
        left,
        doc.y,
      );

    doc.moveDown(0.4);

    if (
      !survivorPivot.rows.length ||
      !survivorPivot.survivors.length
    ) {
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#555")
        .text(
          "No survivor share data available for the four completed weeks.",
          left,
          doc.y,
        );

      doc.fillColor("black");
    } else {
      drawTable(
        doc,
        [
          "week",
          ...survivorPivot.survivors,
        ],
        survivorPivot.rows.map((row) => ({
          week: safeWeekLabel(
            row.period,
          ),
          ...Object.fromEntries(
            survivorPivot.survivors.map(
              (survivor) => [
                survivor,
                money(
                  row[survivor],
                ),
              ],
            ),
          ),
        })),
      );
    }

    doc.addPage();

    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(
        "5. Four-week raw expense data dump",
        left,
        doc.y,
      );

    doc.moveDown(0.3);

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#555")
      .text(
        "Each expense is shown as one understandable record. " +
          "The share column lists every survivor and their share amount " +
          "with the percentage of the expense total. " +
          "Proof links are clickable when a proof document was uploaded.",
        left,
        doc.y,
      );

    doc
      .fillColor("black")
      .moveDown(0.5);

    const rawDumpRows =
      uiShareDumpRows(report.dump);

    if (!rawDumpRows.length) {
      doc
        .fontSize(9)
        .fillColor("#555")
        .text(
          "No expense records were found for the four completed weeks.",
          left,
          doc.y,
        );

      doc.fillColor("black");
    } else {
      drawTable(
        doc,
        [
          "date",
          "category",
          "item",
          "share",
          "comment",
          "proof",
        ],
        rawDumpRows.map((row) => ({
          date: dateLabel(
            row.date,
          ),
          category:
            row.category || "—",
          item:
            row.item || "—",
          share:
            row.share ||
            "No survivor share recorded",
          comment:
            row.comment || "—",
          proof:
            row.proofUrl || null,
        })),
        [
          65,
          100,
          115,
          195,
          225,
          69,
        ],
      );
    }

    doc.end();
  });
}

export function buildWeeklyEmailReportPdf(report) {
  return runPdfInWorker("weekly", { report });
}