import PDFDocument from "pdfkit";
import { env } from "../config/env.js";

const PIVOT_LEAVES_PER_PAGE = 8;
const CHART_ROWS_PER_PAGE = 12;
const CHART_SERIES_PER_PAGE = 8;

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

function formatDimensionDate(value) {
  if (!value) return "—";
  return formatDate(value);
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function formatCell(value, column) {
  if (value === null || value === undefined || value === "") return "—";

  if (["total", "total_cost", "report_amount", "share_price", "price"].includes(column)) {
    return money(value);
  }

  if (column === "expense_date") return formatDate(value);
  if (["date", "week", "month"].includes(column)) return formatDimensionDate(value);
  if (column === "year") return String(value);

  return String(value);
}

function rawDimensionValue(row, column) {
  if (column === "date") return row.expense_date;

  if (column === "week") {
    const raw = String(row.expense_date || "").slice(0, 10);
    const date = new Date(`${raw}T00:00:00Z`);

    if (Number.isNaN(date.getTime())) return null;

    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return date.toISOString().slice(0, 10);
  }

  if (column === "month") {
    const raw = String(row.expense_date || "").slice(0, 7);
    return raw ? `${raw}-01` : null;
  }

  if (column === "year") {
    const raw = String(row.expense_date || "").slice(0, 4);
    return raw ? Number(raw) : null;
  }

  return row[column];
}

function rawGroupKey(row, groupBy) {
  return groupBy.map((column) => String(rawDimensionValue(row, column) ?? "—")).join("\u0001");
}

function rawGroupValues(row, groupBy) {
  return Object.fromEntries(groupBy.map((column) => [column, rawDimensionValue(row, column)]));
}

function valueForSort(row, column, isSummary = false) {
  if (column === "price") {
    return Number(isSummary ? row.total : row.total_cost ?? row.report_amount ?? row.share_price ?? 0);
  }

  if (isSummary) return row[column];

  return rawDimensionValue(row, column);
}

function compareSortValues(left, right) {
  if (left === null || left === undefined || left === "") return -1;
  if (right === null || right === undefined || right === "") return 1;

  if (typeof left === "number" && typeof right === "number") {
    return left === right ? 0 : left < right ? -1 : 1;
  }

  const leftText = String(left).toLowerCase();
  const rightText = String(right).toLowerCase();

  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

function sortRows(rows, config = {}, isSummary = false) {
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
      const left = valueForSort(a, sort.column, isSummary);
      const right = valueForSort(b, sort.column, isSummary);
      const comparison = compareSortValues(left, right);

      if (comparison !== 0) {
        return comparison * (sort.direction === "desc" ? -1 : 1);
      }
    }

    return 0;
  });
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
    const total = Number(row.total_cost || shares.reduce((sum, item) => sum + item.amount, 0));

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

