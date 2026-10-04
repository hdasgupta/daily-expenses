import PDFDocument from "pdfkit";
import { env } from "../config/env.js";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);

  if (Number.isNaN(date.getTime())) return String(value);

  return `${String(date.getDate()).padStart(2, "0")}, ${date.toLocaleString("en-IN", {
    month: "short",
  })}, ${String(date.getFullYear()).slice(-2)}`;
}

function formatCell(value, column) {
  if (value === null || value === undefined || value === "") return "—";

  if (["total", "total_cost", "report_amount", "share_price"].includes(column)) {
    return money(value);
  }

  if (column === "expense_date") return formatDate(value);

  return String(value);
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function buildUiShareRows(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const key =
      row.expense_id ??
      `${row.expense_date}|${row.category}|${row.item}|${row.comment}|${row.proof_key}`;

    if (!map.has(key)) {
      map.set(key, {
        ...row,
        survivorShares: [],
      });
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

    if (!target.proof_url && row.proof_url) {
      target.proof_url = row.proof_url;
    }
  }

  return [...map.values()].map((row) => {
    const shares = row.survivorShares;
    const total = Number(
      row.total_cost || shares.reduce((sum, item) => sum + item.amount, 0),
    );

    const share = shares.length
      ? shares
          .map((item) => {
            const percentage = total
              ? ` (${((item.amount / total) * 100).toFixed(2)}%)`
              : "";

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

  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .fillColor("#000000")
    .text(title);

  if (subtitle) {
    doc.moveDown(0.15);

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#555555")
      .text(subtitle);
  }

  doc.moveDown(0.45);
}

function drawGroupIdentity(doc, groupBy, group) {
  ensureSpace(doc, 46);

  const x = doc.page.margins.left;
  const width =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
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
    const value =
      group[column] === null ||
      group[column] === undefined ||
      group[column] === ""
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

function drawTable(doc, columns, rows, widths = null, options = {}) {
  if (!columns.length) return;

  const usableWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;

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

      doc
        .fillColor(header ? "#315f9f" : index % 2 ? "#ffffff" : "#eef4fb")
        .rect(x, y, width, height)
        .fill();

      doc.restore();

      doc
        .strokeColor("#b8c7da")
        .rect(x, y, width, height)
        .stroke();

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
        drawCell(
          doc,
          values[column],
          column,
          x,
          y,
          width,
          height,
          "#1f2937",
          options.fontSize || 6,
        );
      }

      x += width;
    });

    doc.y = y + height;
  };

  drawRow(
    Object.fromEntries(
      columns.map((column) => [
        column,
        column.replace(/_/g, " ").toUpperCase(),
      ]),
    ),
    true,
  );

  rows.forEach((item, index) => drawRow(item, false, index));
}

function groupRows(rows, groupBy) {
  const groups = new Map();

  for (const row of rows || []) {
    const key = groupBy
      .map((column) => String(row[column] ?? "—"))
      .join("\u0001");

    if (!groups.has(key)) {
      groups.set(key, {
        values: Object.fromEntries(
          groupBy.map((column) => [column, row[column]]),
        ),
        rows: [],
      });
    }

    groups.get(key).rows.push(row);
  }

  return [...groups.values()];
}

function valueForSort(row, column) {
  if (column === "date") return String(row.expense_date || "");

  if (column === "price") {
    return Number(row.total_cost ?? row.report_amount ?? row.share_price ?? 0);
  }

  return String(row[column] ?? "").toLowerCase();
}

function sortRows(rows, config = {}) {
  const sortColumns = Array.isArray(config.sortColumns)
    ? config.sortColumns
    : [];

  const groupBy = Array.isArray(config.groupBy) ? config.groupBy : [];

  const active = [
    ...sortColumns,
    ...groupBy
      .filter(
        (column) => !sortColumns.some((sort) => sort.column === column),
      )
      .map((column) => ({
        column,
        direction: "asc",
      })),
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

function mergeRowsForRawDump(rows) {
  if (
    rows.some((row) =>
      Object.prototype.hasOwnProperty.call(row, "share_price"),
    )
  ) {
    return buildUiShareRows(rows);
  }

  return [...rows];
}

function getRawDumpColumns(rows) {
  const first = rows[0] || {};

  const preferred = [
    "expense_date",
    "category",
    "item",
    "survivor",
    "share",
    "total_cost",
    "comment",
    "proof_url",
  ];

  const excluded = new Set([
    "survivorShares",
    "proof_key",
    "report_amount",
    "id",
    "expense_id",
  ]);

  const columns = preferred.filter((column) =>
    Object.prototype.hasOwnProperty.call(first, column),
  );

  const extras = Object.keys(first).filter(
    (column) => !columns.includes(column) && !excluded.has(column),
  );

  return [...columns, ...extras];
}

function drawGroupedRaw(doc, rows, groupBy, config, subtitle) {
  const sourceRows = sortRows(rows, config);
  const shareRows = mergeRowsForRawDump(sourceRows);
  const groups = groupRows(shareRows, groupBy);

  drawSectionTitle(
    doc,
    "Group-by detail tables",
    subtitle ||
      "Each table corresponds directly to a group represented in the summary table above.",
  );

  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) doc.moveDown(0.8);

    drawGroupIdentity(doc, groupBy, group.values);

    drawTable(doc, getRawDumpColumns(group.rows), group.rows, null, {
      rowHeight: 30,
      fontSize: 5.8,
    });
  });

  if (!groups.length) {
    doc
      .fontSize(10)
      .font("Helvetica")
      .text("No records match the selected filters.");
  }
}

function dimensionCardinality(rows, column) {
  return new Set(rows.map((row) => String(row[column] ?? "—"))).size;
}

function estimatePivotShape(rows, rowGroups, columnGroups) {
  const rowCardinality = rowGroups.reduce(
    (product, column) =>
      product * Math.max(dimensionCardinality(rows, column), 1),
    1,
  );

  const columnCardinality = columnGroups.reduce(
    (product, column) =>
      product * Math.max(dimensionCardinality(rows, column), 1),
    1,
  );

  return {
    rowCardinality,
    columnCardinality,
    widthPressure: columnCardinality * Math.max(columnGroups.length, 1),
  };
}

function getPivotDimensions(rows, groupBy) {
  if (groupBy.length <= 1) {
    return {
      rowGroups: [...groupBy],
      columnGroups: [],
    };
  }

  if (groupBy.length === 2) {
    return {
      rowGroups: [groupBy[0]],
      columnGroups: [groupBy[1]],
    };
  }

  if (groupBy.length === 3) {
    return {
      rowGroups: [groupBy[0]],
      columnGroups: [groupBy[1], groupBy[2]],
    };
  }

  const candidates = [];

  for (let rowCount = 1; rowCount < groupBy.length; rowCount += 1) {
    const rowSets = [];

    function buildSets(start, picked) {
      if (picked.length === rowCount) {
        rowSets.push([...picked]);
        return;
      }

      for (let index = start; index < groupBy.length; index += 1) {
        picked.push(index);
        buildSets(index + 1, picked);
        picked.pop();
      }
    }

    buildSets(0, []);

    for (const rowIndexes of rowSets) {
      const rowSet = new Set(rowIndexes);

      const rowColumns = groupBy.filter((_, index) => rowSet.has(index));
      const columnColumns = groupBy.filter((_, index) => !rowSet.has(index));

      const shape = estimatePivotShape(rows, rowColumns, columnColumns);

      if (shape.columnCardinality > 60) continue;

      const squarePenalty = Math.abs(
        Math.log2(Math.max(shape.rowCardinality, 1)) -
          Math.log2(Math.max(shape.columnCardinality, 1)),
      );

      const score =
        Math.abs(rowCount - groupBy.length / 2) * 2 +
        shape.widthPressure / 10 +
        squarePenalty +
        Math.max(shape.rowCardinality - 250, 0) / 50;

      candidates.push({
        rowColumns,
        columnColumns,
        score,
        rowCardinality: shape.rowCardinality,
        columnCardinality: shape.columnCardinality,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;

    if (a.columnCardinality !== b.columnCardinality) {
      return a.columnCardinality - b.columnCardinality;
    }

    return a.rowColumns.length - b.rowColumns.length;
  });

  const best = candidates[0];

  if (!best) {
    const split = Math.ceil(groupBy.length / 2);

    return {
      rowGroups: groupBy.slice(0, split),
      columnGroups: groupBy.slice(split),
    };
  }

  return {
    rowGroups: best.rowColumns,
    columnGroups: best.columnColumns,
  };
}

function getPivotLeafColumns(rows, columnGroups) {
  const leaves = new Map();

  for (const row of rows) {
    const values = columnGroups.map((column) => row[column]);

    const key = values
      .map((value) => String(value ?? "—"))
      .join("\u0001");

    if (!leaves.has(key)) {
      leaves.set(key, values);
    }
  }

  return [...leaves.entries()].map(([key, values]) => ({
    key,
    values,
  }));
}

function getPivotRows(rows, rowGroups) {
  const result = new Map();

  for (const row of rows) {
    const values = rowGroups.map((column) => row[column]);

    const key = values
      .map((value) => String(value ?? "—"))
      .join("\u0001");

    if (!result.has(key)) {
      result.set(key, values);
    }
  }

  return [...result.entries()].map(([key, values]) => ({
    key,
    values,
  }));
}

function pivotTotalMap(rows, rowGroups, columnGroups) {
  const totals = new Map();

  for (const row of rows) {
    const rowKey = rowGroups
      .map((column) => String(row[column] ?? "—"))
      .join("\u0001");

    const columnKey = columnGroups
      .map((column) => String(row[column] ?? "—"))
      .join("\u0001");

    const key = `${rowKey}\u0002${columnKey}`;

    totals.set(
      key,
      (totals.get(key) || 0) + Number(row.total || 0),
    );
  }

  return totals;
}

function drawMergedHeaderCell(
  doc,
  x,
  y,
  width,
  height,
  value,
  level = 0,
  options = {},
) {
  doc.save();

  doc
    .fillColor(level % 2 ? "#406fae" : "#315f9f")
    .rect(x, y, width, height)
    .fill();

  doc.restore();

  doc
    .strokeColor("#b8c7da")
    .rect(x, y, width, height)
    .stroke();

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(options.fontSize || 6.2)
    .text(displayValue(value), x + 3, y + height / 2 - 4, {
      width: width - 6,
      height: Math.max(height - 4, 8),
      align: "center",
      ellipsis: true,
    });
}

function buildHeaderGroups(leaves, level) {
  const groups = [];

  let start = 0;

  while (start < leaves.length) {
    const value = displayValue(leaves[start].values[level]);
    let end = start + 1;

    while (
      end < leaves.length &&
      displayValue(leaves[end].values[level]) === value
    ) {
      end += 1;
    }

    groups.push({
      start,
      span: end - start,
      value,
    });

    start = end;
  }

  return groups;
}

function sortPivotLeaves(leaves, columnGroups, sortColumns) {
  const sorts = Array.isArray(sortColumns) ? sortColumns : [];

  return [...leaves].sort((a, b) => {
    for (const sort of sorts) {
      const index = columnGroups.indexOf(sort.column);

      if (index < 0) continue;

      const left = String(a.values[index] ?? "—").toLowerCase();
      const right = String(b.values[index] ?? "—").toLowerCase();
      const direction = sort.direction === "desc" ? -1 : 1;

      if (left < right) return -1 * direction;
      if (left > right) return 1 * direction;
    }

    for (let index = 0; index < a.values.length; index += 1) {
      const left = String(a.values[index] ?? "—").toLowerCase();
      const right = String(b.values[index] ?? "—").toLowerCase();

      if (left < right) return -1;
      if (left > right) return 1;
    }

    return 0;
  });
}

function drawPivotSummary(doc, report, config) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];

  if (!rows.length) {
    drawSectionTitle(doc, "Pivot grouped summary table");

    doc
      .fontSize(10)
      .font("Helvetica")
      .text("No records match the selected filters.");

    return;
  }

  const { rowGroups, columnGroups } = getPivotDimensions(rows, groupBy);

  if (!columnGroups.length) {
    const sortedRows = sortRows(rows, {
      sortColumns: Array.isArray(config?.sortColumns)
        ? config.sortColumns
        : [],
      groupBy: rowGroups,
    });

    const ordered = groupRows(sortedRows, rowGroups).map((group) => ({
      group_value: group.values[rowGroups[0]],
      total: group.rows.reduce(
        (sum, row) => sum + Number(row.total || 0),
        0,
      ),
    }));

    drawSectionTitle(
      doc,
      "Pivot grouped summary table",
      `Group by: ${rowGroups[0] || "expense"}. One row is shown per group.`,
    );

    drawTable(
      doc,
      ["group_value", "total"],
      ordered,
      [usableWidthFor(doc) * 0.72, usableWidthFor(doc) * 0.28],
      {
        rowHeight: 30,
      },
    );

    return;
  }

  drawSectionTitle(
    doc,
    "Pivot grouped summary table",
    `Row-wise: ${rowGroups.join(" • ")} | Column-wise: ${columnGroups.join(" • ")}`,
  );

  const leafColumns = getPivotLeafColumns(rows, columnGroups);
  const pivotRows = getPivotRows(rows, rowGroups);
  const totals = pivotTotalMap(rows, rowGroups, columnGroups);

  if (!leafColumns.length || !pivotRows.length) {
    doc
      .fontSize(10)
      .font("Helvetica")
      .text("No records match the selected filters.");

    return;
  }

  const sortedPivotRows = [...pivotRows].sort((a, b) => {
    const sorts = Array.isArray(config?.sortColumns)
      ? config.sortColumns
      : [];

    for (const sort of sorts) {
      const rowIndex = rowGroups.indexOf(sort.column);

      if (rowIndex < 0) continue;

      const left = String(a.values[rowIndex] ?? "—").toLowerCase();
      const right = String(b.values[rowIndex] ?? "—").toLowerCase();
      const direction = sort.direction === "desc" ? -1 : 1;

      if (left < right) return -1 * direction;
      if (left > right) return 1 * direction;
    }

    for (let index = 0; index < a.values.length; index += 1) {
      const left = String(a.values[index] ?? "—").toLowerCase();
      const right = String(b.values[index] ?? "—").toLowerCase();

      if (left < right) return -1;
      if (left > right) return 1;
    }

    return 0;
  });

  const sortedLeaves = sortPivotLeaves(
    leafColumns,
    columnGroups,
    config?.sortColumns || [],
  );

  const usableWidth = usableWidthFor(doc);
  const rowWidth = Math.min(
    190,
    Math.max(150, usableWidth * 0.26),
  );
  const totalWidth = Math.min(82, usableWidth * 0.12);
  const columnArea = usableWidth - rowWidth - totalWidth;
  const leafWidth = columnArea / Math.max(sortedLeaves.length, 1);
  const headerHeight = 22;
  const headerLevels = Math.max(columnGroups.length, 1);

  ensureSpace(doc, 60 + headerLevels * headerHeight);

  const x0 = doc.page.margins.left;
  const headerY = doc.y;
  const rowHeaderWidth = rowWidth / Math.max(rowGroups.length, 1);

  rowGroups.forEach((column, index) => {
    drawMergedHeaderCell(
      doc,
      x0 + index * rowHeaderWidth,
      headerY,
      rowHeaderWidth,
      headerLevels * headerHeight,
      column.replace(/_/g, " ").toUpperCase(),
      0,
      {
        fontSize: 6,
      },
    );
  });

  const columnStartX = x0 + rowWidth;

  columnGroups.forEach((column, level) => {
    const headers = buildHeaderGroups(sortedLeaves, level);

    headers.forEach((header) => {
      drawMergedHeaderCell(
        doc,
        columnStartX + header.start * leafWidth,
        headerY + level * headerHeight,
        header.span * leafWidth,
        headerHeight,
        header.value,
        level,
      );
    });
  });

  drawMergedHeaderCell(
    doc,
    columnStartX + sortedLeaves.length * leafWidth,
    headerY,
    totalWidth,
    headerLevels * headerHeight,
    "GROUP TOTAL",
    0,
    {
      fontSize: 5.8,
    },
  );

  doc.y = headerY + headerLevels * headerHeight;

  for (const pivotRow of sortedPivotRows) {
    ensureSpace(doc, 30);

    const y = doc.y;
    let x = x0;
    let rowTotal = 0;

    rowGroups.forEach((column, index) => {
      doc.save();
      doc.fillColor("#eef4fb").rect(x, y, rowHeaderWidth, 30).fill();
      doc.restore();

      doc
        .strokeColor("#b8c7da")
        .rect(x, y, rowHeaderWidth, 30)
        .stroke();

      doc
        .fillColor("#1f2937")
        .font("Helvetica-Bold")
        .fontSize(6.2)
        .text(formatCell(pivotRow.values[index], column), x + 3, y + 9, {
          width: rowHeaderWidth - 6,
          align: "center",
          ellipsis: true,
        });

      x += rowHeaderWidth;
    });

    for (const leaf of sortedLeaves) {
      const value =
        totals.get(`${pivotRow.key}\u0002${leaf.key}`) || 0;

      rowTotal += value;

      doc.save();
      doc.fillColor("#f8fbff").rect(x, y, leafWidth, 30).fill();
      doc.restore();

      doc
        .strokeColor("#b8c7da")
        .rect(x, y, leafWidth, 30)
        .stroke();

      doc
        .fillColor("#1f2937")
        .font("Helvetica")
        .fontSize(5.8)
        .text(value ? money(value) : "—", x + 2, y + 9, {
          width: leafWidth - 4,
          align: "right",
          ellipsis: true,
        });

      x += leafWidth;
    }

    doc.save();
    doc.fillColor("#f5f8fc").rect(x, y, totalWidth, 30).fill();
    doc.restore();

    doc
      .strokeColor("#b8c7da")
      .rect(x, y, totalWidth, 30)
      .stroke();

    doc
      .fillColor("#1f2937")
      .font("Helvetica-Bold")
      .fontSize(5.9)
      .text(money(rowTotal), x + 3, y + 9, {
        width: totalWidth - 6,
        align: "right",
      });

    doc.y = y + 30;
  }

  doc.moveDown(0.35);

  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor("#555555")
    .text(
      `Pivot layout: ${rowGroups.join(" • ")} kept row-wise and ${columnGroups.join(
        " • ",
      )} kept column-wise. Repeated column-group values are merged in the multi-level heading.`,
    );
}

function drawGroupedBarChart(doc, report, config) {
  const groupBy = Array.isArray(report.groupBy) ? report.groupBy : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];

  if (!rows.length) return;

  const dimensions = getPivotDimensions(rows, groupBy);
  const usableWidth = usableWidthFor(doc);
  const x = doc.page.margins.left;
  const chartHeight = 210;
  const chartInnerHeight = 145;

  ensureSpace(doc, chartHeight + 35);

  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .fillColor("#000000")
    .text("Pivot grouped bar chart");

  if (!dimensions.columnGroups.length) {
    const sorted = sortRows(rows, config).slice(0, 24);

    const slot = usableWidth / Math.max(sorted.length, 1);
    const barWidth = Math.max(8, Math.min(28, slot * 0.62));

    const max = Math.max(
      ...sorted.map((row) => Number(row.total || 0)),
      1,
    );

    const baseline = doc.y + 22 + chartInnerHeight;

    doc
      .strokeColor("#9aa8b8")
      .moveTo(x, baseline)
      .lineTo(x + usableWidth, baseline)
      .stroke();

    sorted.forEach((row, index) => {
      const value = Number(row.total || 0);
      const barHeight = (value / max) * (chartInnerHeight - 20);
      const bx = x + index * slot + (slot - barWidth) / 2;
      const by = baseline - barHeight;

      doc.save();
      doc
        .fillColor("#315f9f")
        .rect(bx, by, barWidth, barHeight)
        .fill();
      doc.restore();

      if (barHeight > 14) {
        doc
          .fillColor("#1f2937")
          .font("Helvetica-Bold")
          .fontSize(5.4)
          .text(money(value), bx - 8, by - 9, {
            width: barWidth + 16,
            align: "center",
            ellipsis: true,
          });
      }

      const label = dimensions.rowGroups
        .map((column) => displayValue(row[column]))
        .join(" • ");

      doc
        .font("Helvetica")
        .fontSize(5.3)
        .fillColor("#1f2937")
        .text(label || "Total", bx - 14, baseline + 4, {
          width: barWidth + 28,
          height: 25,
          align: "center",
          ellipsis: true,
        });
    });

    doc.y = baseline + 32;
    return;
  }

  const rowGroups = dimensions.rowGroups;
  const columnGroups = dimensions.columnGroups;

  const pivotRows = getPivotRows(rows, rowGroups);

  const leafColumns = sortPivotLeaves(
    getPivotLeafColumns(rows, columnGroups),
    columnGroups,
    config?.sortColumns || [],
  );

  const totals = pivotTotalMap(rows, rowGroups, columnGroups);

  const limitedRows = pivotRows.slice(0, 16);
  const limitedSeries = leafColumns.slice(0, 10);

  const max = Math.max(...[...totals.values()].map(Number), 1);
  const slot = usableWidth / Math.max(limitedRows.length, 1);
  const gap = 2;

  const palette = [
    "#315f9f",
    "#d97706",
    "#059669",
    "#7c3aed",
    "#dc2626",
    "#0891b2",
    "#be185d",
    "#65a30d",
    "#475569",
    "#92400e",
  ];

  const seriesWidth = Math.max(
    5,
    Math.min(
      18,
      (slot - 8) / Math.max(limitedSeries.length, 1),
    ),
  );

  const baseline = doc.y + 22 + chartInnerHeight;

  doc
    .strokeColor("#9aa8b8")
    .moveTo(x, baseline)
    .lineTo(x + usableWidth, baseline)
    .stroke();

  limitedRows.forEach((pivotRow, rowIndex) => {
    limitedSeries.forEach((leaf, seriesIndex) => {
      const value =
        totals.get(`${pivotRow.key}\u0002${leaf.key}`) || 0;

      const barHeight =
        (Number(value) / max) * (chartInnerHeight - 24);

      const bx =
        x +
        rowIndex * slot +
        4 +
        seriesIndex * (seriesWidth + gap);

      const by = baseline - barHeight;

      doc.save();

      doc
        .fillColor(palette[seriesIndex % palette.length])
        .rect(bx, by, seriesWidth, barHeight)
        .fill();

      doc.restore();

      if (barHeight > 18) {
        doc
          .fillColor("#1f2937")
          .font("Helvetica")
          .fontSize(4.4)
          .text(money(value), bx - 5, by - 8, {
            width: seriesWidth + 10,
            align: "center",
            ellipsis: true,
          });
      }
    });

    doc
      .fillColor("#1f2937")
      .font("Helvetica")
      .fontSize(5)
      .text(
        pivotRow.values.map(displayValue).join(" • "),
        x + rowIndex * slot,
        baseline + 4,
        {
          width: slot - 2,
          height: 28,
          align: "center",
          ellipsis: true,
        },
      );
  });

  const legendY = baseline + 34;

  limitedSeries.forEach((leaf, index) => {
    const legendX =
      x +
      index *
        Math.min(
          115,
          usableWidth / Math.max(limitedSeries.length, 1),
        );

    doc.save();

    doc
      .fillColor(palette[index % palette.length])
      .rect(legendX, legendY, 8, 8)
      .fill();

    doc.restore();

    doc
      .fillColor("#1f2937")
      .font("Helvetica")
      .fontSize(5.5)
      .text(
        leaf.values.map(displayValue).join(" • "),
        legendX + 11,
        legendY - 1,
        {
          width: 100,
          ellipsis: true,
        },
      );
  });

  doc.y = legendY + 14;
}

