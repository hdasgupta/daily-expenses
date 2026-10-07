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

function monthLabel(start, end) {
  return `${dateLabel(start)} - ${dateLabel(end)}`;
}

function safeMonthLabel(start, end = null) {
  const startText = String(start ?? "").slice(0, 10);

  if (!startText) {
    return "Unknown month";
  }

  if (end) {
    return monthLabel(startText, end);
  }

  const date = new Date(`${startText}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return "Unknown month";
  }

  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);

  return monthLabel(startText, monthEnd);
}

function pivotSurvivorRows(rows, periodKey, periods = []) {
  const survivors = [...new Set(rows.map((row) => row.survivor || "Unknown"))].sort();

  const grouped = new Map(
    periods.map((period) => [
      period,
      {
        [periodKey]: period,
      },
    ]),
  );

  for (const row of rows) {
    const key = row[periodKey];

    if (!grouped.has(key)) {
      grouped.set(key, {
        [periodKey]: key,
      });
    }

    grouped.get(key)[row.survivor || "Unknown"] = Number(row.total || 0);
  }

  return {
    survivors,
    rows: [...grouped.values()],
  };
}

function drawMonthlyBarChart(doc, data) {
  if (!data.length) {
    doc.fontSize(9).fillColor("#555").text("No monthly expense data available.");

    doc.fillColor("black");
    return;
  }

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right,
    chartHeight = 170,
    startX = doc.page.margins.left + 20,
    baseline = doc.y + chartHeight,
    max = Math.max(...data.map((item) => Number(item.total) || 0), 1),
    barWidth = Math.max(55, Math.min(95, (width - 30) / Math.max(data.length, 1) - 18));

  data.forEach((item, index) => {
    const height = (Number(item.total) / max) * (chartHeight - 30),
      x = startX + index * (barWidth + 18),
      y = baseline - height;

    doc.rect(x, y, barWidth, height).fill();

    doc
      .fillColor("black")
      .fontSize(7)
      .text(monthLabel(item.monthStart, item.monthEnd), x - 10, baseline + 5, {
        width: barWidth + 20,
        align: "center",
      });

    doc.fontSize(8).text(money(item.total), x - 10, y - 13, {
      width: barWidth + 20,
      align: "center",
    });
  });

  doc.y = baseline + 35;
}

function drawSurvivorBarChart(doc, rows, survivors, labelFormatter) {
  if (!rows.length || !survivors.length) {
    doc.fontSize(9).fillColor("#555").text("No survivor share data available.");

    doc.fillColor("black");
    return;
  }

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right,
    chartHeight = 175,
    startX = doc.page.margins.left + 20,
    baseline = doc.y + chartHeight,
    totals = rows.map((row) =>
      survivors.reduce((sum, survivor) => sum + Number(row[survivor] || 0), 0),
    ),
    max = Math.max(...totals, 1),
    groupWidth = Math.max(35, (width - 20) / Math.max(rows.length, 1) - 12),
    barWidth = Math.max(15, Math.min(55, groupWidth)),
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
    const x = startX + index * (barWidth + 18);

    let y = baseline;

    survivors.forEach((survivor, survivorIndex) => {
      const value = Number(row[survivor] || 0);

      const height = (value / max) * (chartHeight - 45);

      if (height > 0) {
        y -= height;

        doc.save();

        doc
          .fillColor(palette[survivorIndex % palette.length])
          .rect(x, y, barWidth, height)
          .fill();

        doc.restore();
      }
    });

    doc
      .fillColor("black")
      .fontSize(6.5)
      .text(labelFormatter(row.period), x - 10, baseline + 5, {
        width: barWidth + 20,
        align: "center",
      });
  });

  let legendY = baseline + 28;
  let legendX = startX;

  survivors.forEach((survivor, index) => {
    const labelWidth = Math.min(
      110,
      Math.max(
        45,
        doc.widthOfString(survivor, {
          fontSize: 7,
        }) + 16,
      ),
    );

    if (legendX + labelWidth > doc.page.width - doc.page.margins.right) {
      legendX = startX;
      legendY += 13;
    }

    doc.save();

    doc
      .fillColor(palette[index % palette.length])
      .rect(legendX, legendY, 8, 8)
      .fill();

    doc.restore();

    doc
      .fillColor("black")
      .fontSize(7)
      .text(survivor, legendX + 11, legendY - 1, {
        width: labelWidth - 11,
      });

    legendX += labelWidth;
  });

  doc.y = legendY + 20;
}

function drawTable(doc, columns, rows, widths = null) {
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const columnWidths = widths || columns.map(() => usableWidth / columns.length);

  const headerHeight = 25;
  const rowHeight = 28;

  const drawRow = (values, header = false, index = 0) => {
    const height = header ? headerHeight : rowHeight;

    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }

    const y = doc.y;
    let x = doc.page.margins.left;

    columns.forEach((column, columnIndex) => {
      const width = columnWidths[columnIndex];

      doc.save();

      doc
        .fillColor(header ? "#315f9f" : index % 2 ? "#ffffff" : "#eef4fb")
        .rect(x, y, width, height)
        .fill();

      doc.restore();

      doc.strokeColor("#b8c7da").rect(x, y, width, height).stroke();

      const value = values[column];

      const isProofLink = !header && column === "proof" && value;

      doc
        .fillColor(header ? "#ffffff" : isProofLink ? "#2563eb" : "#1f2937")
        .fontSize(header ? 7 : 6)
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .text(isProofLink ? "Download Proof" : String(value ?? "—"), x + 3, y + 5, {
          width: width - 6,
          height: height - 7,
          ellipsis: true,
          link: isProofLink ? String(value) : undefined,
          underline: Boolean(isProofLink),
        });

      x += width;
    });

    doc.y = y + height;
  };

  drawRow(
    Object.fromEntries(columns.map((column) => [column, column.replace(/_/g, " ").toUpperCase()])),
    true,
  );

  rows.forEach((row, index) => {
    drawRow(row, false, index);
  });
}

function drawPivotTable(doc, rows, survivors) {
  const columns = ["month", ...survivors];

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const firstWidth = 115;

  const survivorWidth = (usableWidth - firstWidth) / Math.max(survivors.length, 1);

  const widths = [firstWidth, ...survivors.map(() => survivorWidth)];

  drawTable(
    doc,
    columns,
    rows.map((row) => {
      const result = {
        month: row.month,
      };

      survivors.forEach((survivor) => {
        result[survivor] = money(row[survivor]);
      });

      return result;
    }),
    widths,
  );
}

function uiShareDumpRows(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = row.expenseId ?? `${row.date}|${row.category}|${row.item}|${row.comment}`;

    if (!map.has(key)) {
      map.set(key, {
        ...row,
        shares: [],
      });
    }

    const target = map.get(key);

    if (row.survivor && row.survivor !== "—") {
      target.shares.push({
        name: row.survivor,
        amount: Number(row.price || 0),
      });
    }
  }

  return [...map.values()].map((row) => {
    const total = Number(row.totalCost || row.shares.reduce((sum, item) => sum + item.amount, 0));

    const share = row.shares.length
      ? row.shares
          .map((item) => {
            const percentage = total ? ((item.amount / total) * 100).toFixed(2) : "0.00";

            return `${item.name}: ${money(item.amount)} (${percentage}%)`;
          })
          .join(", ")
      : "No survivor share recorded";

    return {
      ...row,
      share,
    };
  });
}

export function buildMonthlyEmailReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 36,
      layout: "landscape",
    });

    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));

    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.on("error", reject);

    /*
     * =====================================================
     * REPORT HEADER
     * =====================================================
     */

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("Rehabilitation Center Expense - 3 Month Monthly Report");

    doc.fontSize(9).font("Helvetica").fillColor("#555").text(`Generated: ${report.generatedAt}`);

    doc.fillColor("black").moveDown();

    /*
     * =====================================================
     * 1. THREE MONTHS' MONTHLY BAR CHART
     * =====================================================
     */

    doc.fontSize(14).font("Helvetica-Bold").text("1. Three-month monthly expense bar chart");

    doc.moveDown(0.4);

    drawMonthlyBarChart(doc, report.monthlySummary);

    /*
     * =====================================================
     * 2. THREE MONTHS' MONTHLY SUMMARY TABLE
     * =====================================================
     */

    doc.moveDown();

    doc.fontSize(14).font("Helvetica-Bold").text("2. Three-month monthly summary table");

    doc.moveDown(0.4);

    drawTable(
      doc,
      ["month", "total", "expense_count"],
      report.monthlySummary.map((row) => ({
        month: monthLabel(row.monthStart, row.monthEnd),
        total: money(row.total),
        expense_count: row.expenseCount,
      })),
    );

    /*
     * =====================================================
     * 3. THREE MONTHS' SURVIVOR PIVOT BAR CHART
     * =====================================================
     */

    doc.addPage();

    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("3. Three-month monthly group-by-survivor summarized pivot bar chart");

    doc.moveDown(0.4);

    const monthlyPivot = pivotSurvivorRows(
      report.survivorSummary.map((row) => ({
        ...row,
        period: row.monthStart,
      })),
      "period",
      report.monthlySummary.map((row) => row.monthStart),
    );

    const monthlyLabels = new Map(
      report.monthlySummary.map((row) => [
        row.monthStart,
        monthLabel(row.monthStart, row.monthEnd),
      ]),
    );

    drawSurvivorBarChart(
      doc,
      monthlyPivot.rows,
      monthlyPivot.survivors,
      (period) => monthlyLabels.get(period) || safeMonthLabel(period),
    );

    /*
     * =====================================================
     * 4. THREE MONTHS' SURVIVOR PIVOT DATA
     * =====================================================
     */

    doc.addPage();

    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("4. Three-month monthly group-by-survivor summarized pivot data");

    doc.moveDown(0.4);

    if (!monthlyPivot.rows.length || !monthlyPivot.survivors.length) {
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#555")
        .text("No survivor share data available for the three completed months.");

      doc.fillColor("black");
    } else {
      drawPivotTable(
        doc,
        monthlyPivot.rows.map((row) => ({
          ...row,
          month: monthlyLabels.get(row.period) || safeMonthLabel(row.period),
        })),
        monthlyPivot.survivors,
      );
    }

    /*
     * =====================================================
     * 5. THREE MONTHS' RAW EXPENSE DATA DUMP
     * =====================================================
     */

    doc.addPage();

    doc.fontSize(14).font("Helvetica-Bold").text("5. Three-month raw expense data dump");

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
      );

    doc.fillColor("black").moveDown(0.5);

    const rawDumpRows = uiShareDumpRows(report.dump);

    if (!rawDumpRows.length) {
      doc
        .fontSize(9)
        .fillColor("#555")
        .text("No expense records were found for the three completed months.");

      doc.fillColor("black");
    } else {
      drawTable(
        doc,
        ["date", "category", "item", "share", "comment", "proof"],
        rawDumpRows.map((row) => ({
          date: dateLabel(row.date),
          category: row.category || "—",
          item: row.item || "—",
          share: row.share || "No survivor share recorded",
          comment: row.comment || "—",
          proof: row.proofUrl || null,
        })),
        [55, 90, 100, 125, 75, 55],
      );
    }

    doc.end();
  });
}