function mergeRowsForRawDump(rows) {
  if (rows.some((row) => Object.prototype.hasOwnProperty.call(row, "share_price"))) {
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
    "share_price",
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

function drawCell(doc, value, column, x, y, width, height, textColor, fontSize) {
  const isProof = column === "proof_url" && value;
  const text = isProof ? "Open proof" : formatCell(value, column);

  doc
    .fillColor(isProof ? "#2563eb" : textColor)
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

function usableWidthFor(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function drawSectionTitle(doc, title, subtitle = "") {
  ensureSpace(doc, subtitle ? 48 : 30);

  // Always anchor section labels to the page's left margin. Other PDF
  // drawing helpers (tables, legends, charts) may change the current X.
  const x = doc.page.margins.left;

  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .fillColor("#000000")
    .text(title, x, doc.y);

  if (subtitle) {
    doc
      .moveDown(0.15)
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#555555")
      .text(subtitle, x, doc.y);
  }

  doc.moveDown(0.45);
}

function drawTable(doc, columns, rows, widths = null, options = {}) {
  if (!columns.length) return;

  const usableWidth = usableWidthFor(doc);
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

      doc
        .save()
        .fillColor(header ? "#315f9f" : index % 2 ? "#ffffff" : "#eef4fb")
        .rect(x, y, width, height)
        .fill()
        .restore();

      doc.strokeColor("#b8c7da").rect(x, y, width, height).stroke();

      if (header) {
        doc
          .fillColor("#ffffff")
          .fontSize(7)
          .font("Helvetica-Bold")
          .text(String(column).replace(/_/g, " ").toUpperCase(), x + 3, y + 5, {
            width: width - 6,
            height: height - 7,
            ellipsis: true,
          });
      } else {
        drawCell(doc, values[column], column, x, y, width, height, "#1f2937", options.fontSize || 6);
      }

      x += width;
    });

    doc.y = y + height;
  };

  drawRow(null, true);
  rows.forEach((row, index) => drawRow(row, false, index));
}

function summarizeFilter(config = {}) {
  const filters = config.filters || {};
  const parts = [];

  if (filters.date) parts.push(`Date = ${formatDate(filters.date)}`);
  if (filters.dateFrom || filters.dateTo) {
    parts.push(`Date range = ${filters.dateFrom || "—"} to ${filters.dateTo || "—"}`);
  }
  if (filters.month) parts.push(`Month = ${filters.month}`);
  if (filters.year) parts.push(`Year = ${filters.year}`);
  if (filters.hasProof === "true") parts.push("Has proof = Yes");
  if (filters.hasProof === "false") parts.push("Has proof = No");

  if (filters.categoryItems?.length) {
    const labels = Array.isArray(filters.categoryItemLabels)
      ? filters.categoryItemLabels
      : filters.categoryItems;
    parts.push(`Category/item filters = ${labels.join(", ")}`);
  }
  if (filters.categories?.length) parts.push(`Categories = ${filters.categories.join(", ")}`);
  if (filters.survivors?.length) parts.push(`Survivors = ${filters.survivors.join(", ")}`);

  return parts.length ? parts.join(" | ") : "No filters selected; all expense records are included.";
}

function drawReportFilters(doc, config) {
  const groupBy = Array.isArray(config.groupBy) ? config.groupBy : [];
  const sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [];

  if (groupBy.length) {
    doc.fontSize(9).font("Helvetica").text(`Group by: ${groupBy.join(", ")}`);
  }

  if (sortColumns.length) {
    doc
      .fontSize(9)
      .font("Helvetica")
      .text(
        `Sort: ${sortColumns.map((item) => `${item.column} ${item.direction}`).join(", ")}`,
      );
  }

  doc.fontSize(9).font("Helvetica").text(`Summarise: ${config.summarise ? "Yes" : "No"}`);
  doc.fontSize(8).fillColor("#555555").text(`Filters: ${summarizeFilter(config)}`);
  doc.fillColor("#000000").moveDown(0.7);
}

function groupDetailRows(rawRows, groupBy, config) {
  const sortedSource = sortRows(rawRows || [], config, false);
  const groups = new Map();

  for (const row of sortedSource) {
    if (!groupBy.length) continue;

    const key = rawGroupKey(row, groupBy);

    if (!groups.has(key)) {
      groups.set(key, {
        values: rawGroupValues(row, groupBy),
        rows: [],
      });
    }

    groups.get(key).rows.push(row);
  }

  const grouped = [...groups.values()].map((group) => ({
    ...group,
    rows: mergeRowsForRawDump(group.rows),
  }));

  const sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [];

  return grouped.sort((left, right) => {
    const leftSample = left.rows[0] || {};
    const rightSample = right.rows[0] || {};

    for (const sort of sortColumns) {
      let leftValue;
      let rightValue;

      if (sort.column === "price") {
        leftValue = left.rows.reduce(
          (sum, row) => sum + Number(row.total_cost ?? row.report_amount ?? row.share_price ?? 0),
          0,
        );
        rightValue = right.rows.reduce(
          (sum, row) => sum + Number(row.total_cost ?? row.report_amount ?? row.share_price ?? 0),
          0,
        );
      } else if (groupBy.includes(sort.column)) {
        leftValue = left.values[sort.column];
        rightValue = right.values[sort.column];
      } else {
        leftValue = rawDimensionValue(leftSample, sort.column);
        rightValue = rawDimensionValue(rightSample, sort.column);
      }

      const comparison = compareSortValues(leftValue, rightValue);
      if (comparison !== 0) return comparison * (sort.direction === "desc" ? -1 : 1);
    }

    for (const column of groupBy) {
      const comparison = compareSortValues(left.values[column], right.values[column]);
      if (comparison !== 0) return comparison;
    }

    return 0;
  });
}

function drawGroupIdentity(doc, groupBy, group) {
  const x = doc.page.margins.left;
  const width = usableWidthFor(doc);
  const lineHeight = 15;
  const height = Math.max(34, groupBy.length * lineHeight + 12);

  ensureSpace(doc, height + 8);

  const y = doc.y;

  doc.save().fillColor("#e8f1fb").roundedRect(x, y, width, height, 5).fill().restore();
  doc.strokeColor("#b8c7da").roundedRect(x, y, width, height, 5).stroke();

  doc
    .fillColor("#315f9f")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("GROUP", x + 8, y + 5);

  groupBy.forEach((column, index) => {
    doc
      .fillColor("#1f2937")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(`${column.replace(/_/g, " ")}:`, x + 58, y + 5 + index * lineHeight, {
        width: 90,
      });

    doc
      .font("Helvetica")
      .text(formatCell(group[column], column), x + 145, y + 5 + index * lineHeight, {
        width: width - 153,
        ellipsis: true,
      });
  });

  doc.y = y + height + 6;
}

function drawGroupedRaw(doc, rawRows, groupBy, config, subtitle) {
  drawSectionTitle(doc, "Group-by detail tables", subtitle);

  const groups = groupDetailRows(rawRows, groupBy, config);

  if (!groups.length) {
    doc.fontSize(10).font("Helvetica").text("No records match the selected filters.");
    return;
  }

  groups.forEach((group, index) => {
    if (index > 0) doc.moveDown(0.8);

    drawGroupIdentity(doc, groupBy, group.values);

    drawTable(doc, getRawDumpColumns(group.rows), group.rows, null, {
      rowHeight: 30,
      fontSize: 5.8,
    });
  });
}

function dimensionCardinality(rows, column) {
  return new Set(rows.map((row) => String(row[column] ?? "—"))).size;
}

function estimatePivotShape(rows, rowGroups, columnGroups) {
  const rowCardinality = rowGroups.reduce(
    (product, column) => product * Math.max(dimensionCardinality(rows, column), 1),
    1,
  );
  const columnCardinality = columnGroups.reduce(
    (product, column) => product * Math.max(dimensionCardinality(rows, column), 1),
    1,
  );

  return {
    rowCardinality,
    columnCardinality,
    widthPressure: columnCardinality * Math.max(columnGroups.length, 1),
  };
}

function getPivotDimensions(rows, groupBy, config = {}) {
  if (groupBy.length <= 1) {
    return { rowGroups: [...groupBy], columnGroups: [] };
  }

  if (groupBy.length === 2) {
    return { rowGroups: [groupBy[0]], columnGroups: [groupBy[1]] };
  }

  if (groupBy.length === 3) {
    return { rowGroups: [groupBy[0]], columnGroups: [groupBy[1], groupBy[2]] };
  }

  const candidates = [];
  const sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [];

  for (let rowCount = 1; rowCount < groupBy.length; rowCount += 1) {
    const rowIndexes = [];

    function enumerate(start, picked) {
      if (picked.length === rowCount) {
        rowIndexes.push([...picked]);
        return;
      }

      for (let index = start; index < groupBy.length; index += 1) {
        picked.push(index);
        enumerate(index + 1, picked);
        picked.pop();
      }
    }

    enumerate(0, []);

    for (const indexes of rowIndexes) {
      const selected = new Set(indexes);
      const rowGroups = groupBy.filter((_, index) => selected.has(index));
      const columnGroups = groupBy.filter((_, index) => !selected.has(index));
      const shape = estimatePivotShape(rows, rowGroups, columnGroups);

      if (shape.columnCardinality > 64) continue;

      const explicitRowSorts = sortColumns.filter((sort) => rowGroups.includes(sort.column)).length;
      const explicitColumnSorts = sortColumns.filter((sort) => columnGroups.includes(sort.column)).length;
      const squarePenalty = Math.abs(
        Math.log2(Math.max(shape.rowCardinality, 1)) - Math.log2(Math.max(shape.columnCardinality, 1)),
      );

      const score =
        Math.abs(rowGroups.length - groupBy.length / 2) * 1.5 +
        shape.widthPressure / 9 +
        squarePenalty +
        Math.max(shape.rowCardinality - 250, 0) / 50 -
        explicitRowSorts * 0.8 +
        explicitColumnSorts * 0.25;

      candidates.push({ rowGroups, columnGroups, score, ...shape });
    }
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.columnCardinality !== b.columnCardinality) {
      return a.columnCardinality - b.columnCardinality;
    }
    return a.rowGroups.length - b.rowGroups.length;
  });

  return candidates[0]
    ? { rowGroups: candidates[0].rowGroups, columnGroups: candidates[0].columnGroups }
    : {
        rowGroups: groupBy.slice(0, Math.ceil(groupBy.length / 2)),
        columnGroups: groupBy.slice(Math.ceil(groupBy.length / 2)),
      };
}