function usableWidthFor(doc) {
  return (
    doc.page.width -
    doc.page.margins.left -
    doc.page.margins.right
  );
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
    doc
      .fontSize(10)
      .font("Helvetica")
      .text("No records match the selected filters.");

    return;
  }

  const dumpRows = mergeRowsForRawDump(sourceRows);
  const columns = getRawDumpColumns(dumpRows);

  drawTable(doc, columns, dumpRows, null, {
    rowHeight: 30,
    fontSize: 5.8,
  });
}

function drawSummaryTotal(doc, report) {
  drawSectionTitle(doc, "Summary total");

  drawTable(
    doc,
    ["total"],
    [{ total: report.total }],
    null,
    {
      rowHeight: 32,
    },
  );
}

function drawReportFilters(doc, config) {
  const groupBy = Array.isArray(config.groupBy)
    ? config.groupBy
    : [];

  const sortColumns = Array.isArray(config.sortColumns)
    ? config.sortColumns
    : [];

  const summarise = Boolean(config.summarise);

  if (groupBy.length) {
    doc.fontSize(9).text(`Group by: ${groupBy.join(", ")}`);
  }

  if (sortColumns.length) {
    doc
      .fontSize(9)
      .text(
        `Sort: ${sortColumns
          .map((item) => `${item.column} ${item.direction}`)
          .join(", ")}`,
      );
  }

  doc
    .fontSize(9)
    .text(`Summarise: ${summarise ? "Yes" : "No"}`)
    .moveDown(0.7);
}

