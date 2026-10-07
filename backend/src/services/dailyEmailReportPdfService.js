import PDFDocument from "pdfkit";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function dateLabel(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function pivotSurvivorRows(rows, periodKey, periods = []) {
  const survivors = [
    ...new Set(
      rows.map((row) => row.survivor || "Unknown"),
    ),
  ].sort();

  const grouped = new Map(
    periods.map((period) => [
      period,
      { [periodKey]: period },
    ]),
  );

  for (const row of rows) {
    const key = row[periodKey];

    if (!grouped.has(key)) {
      grouped.set(key, { [periodKey]: key });
    }

    grouped.get(key)[row.survivor || "Unknown"] =
      Number(row.total || 0);
  }

  return {
    survivors,
    rows: [...grouped.values()],
  };
}

function drawBarChart(doc, data) {
  const width =
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right;

  const chartHeight = 170;
  const startX = doc.page.margins.left + 15;
  const baseline = doc.y + chartHeight;

  const max = Math.max(
    ...data.map((item) => Number(item.total) || 0),
    1,
  );

  const barWidth = Math.max(
    28,
    Math.min(
      58,
      (width - 30) / Math.max(data.length, 1) - 10,
    ),
  );

  if (!data.length) {
    doc.fontSize(10).text(
      "No expense data for this period.",
    );
    return;
  }

  data.forEach((item, index) => {
    const height =
      (Number(item.total) / max) *
      (chartHeight - 35);

    const x =
      startX + index * (barWidth + 10);

    const y = baseline - height;

    doc.rect(
      x,
      y,
      barWidth,
      height,
    ).fill();

    doc
      .fillColor("black")
      .fontSize(6.5)
      .text(
        dateLabel(item.date),
        x - 5,
        baseline + 5,
        {
          width: barWidth + 10,
          align: "center",
        },
      );

    doc
      .fontSize(7)
      .text(
        money(item.total),
        x - 8,
        y - 12,
        {
          width: barWidth + 16,
          align: "center",
        },
      );
  });

  doc.y = baseline + 28;
}

function drawSurvivorBarChart(
  doc,
  rows,
  periodKey,
  survivors,
  labelFormatter,
) {
  const width =
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right;

  const chartHeight = 175;
  const startX = doc.page.margins.left + 12;
  const baseline = doc.y + chartHeight;

  const max = Math.max(
    ...rows.map((row) =>
      survivors.reduce(
        (sum, survivor) =>
          sum + Number(row[survivor] || 0),
        0,
      ),
    ),
    1,
  );

  const barWidth = Math.max(
    18,
    Math.min(
      42,
      (width - 20) /
        Math.max(rows.length, 1) -
        8,
    ),
  );

  const palette = [
    "#315f9f",
    "#4f81bd",
    "#70ad47",
    "#ed7d31",
    "#a5a5a5",
    "#8064a2",
    "#ffc000",
    "#5b9bd5",
  ];

  if (!rows.length || !survivors.length) {
    doc.fontSize(10).text(
      "No survivor data for this period.",
    );
    return;
  }

  rows.forEach((row, index) => {
    const x =
      startX + index * (barWidth + 8);

    let y = baseline;

    for (let i = 0; i < survivors.length; i += 1) {
      const height =
        (Number(row[survivors[i]] || 0) /
          max) *
        (chartHeight - 45);

      if (height > 0) {
        y -= height;

        doc.save();

        doc
          .fillColor(
            palette[i % palette.length],
          )
          .rect(
            x,
            y,
            barWidth,
            height,
          )
          .fill();

        doc.restore();
      }
    }

    doc
      .fillColor("black")
      .fontSize(5.5)
      .text(
        labelFormatter(row[periodKey]),
        x - 5,
        baseline + 5,
        {
          width: barWidth + 10,
          align: "center",
        },
      );
  });

  const legendY = baseline + 25;
  let legendX = startX;

  survivors.forEach((survivor, i) => {
    const labelWidth = Math.min(
      100,
      Math.max(
        45,
        doc.widthOfString(
          survivor,
          { fontSize: 7 },
        ) + 16,
      ),
    );

    if (
      legendX + labelWidth >
      doc.page.width -
        doc.page.margins.right
    ) {
      legendX = startX;
    }

    doc.save();

    doc
      .fillColor(
        palette[i % palette.length],
      )
      .rect(
        legendX,
        legendY,
        8,
        8,
      )
      .fill();

    doc.restore();

    doc
      .fillColor("black")
      .fontSize(7)
      .text(
        survivor,
        legendX + 11,
        legendY - 1,
        {
          width: labelWidth - 11,
        },
      );

    legendX += labelWidth;
  });

  doc.y = legendY + 18;
}

function drawTable(
  doc,
  columns,
  rows,
  widths = null,
) {
  const usableWidth =
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right;

  const columnWidths =
    widths ||
    columns.map(
      () =>
        usableWidth /
        Math.max(columns.length, 1),
    );

  const drawRow = (
    values,
    header = false,
    index = 0,
  ) => {
    const height = header ? 25 : 28;

    if (
      doc.y + height >
      doc.page.height -
        doc.page.margins.bottom
    ) {
      doc.addPage();
    }

    const y = doc.y;
    let x = doc.page.margins.left;

    columns.forEach((column, i) => {
      const width = columnWidths[i];

      doc.save();

      doc
        .fillColor(
          header
            ? "#315f9f"
            : index % 2
              ? "#ffffff"
              : "#eef4fb",
        )
        .rect(
          x,
          y,
          width,
          height,
        )
        .fill();

      doc.restore();

      doc
        .strokeColor("#b8c7da")
        .rect(
          x,
          y,
          width,
          height,
        )
        .stroke();

      const proof =
        !header &&
        column === "proof" &&
        values[column];

      doc
        .fillColor(
          header
            ? "#ffffff"
            : proof
              ? "#2563eb"
              : "#1f2937",
        )
        .fontSize(header ? 7 : 6)
        .font(
          header
            ? "Helvetica-Bold"
            : "Helvetica",
        )
        .text(
          proof
            ? "Download Proof"
            : String(
                values[column] ?? "—",
              ),
          x + 3,
          y + 5,
          {
            width: width - 6,
            height: height - 7,
            ellipsis: true,
            link: proof
              ? String(values[column])
              : undefined,
            underline: Boolean(proof),
          },
        );

      x += width;
    });

    doc.y = y + height;
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

  rows.forEach((row, index) =>
    drawRow(row, false, index),
  );
}

function drawPivotTable(
  doc,
  rows,
  survivors,
) {
  const columns = [
    "date",
    ...survivors,
  ];

  const usableWidth =
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right;

  const firstColumnWidth = 75;

  drawTable(
    doc,
    columns,
    rows.map((row) => ({
      date: dateLabel(row.period),

      ...Object.fromEntries(
        survivors.map((survivor) => [
          survivor,
          money(row[survivor]),
        ]),
      ),
    })),
    [
      firstColumnWidth,
      ...survivors.map(
        () =>
          (usableWidth -
            firstColumnWidth) /
          Math.max(
            survivors.length,
            1,
          ),
      ),
    ],
  );
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

  return [...map.values()].map(
    (row) => {
      const total = Number(
        row.totalCost ||
          row.shares.reduce(
            (sum, item) =>
              sum + item.amount,
            0,
          ),
      );

      const share = row.shares.length
        ? row.shares
            .map(
              (item) =>
                `${item.name}: ₹${item.amount.toFixed(2)}${
                  total
                    ? ` (${(
                        (item.amount /
                          total) *
                        100
                      ).toFixed(2)}%)`
                    : ""
                }`,
            )
            .join(", ")
        : "No survivor share recorded";

      return {
        ...row,
        share,
      };
    },
  );
}

export function buildDailyEmailReportPdf(
  report,
) {
  return new Promise(
    (resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margin: 36,
        layout: "landscape",
      });

      const chunks = [];

      doc.on("data", (chunk) =>
        chunks.push(chunk),
      );

      doc.on("end", () =>
        resolve(
          Buffer.concat(chunks),
        ),
      );

      doc.on("error", reject);

      /*
       * ---------------------------------------------------------
       * COVER / REPORT INFORMATION
       * ---------------------------------------------------------
       */

      doc
        .fontSize(20)
        .text(
          "Rehabilitation Center Expense - 7 Day Daily Report",
        );

      doc
        .fontSize(9)
        .fillColor("#555")
        .text(
          `Generated: ${report.generatedAt}`,
        );

      doc
        .fillColor("black")
        .moveDown();

      /*
       * ---------------------------------------------------------
       * 1. SEVEN-DAY DAILY BAR CHART
       * ---------------------------------------------------------
       */

      doc
        .fontSize(14)
        .text(
          "1. Seven-day daily expense bar chart",
        );

      doc.moveDown(0.4);

      drawBarChart(
        doc,
        report.dailySummary,
      );

      /*
       * ---------------------------------------------------------
       * 2. SEVEN-DAY DAILY SUMMARY TABLE
       * ---------------------------------------------------------
       */

      doc.addPage();

      doc
        .fontSize(14)
        .text(
          "2. Seven-day daily summary table",
        );

      doc.moveDown(0.4);

      drawTable(
        doc,
        [
          "date",
          "total",
          "expense_count",
        ],
        report.dailySummary.map(
          (row) => ({
            date: dateLabel(
              row.date,
            ),
            total: money(
              row.total,
            ),
            expense_count:
              row.expenseCount,
          }),
        ),
      );

      /*
       * ---------------------------------------------------------
       * PREPARE SURVIVOR PIVOT DATA
       * ---------------------------------------------------------
       */

      const pivot =
        pivotSurvivorRows(
          report.survivorSummary.map(
            (row) => ({
              ...row,
              period: row.date,
            }),
          ),
          "period",
          report.dailySummary.map(
            (row) => row.date,
          ),
        );

      /*
       * ---------------------------------------------------------
       * 3. SEVEN-DAY SURVIVOR PIVOT BAR CHART
       * ---------------------------------------------------------
       */

      doc.addPage();

      doc
        .fontSize(14)
        .text(
          "3. Seven-day daily group-by-survivor summarized pivot bar chart",
        );

      doc.moveDown(0.4);

      drawSurvivorBarChart(
        doc,
        pivot.rows,
        "period",
        pivot.survivors,
        dateLabel,
      );

      /*
       * ---------------------------------------------------------
       * 4. SEVEN-DAY SURVIVOR PIVOT DATA
       * ---------------------------------------------------------
       */

      doc.addPage();

      doc
        .fontSize(14)
        .text(
          "4. Seven-day daily group-by-survivor summarized pivot data",
        );

      doc.moveDown(0.4);

      if (pivot.survivors.length) {
        drawPivotTable(
          doc,
          pivot.rows,
          pivot.survivors,
        );
      } else {
        doc
          .fontSize(10)
          .text(
            "No survivor share data for this period.",
          );
      }

      /*
       * ---------------------------------------------------------
       * 5. RAW DATA DUMP WITH SHARE + PROOF LINK
       * ---------------------------------------------------------
       */

      doc.addPage();

      doc
        .fontSize(14)
        .text(
          "5. Seven-day raw expense data dump",
        );

      doc
        .fontSize(8)
        .fillColor("#555")
        .text(
          "Each expense is grouped into one understandable row. Survivor shares include amount and percentage of the expense total. Proof links are clickable where proof was uploaded.",
        );

      doc
        .fillColor("black")
        .moveDown(0.4);

      const dumpRows =
        uiShareDumpRows(
          report.dump,
        );

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
        dumpRows.map(
          (row) => ({
            date: dateLabel(
              row.date,
            ),
            category:
              row.category,
            item: row.item,
            share: row.share,
            comment:
              row.comment,
            proof:
              row.proofUrl,
          }),
        ),
        [
          55,
          85,
          100,
          135,
          75,
          60,
        ],
      );

      doc.end();
    },
  );
}