function pivotRowKey(row, rowGroups) {
  return rowGroups.map((column) => String(row[column] ?? "—")).join("\u0001");
}

function pivotColumnKey(row, columnGroups) {
  return columnGroups.map((column) => String(row[column] ?? "—")).join("\u0001");
}

function getPivotMatrix(rows, groupBy, config = {}) {
  const { rowGroups, columnGroups } = getPivotDimensions(rows, groupBy, config);
  const rowMap = new Map();
  const leafMap = new Map();

  for (const row of rows || []) {
    const rowKey = pivotRowKey(row, rowGroups);

    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, {
        key: rowKey,
        values: Object.fromEntries(rowGroups.map((column) => [column, row[column]])),
      });
    }

    if (columnGroups.length) {
      const columnKey = pivotColumnKey(row, columnGroups);
      if (!leafMap.has(columnKey)) {
        leafMap.set(columnKey, {
          key: columnKey,
          values: Object.fromEntries(columnGroups.map((column) => [column, row[column]])),
        });
      }
    }
  }

  const rowItems = [...rowMap.values()];
  const leafItems = [...leafMap.values()];
  const totals = new Map();
  const rowTotals = new Map();
  const leafTotals = new Map();

  for (const row of rows || []) {
    const rowKey = pivotRowKey(row, rowGroups);
    const amount = Number(row.total || 0);

    rowTotals.set(rowKey, (rowTotals.get(rowKey) || 0) + amount);

    if (!columnGroups.length) {
      totals.set(rowKey, (totals.get(rowKey) || 0) + amount);
      continue;
    }

    const columnKey = pivotColumnKey(row, columnGroups);
    leafTotals.set(columnKey, (leafTotals.get(columnKey) || 0) + amount);
    const key = `${rowKey}\u0002${columnKey}`;
    totals.set(key, (totals.get(key) || 0) + amount);
  }

  const sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [];
  const sortByDimensionValues = (left, right, columns, totalsMap) => {
    for (const sort of sortColumns) {
      const column = sort.column;

      if (column === "price") {
        const comparison = compareSortValues(
          totalsMap.get(left.key) || 0,
          totalsMap.get(right.key) || 0,
        );
        if (comparison !== 0) return comparison * (sort.direction === "desc" ? -1 : 1);
        continue;
      }

      if (!columns.includes(column)) continue;

      const comparison = compareSortValues(left.values[column], right.values[column]);
      if (comparison !== 0) return comparison * (sort.direction === "desc" ? -1 : 1);
    }

    for (const column of columns) {
      const comparison = compareSortValues(left.values[column], right.values[column]);
      if (comparison !== 0) return comparison;
    }

    return 0;
  };

  rowItems.sort((a, b) => sortByDimensionValues(a, b, rowGroups, rowTotals));
  leafItems.sort((a, b) => sortByDimensionValues(a, b, columnGroups, leafTotals));

  return {
    rowGroups,
    columnGroups,
    rowItems,
    leafItems,
    totals,
    rowTotals,
    leafTotals,
  };
}