export function buildReportPdf(report, config = {}) {
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

    doc
      .fontSize(15)
      .font("Helvetica-Bold")
      .fillColor("#1f2937")
      .text(
        env.organizationName ||
          "West Bengal Forum for Mental Health",
        { align: "center" },
      );

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .fillColor("#000000")
      .text("Rehabilitation Center Expense Report", {
        align: "center",
      });

    doc
      .fontSize(9)
      .fillColor("#555555")
      .text(
        `Generated: ${new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "medium",
        }).format(new Date())}`,
      );

    doc.fillColor("black").moveDown();

    drawReportFilters(doc, config);

    const groupBy = Array.isArray(config.groupBy)
      ? config.groupBy
      : [];

    const summarise = Boolean(config.summarise);

    const sourceRows = report.rawRows || report.rows || [];

    /*
     * Requested PDF matrix:
     *
     * 1. Summarise + Group By:
     *    - pivot grouped bar chart
     *    - pivot grouped summary table
     *    - group-by table for every group
     *    - filtered raw dump with share/proof information
     *
     * 2. Group By only:
     *    - group-by table for every group
     *    - filtered raw dump
     *
     * 3. Neither:
     *    - filtered raw dump only
     */
    if (summarise && groupBy.length) {
      drawGroupedBarChart(doc, report, config);
      doc.moveDown(0.5);

      drawPivotSummary(doc, report, config);
      doc.moveDown(0.8);

      drawGroupedRaw(
        doc,
        sourceRows,
        groupBy,
        config,
        "Each table below corresponds to a group represented in the pivot summary table above.",
      );
    } else if (!summarise && groupBy.length) {
      drawGroupedRaw(
        doc,
        sourceRows,
        groupBy,
        config,
        "Each table below contains the filtered raw records belonging to the group identified above.",
      );
    } else if (summarise && !groupBy.length) {
      drawSummaryTotal(doc, report);
    }

    drawRawDump(doc, sourceRows, config);

    doc.end();
  });
}
