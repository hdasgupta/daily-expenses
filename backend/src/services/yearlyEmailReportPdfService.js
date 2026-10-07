import PDFDocument from "pdfkit";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function dateLabel(value) {
  const date = new Date(
    `${String(value).slice(0, 10)}T00:00:00Z`,
  );

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

function yearLabel(value) {
  const date = new Date(
    `${String(value).slice(0, 10)}T00:00:00Z`,
  );

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function pivot(rows, periods) {
  const survivors = [
    ...new Set(
      rows.map(
        (row) => row.survivor || "Unknown",
      ),
    ),
  ].sort();

  const map = new Map(
    periods.map((period) => [
      period,
      {
        period,
      },
    ]),
  );

  for (const row of rows) {
    const period = row.yearStart;

    if (!map.has(period)) {
      map.set(period, {
        period,
      });
    }

    map.get(period)[
      row.survivor || "Unknown"
    ] = Number(row.total || 0);
  }

  return {
    survivors,
    rows: [...map.values()],
  };
}

function drawYearlyBarChart(doc, data) {
  if (!data.length) {
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        "No yearly expense data available.",
      );

    doc.fillColor("black");
    return;
  }

  const width =
      doc.page.width -
      doc.page.margins.left -
      doc.page.margins.right,
    chartHeight = 170,
    startX = doc.page.margins.left + 35,
    baseline = doc.y + chartHeight,
    max = Math.max(
      ...data.map(
        (row) => Number(row.total) || 0,
      ),
      1,
    ),
    barWidth = Math.max(
      90,
      Math.min(
        160,
        (width - 40) /
          Math.max(data.length, 1) -
          25,
      ),
    );

  data.forEach((row, index) => {
    const barHeight =
        (Number(row.total) / max) *
        (chartHeight - 35),
      x =
        startX +
        index * (barWidth + 25),
      y = baseline - barHeight;

    doc
      .rect(
        x,
        y,
        barWidth,
        barHeight,
      )
      .fill();

    doc
      .fillColor("black")
      .fontSize(9)
      .text(
        yearLabel(row.yearStart),
        x - 10,
        baseline + 6,
        {
          width: barWidth + 20,
          align: "center",
        },
      );

    doc
      .fontSize(9)
      .text(
        money(row.total),
        x - 10,
        y - 15,
        {
          width: barWidth + 20,
          align: "center",
        },
      );
  });

  doc.y = baseline + 35;
}

function drawSurvivorChart(
  doc,
  rows,
  survivors,
) {
  if (
    !rows.length ||
    !survivors.length
  ) {
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        "No survivor share data available.",
      );

    doc.fillColor("black");
    return;
  }

  const width =
      doc.page.width -
      doc.page.margins.left -
      doc.page.margins.right,
    chartHeight = 175,
    startX = doc.page.margins.left + 45,
    baseline = doc.y + chartHeight,
    max = Math.max(
      ...rows.map((row) =>
        survivors.reduce(
          (sum, survivor) =>
            sum +
            Number(
              row[survivor] || 0,
            ),
          0,
        ),
      ),
      1,
    ),
    barWidth = Math.max(
      65,
      Math.min(
        140,
        (width - 30) /
          Math.max(rows.length, 1) -
          25,
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
    const x =
      startX +
      index * (barWidth + 25);

    let y = baseline;

    survivors.forEach(
      (survivor, survivorIndex) => {
        const value = Number(
          row[survivor] || 0,
        );

        const barHeight =
          (value / max) *
          (chartHeight - 45);

        if (barHeight > 0) {
          y -= barHeight;

          doc.save();

          doc
            .fillColor(
              palette[
                survivorIndex %
                  palette.length
              ],
            )
            .rect(
              x,
              y,
              barWidth,
              barHeight,
            )
            .fill();

          doc.restore();
        }
      },
    );

    doc
      .fillColor("black")
      .fontSize(9)
      .text(
        yearLabel(row.period),
        x - 10,
        baseline + 6,
        {
          width: barWidth + 20,
          align: "center",
        },
      );
  });

  let legendY = baseline + 28;
  let legendX = startX;

  survivors.forEach(
    (survivor, index) => {
      const legendWidth =
        Math.min(
          120,
          Math.max(
            50,
            doc.widthOfString(
              survivor,
              {
                fontSize: 7,
              },
            ) + 18,
          ),
        );

      if (
        legendX + legendWidth >
        doc.page.width -
          doc.page.margins.right
      ) {
        legendX = startX;
        legendY += 13;
      }

      doc.save();

      doc
        .fillColor(
          palette[
            index % palette.length
          ],
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
            width:
              legendWidth - 11,
          },
        );

      legendX += legendWidth;
    },
  );

  doc.y = legendY + 20;
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
        columns.length,
    );

  const drawRow = (
    values,
    header = false,
    index = 0,
  ) => {
    const rowHeight = header
      ? 25
      : 28;

    if (
      doc.y + rowHeight >
      doc.page.height -
        doc.page.margins.bottom
    ) {
      doc.addPage();
    }

    const y = doc.y;

    let x =
      doc.page.margins.left;

    columns.forEach(
      (column, columnIndex) => {
        const width =
          columnWidths[
            columnIndex
          ];

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
            rowHeight,
          )
          .fill();

        doc.restore();

        doc
          .strokeColor("#b8c7da")
          .rect(
            x,
            y,
            width,
            rowHeight,
          )
          .stroke();

        const value =
          values[column];

        const proof =
          !header &&
          column === "proof" &&
          value;

        doc
          .fillColor(
            header
              ? "#ffffff"
              : proof
                ? "#2563eb"
                : "#1f2937",
          )
          .fontSize(
            header ? 7 : 6,
          )
          .font(
            header
              ? "Helvetica-Bold"
              : "Helvetica",
          )
          .text(
            proof
              ? "Download Proof"
              : String(
                  value ?? "—",
                ),
            x + 3,
            y + 5,
            {
              width:
                width - 6,
              height:
                rowHeight - 7,
              ellipsis: true,
              link: proof
                ? String(value)
                : undefined,
              underline:
                Boolean(proof),
            },
          );

        x += width;
      },
    );

    doc.y =
      y + rowHeight;
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

  rows.forEach(
    (row, index) => {
      drawRow(
        row,
        false,
        index,
      );
    },
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

    const target =
      map.get(key);

    if (
      row.survivor &&
      row.survivor !== "—"
    ) {
      target.shares.push({
        name: row.survivor,
        amount: Number(
          row.price || 0,
        ),
      });
    }
  }

  return [...map.values()].map(
    (row) => {
      const total = Number(
        row.totalCost ||
          row.shares.reduce(
            (sum, share) =>
              sum +
              share.amount,
            0,
          ),
      );

      const share =
        row.shares.length
          ? row.shares
              .map((shareItem) => {
                const percentage =
                  total
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
    },
  );
}

export function buildYearlyEmailReportPdf(
  report,
) {
  return new Promise(
    (resolve, reject) => {
      const doc =
        new PDFDocument({
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
       * =====================================================
       * REPORT HEADER
       * =====================================================
       */

      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .text(
          "Rehabilitation Center Expense - 2 Year Yearly Report",
        );

      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#555")
        .text(
          `Generated: ${report.generatedAt}`,
        );

      doc
        .fillColor("black")
        .moveDown();

      /*
       * =====================================================
       * 1. TWO YEARS' YEARLY BAR CHART
       * =====================================================
       */

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(
          "1. Two-year yearly expense bar chart",
        );

      doc.moveDown(0.4);

      drawYearlyBarChart(
        doc,
        report.yearlySummary,
      );

      /*
       * =====================================================
       * 2. TWO YEARS' YEARLY SUMMARY TABLE
       * =====================================================
       */

      doc.moveDown();

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(
          "2. Two-year yearly summary table",
        );

      doc.moveDown(0.4);

      drawTable(
        doc,
        [
          "year",
          "total",
          "expense_count",
        ],
        report.yearlySummary.map(
          (row) => ({
            year: yearLabel(
              row.yearStart,
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
       * =====================================================
       * 3. TWO YEARS' SURVIVOR PIVOT BAR CHART
       * =====================================================
       */

      doc.addPage();

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(
          "3. Two-year yearly group-by-survivor summarized pivot bar chart",
        );

      doc.moveDown(0.4);

      const survivorPivot =
        pivot(
          report.survivorSummary,
          report.yearlySummary.map(
            (row) =>
              row.yearStart,
          ),
        );

      drawSurvivorChart(
        doc,
        survivorPivot.rows,
        survivorPivot.survivors,
      );

      /*
       * =====================================================
       * 4. TWO YEARS' SURVIVOR PIVOT DATA
       * =====================================================
       */

      doc.addPage();

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(
          "4. Two-year yearly group-by-survivor summarized pivot data",
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
            "No survivor share data available for the two completed years.",
          );

        doc.fillColor("black");
      } else {
        drawTable(
          doc,
          [
            "year",
            ...survivorPivot.survivors,
          ],
          survivorPivot.rows.map(
            (row) => ({
              year: yearLabel(
                row.period,
              ),
              ...Object.fromEntries(
                survivorPivot.survivors.map(
                  (survivor) => [
                    survivor,
                    money(
                      row[
                        survivor
                      ],
                    ),
                  ],
                ),
              ),
            }),
          ),
        );
      }

      /*
       * =====================================================
       * 5. TWO YEARS' RAW EXPENSE DATA DUMP
       * =====================================================
       */

      doc.addPage();

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(
          "5. Two-year raw expense data dump",
        );

      doc.moveDown(0.3);

      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#555")
        .text(
          "Each expense is shown as one understandable record. " +
            "The share column lists every survivor, " +
            "their share amount, and the percentage " +
            "of the expense total. " +
            "Proof links are clickable when a proof " +
            "document was uploaded.",
        );

      doc
        .fillColor("black")
        .moveDown(0.5);

      const rawDumpRows =
        uiShareDumpRows(
          report.dump,
        );

      if (!rawDumpRows.length) {
        doc
          .fontSize(9)
          .fillColor("#555")
          .text(
            "No expense records were found for the two completed years.",
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
          rawDumpRows.map(
            (row) => ({
              date: dateLabel(
                row.date,
              ),
              category:
                row.category ||
                "—",
              item:
                row.item ||
                "—",
              share:
                row.share ||
                "No survivor share recorded",
              comment:
                row.comment ||
                "—",
              proof:
                row.proofUrl ||
                null,
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
      }

      doc.end();
    },
  );
}