function drawMergedHeaderCell(doc, x, y, width, height, value, level = 0, options = {}) {
  doc
    .save()
    .fillColor(level % 2 ? "#406fae" : "#315f9f")
    .rect(x, y, width, height)
    .fill()
    .restore();

  doc.strokeColor("#b8c7da").rect(x, y, width, height).stroke();

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
    const value = displayValue(leaves[start].values[leaves[start].columns[level]]);
    let end = start + 1;

    while (
      end < leaves.length &&
      displayValue(leaves[end].values[leaves[end].columns[level]]) === value
    ) {
      end += 1;
    }

    groups.push({ start, span: end - start, value });
    start = end;
  }

  return groups;
}

function drawPivotTableChunk(doc, matrix, config, leaves) {
  const { rowGroups, columnGroups, rowItems, totals } = matrix;
  const usableWidth = usableWidthFor(doc);
  const rowWidth = Math.min(190, Math.max(145, usableWidth * 0.27));
  const leafWidth = (usableWidth - rowWidth) / Math.max(leaves.length, 1);
  const headerHeight = 22;
  const headerLevels = Math.max(columnGroups.length, 1);

  ensureSpace(doc, headerLevels * headerHeight + 34);

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
      { fontSize: 6 },
    );
  });

  if (columnGroups.length) {
    const preparedLeaves = leaves.map((leaf) => ({ ...leaf, columns: columnGroups }));
    const columnStartX = x0 + rowWidth;

    columnGroups.forEach((column, level) => {
      buildHeaderGroups(preparedLeaves, level).forEach((header) => {
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
  } else {
    drawMergedHeaderCell(doc, x0 + rowWidth, headerY, leafWidth, headerHeight, "EXPENSE", 0);
  }

  doc.y = headerY + headerLevels * headerHeight;

  rowItems.forEach((pivotRow, rowIndex) => {
    ensureSpace(doc, 29);

    const y = doc.y;
    let x = x0;

    rowGroups.forEach((column, index) => {
      doc
        .save()
        .fillColor(rowIndex % 2 ? "#ffffff" : "#eef4fb")
        .rect(x, y, rowHeaderWidth, 29)
        .fill()
        .restore();

      doc.strokeColor("#b8c7da").rect(x, y, rowHeaderWidth, 29).stroke();
      doc
        .fillColor("#1f2937")
        .font("Helvetica-Bold")
        .fontSize(6.2)
        .text(formatCell(pivotRow.values[column], column), x + 3, y + 9, {
          width: rowHeaderWidth - 6,
          align: "center",
          ellipsis: true,
        });

      x += rowHeaderWidth;
    });

    if (!columnGroups.length) {
      const value = totals.get(pivotRow.key) || 0;
      doc
        .save()
        .fillColor(rowIndex % 2 ? "#ffffff" : "#f8fbff")
        .rect(x, y, leafWidth, 29)
        .fill()
        .restore();
      doc.strokeColor("#b8c7da").rect(x, y, leafWidth, 29).stroke();
      doc
        .fillColor("#1f2937")
        .font("Helvetica")
        .fontSize(6)
        .text(value ? money(value) : "—", x + 3, y + 9, {
          width: leafWidth - 6,
          align: "right",
        });
      x += leafWidth;
    } else {
      for (const leaf of leaves) {
        const value = totals.get(`${pivotRow.key}\u0002${leaf.key}`) || 0;

        doc
          .save()
          .fillColor(rowIndex % 2 ? "#ffffff" : "#f8fbff")
          .rect(x, y, leafWidth, 29)
          .fill()
          .restore();
        doc.strokeColor("#b8c7da").rect(x, y, leafWidth, 29).stroke();
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
    }

    doc.y = y + 29;
  });
}

function drawPivotSummary(doc, report, config) {
  // The API summary rows are aggregates and do not necessarily carry the
  // grouping metadata. The export config is the authoritative source.
  const groupBy = Array.isArray(config.groupBy)
    ? config.groupBy
    : Array.isArray(report.groupBy)
      ? report.groupBy
      : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];

  drawSectionTitle(
    doc,
    "Pivot grouped summary table",
    `Group by: ${groupBy.join(" • ")}. The row/column orientation is selected to keep the pivot readable; repeated column-group values are merged in the heading.`,
  );

  if (!rows.length || !groupBy.length) {
    doc.fontSize(10).font("Helvetica").text("No records match the selected filters.");
    return;
  }

  const matrix = getPivotMatrix(sortRows(rows, config, true), groupBy, config);

  if (!matrix.columnGroups.length) {
    const values = matrix.rowItems.map((row) => ({
      group_value: row.values[matrix.rowGroups[0]],
      total: matrix.totals.get(row.key) || 0,
    }));

    drawTable(
      doc,
      [matrix.rowGroups[0], "total"],
      values.map((row) => ({
        [matrix.rowGroups[0]]: formatCell(row.group_value, matrix.rowGroups[0]),
        total: row.total,
      })),
      [usableWidthFor(doc) * 0.72, usableWidthFor(doc) * 0.28],
      { rowHeight: 30 },
    );

    return;
  }

  for (let start = 0; start < matrix.leafItems.length; start += PIVOT_LEAVES_PER_PAGE) {
    const leaves = matrix.leafItems.slice(start, start + PIVOT_LEAVES_PER_PAGE);

    if (start > 0) {
      doc.addPage();
      drawSectionTitle(doc, "Pivot grouped summary table (continued)");
    }

    drawPivotTableChunk(doc, matrix, config, leaves);
  }
}

function drawChartAxes(doc, x, baseline, width, height) {
  doc
    .strokeColor("#9aa8b8")
    .moveTo(x, baseline - height)
    .lineTo(x, baseline)
    .lineTo(x + width, baseline)
    .stroke();
}

function drawBarValueLabel(doc, value, x, barTop, width, minY) {
  const label = money(value);
  const labelWidth = Math.max(width + 12, 34);
  const labelX = x - (labelWidth - width) / 2;
  const labelY = Math.max(barTop - 8, minY);

  doc
    .fillColor("#1f2937")
    .font("Helvetica")
    .fontSize(5.2)
    .text(label, labelX, labelY, {
      width: labelWidth,
      height: 8,
      align: "center",
      ellipsis: true,
    });
}

function drawGroupedChartPage(doc, matrix, rows, leaves, title) {
  const usableWidth = usableWidthFor(doc);
  const x = doc.page.margins.left;
  const chartHeight = 165;

  ensureSpace(doc, chartHeight + 125);
  drawSectionTitle(doc, title);
  const baseline = doc.y + chartHeight;
  const slot = usableWidth / Math.max(rows.length, 1);
  const seriesGap = 2;
  const barWidth = Math.max(
    6,
    Math.min(18, (slot - 8) / Math.max(leaves.length, 1)),
  );
  const max = Math.max(
    ...rows.flatMap((row) =>
      leaves.length
        ? leaves.map((leaf) => Number(matrix.totals.get(`${row.key}\u0002${leaf.key}`) || 0))
        : [Number(matrix.totals.get(row.key) || 0)],
    ),
    1,
  );

  drawChartAxes(doc, x, baseline, usableWidth, chartHeight - 20);

  rows.forEach((row, rowIndex) => {
    if (!leaves.length) {
      const value = Number(matrix.totals.get(row.key) || 0);
      const barHeight = (value / max) * (chartHeight - 35);
      const bx = x + rowIndex * slot + (slot - barWidth) / 2;
      const by = baseline - barHeight;

      doc.save().fillColor("#315f9f").rect(bx, by, barWidth, barHeight).fill().restore();

      drawBarValueLabel(doc, value, bx, by, barWidth, baseline - chartHeight + 2);

      doc
        .fillColor("#1f2937")
        .font("Helvetica")
        .fontSize(5.2)
        .text(formatCell(row.values[matrix.rowGroups[0]], matrix.rowGroups[0]), bx - 12, baseline + 4, {
          width: barWidth + 24,
          height: 24,
          align: "center",
          ellipsis: true,
        });
      return;
    }

    leaves.forEach((leaf, seriesIndex) => {
      const value = Number(matrix.totals.get(`${row.key}\u0002${leaf.key}`) || 0);
      const barHeight = (value / max) * (chartHeight - 35);
      const groupWidth = leaves.length * (barWidth + seriesGap) - seriesGap;
      const bx = x + rowIndex * slot + Math.max((slot - groupWidth) / 2, 0) + seriesIndex * (barWidth + seriesGap);
      const by = baseline - barHeight;

      const palette = [
        "#315f9f",
        "#d97706",
        "#059669",
        "#7c3aed",
        "#dc2626",
        "#0891b2",
        "#be185d",
        "#65a30d",
      ];

      doc.save().fillColor(palette[seriesIndex % palette.length]).rect(bx, by, barWidth, barHeight).fill().restore();

      drawBarValueLabel(doc, value, bx, by, barWidth, baseline - chartHeight + 2);
    });

    doc
      .fillColor("#1f2937")
      .font("Helvetica")
      .fontSize(5)
      .text(
        matrix.rowGroups.map((column) => formatCell(row.values[column], column)).join(" • "),
        x + rowIndex * slot,
        baseline + 4,
        { width: slot - 2, height: 28, align: "center", ellipsis: true },
      );
  });

  const legendY = baseline + 34;
  const legendWidth = usableWidth / Math.max(leaves.length || 1, 1);
  const palette = [
    "#315f9f",
    "#d97706",
    "#059669",
    "#7c3aed",
    "#dc2626",
    "#0891b2",
    "#be185d",
    "#65a30d",
  ];

  leaves.forEach((leaf, index) => {
    const legendX = x + index * legendWidth;
    doc.save().fillColor(palette[index % palette.length]).rect(legendX, legendY, 8, 8).fill().restore();
    doc
      .fillColor("#1f2937")
      .font("Helvetica")
      .fontSize(5.5)
      .text(
        leaf.values[matrix.columnGroups[0]] !== undefined
          ? matrix.columnGroups.map((column) => formatCell(leaf.values[column], column)).join(" • ")
          : "Expense",
        legendX + 11,
        legendY - 1,
        { width: legendWidth - 13, ellipsis: true },
      );
  });

  doc.y = legendY + 18;
}

function drawGroupedBarChart(doc, report, config) {
  // Use the selected export grouping so chart and pivot table are built from
  // the same dimensions even when the summary response omits groupBy.
  const groupBy = Array.isArray(config.groupBy)
    ? config.groupBy
    : Array.isArray(report.groupBy)
      ? report.groupBy
      : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];

  if (!groupBy.length || !rows.length) return;

  const matrix = getPivotMatrix(sortRows(rows, config, true), groupBy, config);
  const rowChunks = [];

  for (let start = 0; start < matrix.rowItems.length; start += CHART_ROWS_PER_PAGE) {
    rowChunks.push(matrix.rowItems.slice(start, start + CHART_ROWS_PER_PAGE));
  }

  const leafChunks = matrix.columnGroups.length
    ? Array.from({ length: Math.ceil(matrix.leafItems.length / CHART_SERIES_PER_PAGE) }, (_, index) =>
        matrix.leafItems.slice(index * CHART_SERIES_PER_PAGE, index * CHART_SERIES_PER_PAGE + CHART_SERIES_PER_PAGE),
      )
    : [[]];

  let first = true;

  for (const rowChunk of rowChunks) {
    for (const leafChunk of leafChunks) {
      if (!first) doc.addPage();
      first = false;
      drawGroupedChartPage(
        doc,
        matrix,
        rowChunk,
        leafChunk,
        "Pivot grouped bar chart",
      );
    }
  }
}

function drawRawDump(doc, rows, config) {
  doc.addPage();

  drawSectionTitle(
    doc,
    "Raw dump — filtered expense data",
    `${summarizeFilter(config)} Each expense is kept as one row. The Share column describes survivor name, share amount and percentage of the expense total. Proof files are available through clickable links where a proof exists.`,
  );

  const sourceRows = sortRows(rows || [], config, false);
  if (!sourceRows.length) {
    doc.fontSize(10).font("Helvetica").text("No records match the selected filters.");
    return;
  }

  const dumpRows = mergeRowsForRawDump(sourceRows);
  drawTable(doc, getRawDumpColumns(dumpRows), dumpRows, null, {
    rowHeight: 30,
    fontSize: 5.8,
  });
}

function drawSummaryTotal(doc, report) {
  drawSectionTitle(doc, "Summary total", "The report is summarised without a group-by dimension.");

  drawTable(doc, ["total"], [{ total: report.total }], null, {
    rowHeight: 32,
  });
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
      .text(env.organizationName || "West Bengal Forum for Mental Health", {
        align: "center",
      });

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
      .font("Helvetica")
      .text(
        `Generated: ${new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "medium",
        }).format(new Date())}`,
      );

    doc.fillColor("#000000").moveDown();
    drawReportFilters(doc, config);

    const groupBy = Array.isArray(config.groupBy) ? config.groupBy : [];
    const summarise = Boolean(config.summarise);
    const sourceRows = report.rawRows || report.rows || [];

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
        "Each table below corresponds directly to a group represented in the pivot summary table above.",
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
