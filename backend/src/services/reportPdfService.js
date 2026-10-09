import PDFDocument from "pdfkit";
import { env } from "../config/env.js";
import { runPdfInWorker } from "./pdfWorkerPool.js";

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
    return Number(isSummary ? row.total : row.total_cost ?? row.expense_amount ?? row.report_amount ?? row.share_price ?? 0);
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
  // Report rows are already split to one row per survivor share. Never merge
  // them back into one expense row in the PDF, or a survivor would receive
  // the original expense total instead of the recalculated share amount.
  return [...rows];
}

function getRawDumpColumns(rows) {
  const first = rows[0] || {};
  const preferred = [
    "expense_date",
    "category",
    "item",
    "quantity",
    "unit",
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

function chartDimensionLabel(value, column) {
  return formatCell(value, column);
}

function drawBarSegmentLabel(doc, value, x, y, width, height) {
  if (!value || height < 9 || width < 10) return;
  const label = money(value);
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(Math.max(4.5, Math.min(6.5, Math.min(width / 5, height / 2.2))))
    .text(label, x + 1, y + Math.max(1, (height - 7) / 2), {
      width: Math.max(width - 2, 1),
      height: Math.max(height - 2, 7),
      align: "center",
      ellipsis: true,
    });
}

function buildIntelligentChartModel(rows, groupBy) {
  const groups = Array.isArray(groupBy) ? groupBy : [];
  const period = groups.find((column) => ["date", "week", "month", "year"].includes(column));
  const category = groups.includes("category") ? "category" : null;
  const survivor = groups.includes("survivor") ? "survivor" : null;
  const xColumn = period || groups.find((column) => column !== category && column !== survivor) || groups[0];

  if (groups.length <= 1) {
    const items = [];
    const seen = new Set();
    for (const row of rows || []) {
      const key = String(row[xColumn] ?? "—");
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ key, label: chartDimensionLabel(row[xColumn], xColumn), total: 0 });
      }
      items[items.length - 1].total += Number(row.total || 0);
    }
    return { type: "simple", xColumn, items };
  }

  if (category && survivor) {
    const xItems = [];
    const xSeen = new Set();
    const categoryItems = [];
    const categorySeen = new Set();
    const survivorItems = [];
    const survivorSeen = new Set();
    const values = new Map();

    for (const row of rows || []) {
      const xKey = String(row[xColumn] ?? "—");
      const categoryKey = String(row[category] ?? "—");
      const survivorKey = String(row[survivor] ?? "—");
      if (!xSeen.has(xKey)) { xSeen.add(xKey); xItems.push({ key: xKey, label: chartDimensionLabel(row[xColumn], xColumn) }); }
      if (!categorySeen.has(categoryKey)) { categorySeen.add(categoryKey); categoryItems.push({ key: categoryKey, label: chartDimensionLabel(row[category], category) }); }
      if (!survivorSeen.has(survivorKey)) { survivorSeen.add(survivorKey); survivorItems.push({ key: survivorKey, label: chartDimensionLabel(row[survivor], survivor) }); }
      const key = `${xKey}\u0002${categoryKey}\u0002${survivorKey}`;
      values.set(key, (values.get(key) || 0) + Number(row.total || 0));
    }

    return { type: "category-survivor", xColumn, xItems, categoryItems, survivorItems, values };
  }

  const seriesColumn = groups.find((column) => column !== xColumn) || groups[1];
  const xItems = [];
  const xSeen = new Set();
  const seriesItems = [];
  const seriesSeen = new Set();
  const values = new Map();
  for (const row of rows || []) {
    const xKey = String(row[xColumn] ?? "—");
    const seriesKey = String(row[seriesColumn] ?? "—");
    if (!xSeen.has(xKey)) { xSeen.add(xKey); xItems.push({ key: xKey, label: chartDimensionLabel(row[xColumn], xColumn) }); }
    if (!seriesSeen.has(seriesKey)) { seriesSeen.add(seriesKey); seriesItems.push({ key: seriesKey, label: chartDimensionLabel(row[seriesColumn], seriesColumn) }); }
    const key = `${xKey}\u0002${seriesKey}`;
    values.set(key, (values.get(key) || 0) + Number(row.total || 0));
  }
  return { type: "grouped", xColumn, seriesColumn, xItems, seriesItems, values };
}

