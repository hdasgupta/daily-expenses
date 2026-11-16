import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, CalendarClock, Filter, RefreshCw, RotateCcw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import Modal from "../components/Modal";
import ScheduledReportForm from "../components/ScheduledReportForm";
import { getDashboardReports } from "./Dashboard";
import "./scheduledReports.css";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function prettyValue(value, column) {
  if (value == null || value === "") {
    return "—";
  }

  if (column === "year") {
    return String(value);
  }

  if (["date", "week", "month"].includes(column)) {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  return String(value);
}

function rowLabel(row, groupBy) {
  return groupBy.map((column) => prettyValue(row[column], column)).join(" · ");
}

function PivotChartTick({ x, y, payload, viewBox, chartData, groupBy }) {
  const index = payload?.index ?? 0;
  const current = chartData?.[index];
  const periodColumn = groupBy?.[0];
  const survivorColumn = groupBy?.[1];

  if (!current || !periodColumn || !survivorColumn) {
    return null;
  }

  const periodKey = stableValueKey(current[periodColumn]);
  const previous = chartData[index - 1];
  const showPeriod = !previous || stableValueKey(previous[periodColumn]) !== periodKey;

  let periodCenterX = x;
  let periodStartX = x;
  let periodEndX = x;
  let periodGroupSize = 1;

  if (showPeriod && chartData.length) {
    const firstIndex = index;
    let lastIndex = index;

    while (
      lastIndex + 1 < chartData.length &&
      stableValueKey(chartData[lastIndex + 1]?.[periodColumn]) === periodKey
    ) {
      lastIndex += 1;
    }

    /*
     * Recharts exposes the half-band offset on the tick payload. Using it
     * is important here: the SVG viewBox is not guaranteed to be present on
     * a custom tick, and using viewBox.width caused the merged period label
     * to fall back to the first survivor position on deployed builds.
     *
     * A category tick is centered inside its band, so two payload offsets
     * equal one complete category step. This lets the merged period span
     * use the same coordinates as the actual survivor ticks.
     */
    const payloadOffset = Number(payload?.offset);
    const viewBoxStep =
      viewBox?.width && chartData.length ? Number(viewBox.width) / chartData.length : 0;
    const tickStep =
      Number.isFinite(payloadOffset) && payloadOffset > 0
        ? payloadOffset * 2
        : viewBoxStep > 0
          ? viewBoxStep
          : 0;

    periodGroupSize = lastIndex - firstIndex + 1;

    if (tickStep > 0) {
      periodStartX = x - tickStep / 2;
      periodEndX = x + (periodGroupSize - 0.5) * tickStep;
      periodCenterX = (periodStartX + periodEndX) / 2;
    }
  }

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} textAnchor="middle" className="dashboard-pivot-chart-survivor-label">
        {prettyValue(current[survivorColumn], survivorColumn)}
      </text>

      {showPeriod ? (
        <>
          {index > 0 ? (
            <line
              x1={periodStartX - x}
              y1={-8}
              x2={periodStartX - x}
              y2={48}
              className="dashboard-pivot-chart-period-boundary"
            />
          ) : null}
          <text
            x={periodCenterX - x}
            y={42}
            textAnchor="middle"
            className="dashboard-pivot-chart-period-label"
          >
            {prettyValue(current[periodColumn], periodColumn)}
          </text>
        </>
      ) : null}
    </g>
  );
}

function buildMergedCells(rows, columns) {
  return (rows || []).map((row, rowIndex) => {
    const cells = columns.map((column, columnIndex) => {
      const samePrefix =
        rowIndex > 0 &&
        columns.slice(0, columnIndex + 1).every((key) => rows[rowIndex - 1]?.[key] === row[key]);

      if (samePrefix) {
        return {
          hidden: true,
          rowSpan: 0,
        };
      }

      let rowSpan = 1;

      while (rowIndex + rowSpan < rows.length) {
        const candidate = rows[rowIndex + rowSpan];

        if (!columns.slice(0, columnIndex + 1).every((key) => candidate?.[key] === row[key])) {
          break;
        }

        rowSpan += 1;
      }

      return {
        hidden: false,
        rowSpan,
      };
    });

    return {
      row,
      rowIndex,
      cells,
    };
  });
}