function shadeColor(hex, mixWithWhite) {
  const value = String(hex || "#000000").replace("#", "");
  const rgb = value.length === 3 ? value.split("").map((c) => parseInt(c + c, 16)) : [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
  const amount = Math.max(0, Math.min(1, Number(mixWithWhite) || 0));
  const mixed = rgb.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function drawGroupedChartPage(doc, model, title) {
  const usableWidth = usableWidthFor(doc);
  const x = doc.page.margins.left;
  const chartHeight = 165;
  const palette = ["#315f9f", "#d97706", "#059669", "#7c3aed", "#dc2626", "#0891b2", "#be185d", "#65a30d"];
  ensureSpace(doc, chartHeight + 125);
  drawSectionTitle(doc, title);
  const baseline = doc.y + chartHeight;
  drawChartAxes(doc, x, baseline, usableWidth, chartHeight - 20);

  if (model.type === "simple") {
    const max = Math.max(...model.items.map((item) => item.total), 1);
    const slot = usableWidth / Math.max(model.items.length, 1);
    const barWidth = Math.max(10, Math.min(36, slot - 12));
    model.items.forEach((item, index) => {
      const height = (item.total / max) * (chartHeight - 35);
      const bx = x + index * slot + (slot - barWidth) / 2;
      const by = baseline - height;
      doc.save()
        .fillColor(palette[0])
        .strokeColor("#ffffff")
        .lineWidth(1.25)
        .rect(bx, by, barWidth, height)
        .fillAndStroke()
        .restore();
      drawBarValueLabel(doc, item.total, bx, by, barWidth, baseline - chartHeight + 2);
      doc.fillColor("#1f2937").font("Helvetica").fontSize(5.2).text(item.label, bx - 10, baseline + 4, { width: barWidth + 20, height: 24, align: "center", ellipsis: true });
    });
    doc.y = baseline + 24;
    return;
  }

  if (model.type === "category-survivor") {
    const max = Math.max(...model.xItems.map((xItem) => model.categoryItems.reduce((sum, category) => sum + model.survivorItems.reduce((inner, survivor) => inner + (model.values.get(`${xItem.key}\u0002${category.key}\u0002${survivor.key}`) || 0), 0), 0)), 1);
    const slot = usableWidth / Math.max(model.xItems.length, 1);
    const categoryGap = 3;
    const stackWidth = Math.max(8, Math.min(24, (slot - 12) / Math.max(model.categoryItems.length, 1) - categoryGap));
    model.xItems.forEach((xItem, xIndex) => {
      const groupWidth = model.categoryItems.length * (stackWidth + categoryGap) - categoryGap;
      const start = x + xIndex * slot + Math.max((slot - groupWidth) / 2, 0);
      model.categoryItems.forEach((category, categoryIndex) => {
        let y = baseline;
        let total = 0;
        model.survivorItems.forEach((survivor) => {
          const value = Number(model.values.get(`${xItem.key}\u0002${category.key}\u0002${survivor.key}`) || 0);
          if (!value) return;
          const height = (value / max) * (chartHeight - 35);
          y -= height;
          total += value;
          const segmentX = start + categoryIndex * (stackWidth + categoryGap);
          doc.save()
            .fillColor(shadeColor(palette[categoryIndex % palette.length], 0.65 - (model.survivorItems.indexOf(survivor) / Math.max(model.survivorItems.length - 1, 1)) * 0.55))
            .strokeColor("#ffffff")
            .lineWidth(1.25)
            .rect(segmentX, y, stackWidth, height)
            .fillAndStroke()
            .restore();
          drawBarSegmentLabel(doc, value, segmentX, y, stackWidth, height);
        });
        if (total) drawBarValueLabel(doc, total, start + categoryIndex * (stackWidth + categoryGap), y, stackWidth, baseline - chartHeight + 2);
      });
      doc.fillColor("#1f2937").font("Helvetica").fontSize(5.2).text(xItem.label, x + xIndex * slot, baseline + 4, { width: slot - 2, height: 24, align: "center", ellipsis: true });
    });

    let legendX = x;
    let legendY = baseline + 32;
    model.categoryItems.forEach((category, categoryIndex) => {
      model.survivorItems.forEach((survivor, survivorIndex) => {
        const label = `${category.label} • ${survivor.label}`;
        const width = Math.min(150, Math.max(58, doc.widthOfString(label, { fontSize: 7 }) + 18));
        if (legendX + width > doc.page.width - doc.page.margins.right) { legendX = x; legendY += 13; }
        const shade = shadeColor(palette[categoryIndex % palette.length], 0.65 - (survivorIndex / Math.max(model.survivorItems.length - 1, 1)) * 0.55);
        doc.save().fillColor(shade).rect(legendX, legendY, 8, 8).fill().restore();
        doc.fillColor("black").font("Helvetica").fontSize(7).text(label, legendX + 11, legendY - 1, { width: width - 11, ellipsis: true });
        legendX += width;
      });
    });
    doc.y = legendY + 18;
    return;
  }

  const max = Math.max(...model.xItems.flatMap((xItem) => model.seriesItems.map((series) => model.values.get(`${xItem.key}\u0002${series.key}`) || 0)), 1);
  const slot = usableWidth / Math.max(model.xItems.length, 1);
  const barWidth = Math.max(7, Math.min(20, (slot - 8) / Math.max(model.seriesItems.length, 1)));
  model.xItems.forEach((xItem, xIndex) => {
    const groupWidth = model.seriesItems.length * (barWidth + 2) - 2;
    const start = x + xIndex * slot + Math.max((slot - groupWidth) / 2, 0);
    model.seriesItems.forEach((series, seriesIndex) => {
      const value = Number(model.values.get(`${xItem.key}\u0002${series.key}`) || 0);
      const height = (value / max) * (chartHeight - 35);
      const bx = start + seriesIndex * (barWidth + 2);
      const by = baseline - height;
      doc.save()
        .fillColor(palette[seriesIndex % palette.length])
        .strokeColor("#ffffff")
        .lineWidth(1.25)
        .rect(bx, by, barWidth, height)
        .fillAndStroke()
        .restore();
      if (value) drawBarValueLabel(doc, value, bx, by, barWidth, baseline - chartHeight + 2);
    });
    doc.fillColor("#1f2937").font("Helvetica").fontSize(5.2).text(xItem.label, x + xIndex * slot, baseline + 4, { width: slot - 2, height: 24, align: "center", ellipsis: true });
  });

  let legendX = x;
  let legendY = baseline + 32;
  model.seriesItems.forEach((series, index) => {
    const width = Math.min(120, Math.max(48, doc.widthOfString(series.label, { fontSize: 7 }) + 18));
    if (legendX + width > doc.page.width - doc.page.margins.right) { legendX = x; legendY += 13; }
    doc.save().fillColor(palette[index % palette.length]).rect(legendX, legendY, 8, 8).fill().restore();
    doc.fillColor("black").font("Helvetica").fontSize(7).text(series.label, legendX + 11, legendY - 1, { width: width - 11, ellipsis: true });
    legendX += width;
  });
  doc.y = legendY + 18;
}

function drawGroupedBarChart(doc, report, config) {
  const groupBy = Array.isArray(config.groupBy) ? config.groupBy : Array.isArray(report.groupBy) ? report.groupBy : [];
  const rows = Array.isArray(report.rows) ? report.rows : [];
  if (!groupBy.length || !rows.length) return;
  const model = buildIntelligentChartModel(sortRows(rows, config, true), groupBy);
  const chunkSize = 18;
  const xItems = Array.isArray(model.xItems) ? model.xItems : model.items || [];
  if (xItems.length <= chunkSize) {
    drawGroupedChartPage(doc, model, "Intelligent grouped bar chart");
    return;
  }
  for (let start = 0; start < xItems.length; start += chunkSize) {
    if (start) doc.addPage();
    drawGroupedChartPage(doc, { ...model, xItems: xItems.slice(start, start + chunkSize), items: xItems.slice(start, start + chunkSize) }, "Intelligent grouped bar chart");
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

export function buildReportPdfInProcess(report, config = {}) {
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

export function buildReportPdf(report, config = {}) {
  return runPdfInWorker("report", { report, config });
}