function stableValueKey(value) {
  return value == null || value === "" ? "__null__" : String(value);
}

function compareGroupValues(a, b, column) {
  const left = a?.[column];
  const right = b?.[column];

  if (left == null && right == null) {
    return 0;
  }

  if (left == null) return 1;
  if (right == null) return -1;

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
  });
}

function isDateGroup(column) {
  return ["date", "week", "month", "year"].includes(column);
}

function buildPivotSummary(rows, groupBy) {
  const groups = groupBy || [];

  if (groups.length <= 1) {
    return null;
  }

  const rowColumns = groups.slice(0, -1);

  const columnColumn = groups[groups.length - 1];

  const columnValues = [];
  const columnKeys = new Map();
  const rowMap = new Map();

  (rows || []).forEach((row) => {
    const columnValue = row[columnColumn];

    const columnKey = stableValueKey(columnValue);

    if (!columnKeys.has(columnKey)) {
      columnKeys.set(columnKey, columnValues.length);

      columnValues.push({
        key: columnKey,
        value: columnValue,
      });
    }

    const rowKey = rowColumns.map((column) => stableValueKey(row[column])).join("\u001f");

    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, {
        values: rowColumns.reduce(
          (acc, column) => ({
            ...acc,
            [column]: row[column],
          }),
          {},
        ),
        cells: {},
        total: 0,
      });
    }

    const target = rowMap.get(rowKey);

    const existing = target.cells[columnKey];

    const amount = Number(row.total || 0);

    target.cells[columnKey] = existing
      ? {
          total: existing.total + amount,
          row: existing.row,
        }
      : {
          total: amount,
          row,
        };

    target.total += amount;
  });

  /*
   * Keep the dashboard's primary
   * date/period dimension newest first.
   *
   * Other dimensions remain ascending.
   */
  const pivotRows = Array.from(rowMap.values()).sort((a, b) => {
    for (let index = 0; index < rowColumns.length; index += 1) {
      const column = rowColumns[index];

      const result = compareGroupValues(a.values, b.values, column);

      if (result) {
        return isDateGroup(column) ? -result : result;
      }
    }

    return 0;
  });

  /*
   * Pivot columns are not the primary
   * date dimension in the predefined
   * dashboard reports, so retain the
   * normal ascending ordering.
   */
  columnValues.sort((a, b) =>
    compareGroupValues(
      {
        [columnColumn]: a.value,
      },
      {
        [columnColumn]: b.value,
      },
      columnColumn,
    ),
  );

  return {
    rowColumns,
    columnColumn,
    columnValues,
    rows: pivotRows,
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function filterDashboardData(data, categoryFilter, survivorFilter, categories = [], survivors = []) {
  if (!data) return null;
  if (!categoryFilter && !survivorFilter) return data;

  const groupBy = Array.isArray(data.groupBy) ? data.groupBy : [];
  const selectedCategoryName =
    categories.find((c) => String(c.id) === String(categoryFilter))?.name || null;
  const selectedSurvivorName =
    survivors.find((s) => String(s.id) === String(survivorFilter))?.full_name || null;

  const sourceRows = Array.isArray(data.breakdownRows) && data.breakdownRows.length
    ? data.breakdownRows
    : Array.isArray(data.rows)
      ? data.rows
      : [];

  const matching = sourceRows.filter((row) => {
    if (categoryFilter) {
      const idMatch =
        row.category_id != null && String(row.category_id) === String(categoryFilter);
      const nameMatch =
        selectedCategoryName != null && String(row.category) === String(selectedCategoryName);
      if (!idMatch && !nameMatch) return false;
    }
    if (survivorFilter) {
      const idMatch =
        row.survivor_id != null && String(row.survivor_id) === String(survivorFilter);
      const nameMatch =
        selectedSurvivorName != null && String(row.survivor) === String(selectedSurvivorName);
      if (!idMatch && !nameMatch) return false;
    }
    return true;
  });

  const groupedMap = new Map();
  for (const row of matching) {
    const key = groupBy.map((col) => stableValueKey(row[col])).join("\u001f");
    if (!groupedMap.has(key)) {
      const nextRow = {};
      for (const col of groupBy) {
        nextRow[col] = row[col];
      }
      if (row.category_id != null) nextRow.category_id = row.category_id;
      else if (categoryFilter) nextRow.category_id = categoryFilter;
      if (row.survivor_id != null) nextRow.survivor_id = row.survivor_id;
      else if (survivorFilter) nextRow.survivor_id = survivorFilter;
      nextRow.total = 0;
      groupedMap.set(key, nextRow);
    }
    const target = groupedMap.get(key);
    target.total = Math.round((target.total + Number(row.total || 0)) * 100) / 100;
  }

  const rows = Array.from(groupedMap.values()).sort((a, b) => {
    for (let index = 0; index < groupBy.length; index += 1) {
      const col = groupBy[index];
      const cmp = compareGroupValues(a, b, col);
      if (cmp) return index === 0 && isDateGroup(col) ? -cmp : cmp;
    }
    return 0;
  });

  const total = Math.round(rows.reduce((sum, r) => sum + Number(r.total || 0), 0) * 100) / 100;

  return {
    ...data,
    rows,
    total,
  };
}

function readReportKey() {
  const parts = window.location.pathname.split("/").filter(Boolean);

  return parts[2] || "daily";
}

export default function DashboardDetail({ navigate, user }) {
  const reportKey = readReportKey();

  const report = getDashboardReports().find((item) => item.key === reportKey);

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [categories, setCategories] = useState([]);
  const [survivors, setSurvivors] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [survivorFilter, setSurvivorFilter] = useState("");

  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [scheduleBusy, setScheduleBusy] = useState(false);

  const canSchedule = user?.permissions?.includes("job-status");

  useEffect(() => {
    Promise.all([
      api("/meta/categories", { silent: true }).catch(() => []),
      api("/meta/survivors", { silent: true }).catch(() => []),
    ]).then(([catData, survData]) => {
      setCategories(asArray(catData));
      setSurvivors(asArray(survData));
    });
  }, []);

  const load = () => {
    if (!report) return;

    setLoading(true);

    api("/dashboard/query", {
      method: "POST",

      body: JSON.stringify({
        reportKey: report.key,
        mode: "summary",
      }),

      loadingMessage: "Loading dashboard report…",
    })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setCategoryFilter("");
    setSurvivorFilter("");
    load();
  }, [reportKey]);

  const activeFilters = useMemo(
    () => ({
      categoryId: categoryFilter || "",
      survivorId: survivorFilter || "",
    }),
    [categoryFilter, survivorFilter],
  );

  const filteredData = useMemo(
    () => filterDashboardData(data, categoryFilter, survivorFilter, categories, survivors),
    [data, categoryFilter, survivorFilter, categories, survivors],
  );

  const chartModel = useMemo(() => buildChartModel(filteredData), [filteredData]);

  const chartData = chartModel.data;

  const createSchedule = async (payload) => {
    setScheduleBusy(true);

    try {
      await api("/scheduled-reports", {
        method: "POST",

        body: JSON.stringify(payload),

        loadingMessage: "Creating email schedule…",
      });

      setScheduleOpen(false);
    } finally {
      setScheduleBusy(false);
    }
  };

  if (!report) {
    return (
      <section>
        <button className="secondary" type="button" onClick={() => navigate("/dashboard")}>
          <ArrowLeft size={17} />
          Back to Dashboard
        </button>

        <div className="empty-card">Dashboard report not found.</div>
      </section>
    );
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <button
            className="secondary dashboard-back-button"
            type="button"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft size={17} />
            Back to Dashboard
          </button>

          <h1>{report.label}</h1>

          <p>{report.help}. Click a bar or summary row to open the raw expense data.</p>
        </div>

        <div className="toolbar-actions">
          {canSchedule ? (
            <button type="button" onClick={() => setScheduleOpen(true)}>
              <CalendarClock size={17} />
              Schedule email
            </button>
          ) : null}

          {canSchedule ? (
            <button className="secondary" type="button" onClick={() => navigate("/job-status")}>
              <CalendarClock size={17} />
              Jobs
            </button>
          ) : null}

          <button className="secondary" type="button" onClick={load} disabled={loading}>
            <RefreshCw size={17} />
            Refresh
          </button>
        </div>
      </div>

      <div className="card dashboard-detail-filter-bar">
        <div className="dashboard-detail-filter-head">
          <strong>
            <Filter size={16} />
            Quick Filters
          </strong>
          {(categoryFilter || survivorFilter) ? (
            <button
              type="button"
              className="secondary dashboard-filter-clear-btn"
              onClick={() => {
                setCategoryFilter("");
                setSurvivorFilter("");
              }}
            >
              <RotateCcw size={14} />
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="dashboard-detail-filter-grid">
          <label>
            Category
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={String(cat.id)}>
                  {cat.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Survivor
            <select
              value={survivorFilter}
              onChange={(e) => setSurvivorFilter(e.target.value)}
            >
              <option value="">All survivors</option>
              {survivors.map((surv) => (
                <option key={surv.id} value={String(surv.id)}>
                  {surv.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && !filteredData ? (
        <div className="empty-card">Loading dashboard report…</div>
      ) : filteredData ? (
        <>
          <div className="dashboard-detail-summary">
            <div className="summary-card dashboard-summary-card">
              <span>Summarised expenses</span>

              <strong>{money(filteredData.total)}</strong>
            </div>

            <div className="summary-card dashboard-summary-card">
              <span>Summary rows</span>

              <strong>{filteredData.rows?.length || 0}</strong>
            </div>

            <div className="summary-card dashboard-summary-card">
              <span>Date range</span>

              <strong>{filteredData.rangeLabel}</strong>
            </div>
          </div>

          {chartData.length ? (
            <div className="card dashboard-detail-chart">
              <div className="card-title">
                <strong>
                  <BarChart3 size={17} />
                  Summary bar chart
                </strong>

                <span>{chartModel.description}</span>
              </div>

              <div className="dashboard-detail-chart-scroll">
                <div
                  className="dashboard-detail-chart-inner"
                  style={{
                    minWidth: `${chartModel.minWidth}px`,
                  }}
                >
                  {chartModel.stackedCategory ? (
                    <div className="dashboard-chart-legend">
                      {chartModel.categories.map((item) => (
                        <div className="report-chart-legend-group" key={item.label}>
                          <strong>
                            <i style={{ background: item.fill }} />
                            {item.label}
                          </strong>
                          {item.shades.map((shade) => (
                            <span key={`${item.label}-${shade.label}`}>
                              <i style={{ background: shade.fill }} />
                              {shade.label}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <ResponsiveContainer width="100%" height={380}>
                    <BarChart
                      data={chartData}
                      margin={{
                        top: 8,
                        right: 18,
                        left: 10,
                        bottom: chartModel.multiSeries ? 55 : 90,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />

                      <XAxis
                        dataKey="chartLabel"
                        angle={chartModel.multiSeries ? 0 : -35}
                        textAnchor={chartModel.multiSeries ? "middle" : "end"}
                        interval={0}
                        height={chartModel.multiSeries ? 72 : 100}
                        tick={
                          chartModel.pivotGrouping
                            ? (props) => (
                                <PivotChartTick
                                  {...props}
                                  chartData={chartData}
                                  groupBy={data.groupBy}
                                />
                              )
                            : {
                                fontSize: 10,
                              }
                        }
                      />

                      <YAxis />

                      <Tooltip
                        wrapperClassName="dashboard-detail-tooltip"
                        contentStyle={{}}
                        formatter={(value, name) => [money(value), name]}
                        labelFormatter={(label) => label}
                      />

                      {!chartModel.stackedCategory && chartModel.multiSeries ? <Legend /> : null}

                      {chartModel.series.map((series) => (
                        <Bar
                          key={series.dataKey}
                          dataKey={series.dataKey}
                          name={
                            chartModel.stackedCategory
                              ? `${series.category} • ${series.survivor}`
                              : series.label
                          }
                          fill={series.fill}
                          stackId={series.stackId}
                          barSize={chartModel.stackedCategory ? 34 : chartModel.stackedPeriodCategory ? 56 : 100}
                          cursor="pointer"
                          stroke="var(--surface)"
                          strokeWidth={2.5}
                          legendType={chartModel.stackedCategory ? "none" : undefined}
                          onClick={(entry) => {
                            const row = entry?.payload?._groupRows?.[series.dataKey];
                            if (row) {
                              openDrilldown(
                                navigate,
                                report.key,
                                filteredData.groupBy,
                                row,
                                activeFilters,
                              );
                            }
                          }}
                        >
                          <LabelList
                            dataKey={series.dataKey}
                            position="inside"
                            fill="#ffffff"
                            fontSize={9}
                            formatter={(value) =>
                              Number(value) > 0 ? `₹${Number(value).toFixed(0)}` : ""
                            }
                          />
                        </Bar>
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-card">No expenses found in this date range.</div>
          )}

          <div className="card dashboard-summary-table-card">
            <div className="card-title">
              <strong>Summarise report</strong>

              <span>Grouped by {data.groupBy?.join(", ")} · sum of expenses</span>
            </div>

            {filteredData.rows?.length ? (
              <div className="table-scroll">
                {filteredData.groupBy?.length > 1 ? (
                  <PivotSummaryTable
                    data={filteredData}
                    report={report}
                    navigate={navigate}
                    activeFilters={activeFilters}
                  />
                ) : (
                  <table className="data-table dashboard-summary-table">
                    <thead>
                      <tr>
                        {(filteredData.groupBy || []).map((column) => (
                          <th key={column}>{column}</th>
                        ))}

                        <th className="number-cell">Sum of expenses</th>
                      </tr>
                    </thead>

                    <tbody>
                      {buildMergedCells(filteredData.rows, filteredData.groupBy || []).map(
                        ({ row, rowIndex, cells }) => (
                          <tr key={`${rowIndex}-${rowLabel(row, filteredData.groupBy || [])}`}>
                            {(filteredData.groupBy || []).map((column, columnIndex) => {
                              const cell = cells[columnIndex];

                              if (cell.hidden) {
                                return null;
                              }

                              return (
                                <td
                                  key={column}
                                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                                  className={
                                    cell.rowSpan > 1 ? "dashboard-summary-merged-cell" : undefined
                                  }
                                >
                                  {prettyValue(row[column], column)}
                                </td>
                              );
                            })}

                            <td className="number-cell">
                              <button
                                type="button"
                                className="table-link-button"
                                onClick={() =>
                                  openDrilldown(
                                    navigate,
                                    report.key,
                                    filteredData.groupBy,
                                    row,
                                    activeFilters,
                                  )
                                }
                              >
                                {money(row.total)}
                              </button>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <div className="empty-card">No summary rows match the selected filters.</div>
            )}
          </div>
        </>
      ) : null}

      <Modal
        open={scheduleOpen}
        title={`Schedule ${report.label} email`}
        onClose={() => scheduleBusy || setScheduleOpen(false)}
      >
        <ScheduledReportForm
          report={report}
          recipient={user?.email}
          onSubmit={createSchedule}
          busy={scheduleBusy}
          isAdmin={user?.role === "admin"}
        />
      </Modal>
    </section>
  );
}

function PivotSummaryTable({ data, report, navigate, activeFilters }) {
  const pivot = buildPivotSummary(data.rows, data.groupBy);

  if (!pivot) return null;

  const merged = buildMergedCells(
    pivot.rows.map((item) => item.values),
    pivot.rowColumns,
  );

  return (
    <table className="data-table dashboard-summary-table dashboard-pivot-table">
      <thead>
        <tr>
          {pivot.rowColumns.map((column) => (
            <th key={column}>{column}</th>
          ))}

          {pivot.columnValues.map(({ key, value }) => (
            <th key={key} className="number-cell">
              {prettyValue(value, pivot.columnColumn)}
            </th>
          ))}

          <th className="number-cell">Total</th>
        </tr>
      </thead>

      <tbody>
        {pivot.rows.map((pivotRow, rowIndex) => {
          const cells = merged[rowIndex].cells;

          return (
            <tr key={`${rowIndex}-${pivot.rowColumns.map((c) => pivotRow.values[c]).join("-")}`}>
              {pivot.rowColumns.map((column, columnIndex) => {
                const cell = cells[columnIndex];

                if (cell.hidden) {
                  return null;
                }

                return (
                  <td
                    key={column}
                    rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                    className={cell.rowSpan > 1 ? "dashboard-summary-merged-cell" : undefined}
                  >
                    {prettyValue(pivotRow.values[column], column)}
                  </td>
                );
              })}

              {pivot.columnValues.map(({ key }) => {
                const entry = pivotRow.cells[key];

                return (
                  <td key={key} className="number-cell">
                    {entry ? (
                      <button
                        type="button"
                        className="table-link-button"
                        onClick={() => openDrilldown(navigate, report.key, data.groupBy, entry.row, activeFilters)}
                      >
                        {money(entry.total)}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              })}

              <td className="number-cell">
                <strong>{money(pivotRow.total)}</strong>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function buildChartModel(data) {
  const rows = data?.rows || [];
  const groupBy = data?.groupBy || [];

  if (groupBy.length <= 1) {
    const grouped = new Map();
    rows.forEach((row) => {
      const key = stableValueKey(row[groupBy[0]]);
      const amount = Number(row.total || 0);
      const existing = grouped.get(key);
      grouped.set(
        key,
        existing ? { ...existing, total: Number(existing.total || 0) + amount } : row,
      );
    });
    const chartRows = Array.from(grouped.values());
    return {
      multiSeries: false,
      stackedCategory: false,
      minWidth: Math.max(720, chartRows.length * 72 + 120),
      description: "Each bar represents one summary-table row.",
      data: chartRows.map((row, index) => ({
        ...row,
        chartLabel: rowLabel(row, groupBy),
        chartValue: Number(row.total || 0),
        index,
      })),
      series: [{ dataKey: "chartValue", label: "Sum of expenses", fill: "var(--accent)" }],
    };
  }

  const period = groupBy.find((column) => isDateGroup(column));
  const category = groupBy.includes("category") ? "category" : null;
  const survivor = groupBy.includes("survivor") ? "survivor" : null;
  const xColumn =
    period || groupBy.find((column) => column !== survivor && column !== category) || groupBy[0];

  if (category && survivor) {
    const categoryValues = [
      ...new Map(rows.map((row) => [String(row[category] ?? "—"), row[category]])).entries(),
    ];
    const survivorValues = [
      ...new Map(rows.map((row) => [String(row[survivor] ?? "—"), row[survivor]])).entries(),
    ];
    const palette = Array.from({ length: 8 }, (_, i) => `var(--dashboard-series-${i + 1})`);
    const survivorCount = Math.max(survivorValues.length, 1);
    const shadeFor = (categoryIndex, survivorIndex) =>
      `color-mix(in srgb, ${palette[categoryIndex % palette.length]} ${Math.round(35 + ((survivorIndex + 1) / survivorCount) * 65)}%, white)`;
    const series = [];
    categoryValues.forEach(([categoryKey, categoryValue], categoryIndex) => {
      survivorValues.forEach(([survivorKey, survivorValue]) => {
        series.push({
          dataKey: `cat_${categoryIndex}_surv_${survivorKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
          label: prettyValue(categoryValue, category),
          category: String(categoryValue ?? "—"),
          survivor: prettyValue(survivorValue, survivor),
          stackId: `category_${categoryIndex}`,
          fill: shadeFor(
            categoryIndex,
            survivorValues.findIndex(([key]) => key === survivorKey),
          ),
          legendType: "none",
        });
      });
    });
    const chartRows = new Map();
    rows.forEach((row) => {
      const xKey = stableValueKey(row[xColumn]);
      if (!chartRows.has(xKey))
        chartRows.set(xKey, {
          chartLabel: prettyValue(row[xColumn], xColumn),
          [xColumn]: row[xColumn],
          _groupRows: {},
        });
      const target = chartRows.get(xKey);
      const categoryIndex = categoryValues.findIndex(
        ([key]) => key === String(row[category] ?? "—"),
      );
      const dataKey = `cat_${categoryIndex}_surv_${String(row[survivor] ?? "—").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      target[dataKey] = Number(target[dataKey] || 0) + Number(row.total || 0);
      target._groupRows[dataKey] = row;
    });
    return {
      multiSeries: true,
      stackedCategory: true,
      pivotGrouping: false,
      minWidth: Math.max(720, chartRows.size * Math.max(categoryValues.length, 1) * 74 + 160),
      description: `${xColumn} on the X-axis; categories are the legend and survivors are stacked within each category. Click any segment to drill down.`,
      data: Array.from(chartRows.values()),
      series,
      categories: categoryValues.map(([, value], index) => ({
        label: prettyValue(value, category),
        fill: palette[index % palette.length],
        shades: survivorValues.map(([, survivorValue], survivorIndex) => ({
          label: prettyValue(survivorValue, survivor),
          fill: shadeFor(index, survivorIndex),
        })),
      })),
    };
  }

  const seriesColumn = groupBy.find((column) => column !== xColumn) || groupBy[1];
  const isPeriodStacked = seriesColumn === "category" || seriesColumn === "survivor";
  const seriesPlural = seriesColumn === "category" ? "categories" : `${seriesColumn}s`;
  const seriesMap = new Map();
  const chartRows = new Map();
  rows.forEach((row) => {
    const seriesKey = stableValueKey(row[seriesColumn]);
    if (!seriesMap.has(seriesKey)) {
      const index = seriesMap.size;
      seriesMap.set(seriesKey, {
        dataKey: `series_${index}`,
        label: prettyValue(row[seriesColumn], seriesColumn),
        fill: `var(--dashboard-series-${(index % 8) + 1})`,
        stackId: isPeriodStacked ? `${seriesColumn}_stack` : undefined,
      });
    }
    const xKey = stableValueKey(row[xColumn]);
    if (!chartRows.has(xKey))
      chartRows.set(xKey, {
        chartLabel: prettyValue(row[xColumn], xColumn),
        [xColumn]: row[xColumn],
        _groupRows: {},
      });
    const target = chartRows.get(xKey);
    const series = seriesMap.get(seriesKey);
    target[series.dataKey] = Number(target[series.dataKey] || 0) + Number(row.total || 0);
    target._groupRows[series.dataKey] = row;
  });
  return {
    multiSeries: true,
    stackedCategory: false,
    stackedPeriodCategory: isPeriodStacked,
    pivotGrouping: false,
    minWidth: isPeriodStacked
      ? Math.max(720, chartRows.size * 96 + 140)
      : Math.max(720, chartRows.size * Math.max(seriesMap.size, 1) * 60 + 140),
    description: isPeriodStacked
      ? `${xColumn} on the X-axis with ${seriesPlural} stacked by ${xColumn}. Click any segment to drill down.`
      : `${xColumn} on the X-axis with ${seriesColumn} as the legend. Click any bar to drill down.`,
    data: Array.from(chartRows.values()),
    series: Array.from(seriesMap.values()),
  };
}

function openDrilldown(navigate, reportKey, groupBy, row, activeFilters = {}) {
  const selection = {};

  for (const column of groupBy) {
    selection[column] = row[column];
  }

  if (row.category_id != null) {
    selection.category_id = row.category_id;
  } else if (activeFilters.categoryId) {
    selection.category_id = activeFilters.categoryId;
  }

  if (row.survivor_id != null) {
    selection.survivor_id = row.survivor_id;
  } else if (activeFilters.survivorId) {
    selection.survivor_id = activeFilters.survivorId;
  }

  const query = encodeURIComponent(JSON.stringify(selection));

  navigate(`/dashboard/drilldown/${reportKey}?selection=${query}`);
}
