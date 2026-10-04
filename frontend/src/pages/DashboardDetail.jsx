import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, CalendarClock, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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

function readReportKey() {
  const parts = window.location.pathname.split("/").filter(Boolean);

  return parts[2] || "daily";
}

export default function DashboardDetail({ navigate, user }) {
  const reportKey = readReportKey();

  const report = getDashboardReports().find((item) => item.key === reportKey);

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [scheduleBusy, setScheduleBusy] = useState(false);

  const canSchedule = user?.permissions?.includes("job-status");

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
    load();
  }, [reportKey]);

  const chartModel = useMemo(() => buildChartModel(data), [data]);

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

      {loading && !data ? (
        <div className="empty-card">Loading dashboard report…</div>
      ) : data ? (
        <>
          <div className="dashboard-detail-summary">
            <div className="summary-card dashboard-summary-card">
              <span>Summarised expenses</span>

              <strong>{money(data.total)}</strong>
            </div>

            <div className="summary-card dashboard-summary-card">
              <span>Summary rows</span>

              <strong>{data.rows?.length || 0}</strong>
            </div>

            <div className="summary-card dashboard-summary-card">
              <span>Date range</span>

              <strong>{data.rangeLabel}</strong>
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
                        angle={chartModel.multiSeries ? -20 : -35}
                        textAnchor="end"
                        interval={0}
                        height={chartModel.multiSeries ? 65 : 100}
                        tick={{
                          fontSize: 10,
                        }}
                      />

                      <YAxis />

                      <Tooltip
                        wrapperClassName="dashboard-detail-tooltip"
                        contentStyle={{}}
                        formatter={(value, name) => [money(value), name]}
                        labelFormatter={(label) => label}
                      />

                      {chartModel.multiSeries ? <Legend /> : null}

                      {chartModel.series.map((series) => (
                        <Bar
                          key={series.dataKey}
                          dataKey={series.dataKey}
                          name={series.label}
                          fill={series.fill}
                          barSize={100}
                          cursor="pointer"
                          onClick={(entry) => {
                            const row = entry?.payload?._groupRows?.[series.dataKey];

                            if (row) {
                              openDrilldown(navigate, report.key, data.groupBy, row);
                            }
                          }}
                        />
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

            {data.rows?.length ? (
              <div className="table-scroll">
                {data.groupBy?.length > 1 ? (
                  <PivotSummaryTable data={data} report={report} navigate={navigate} />
                ) : (
                  <table className="data-table dashboard-summary-table">
                    <thead>
                      <tr>
                        {(data.groupBy || []).map((column) => (
                          <th key={column}>{column}</th>
                        ))}

                        <th className="number-cell">Sum of expenses</th>
                      </tr>
                    </thead>

                    <tbody>
                      {buildMergedCells(data.rows, data.groupBy || []).map(
                        ({ row, rowIndex, cells }) => (
                          <tr key={`${rowIndex}-${rowLabel(row, data.groupBy || [])}`}>
                            {(data.groupBy || []).map((column, columnIndex) => {
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
                                  openDrilldown(navigate, report.key, data.groupBy, row)
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
            ) : null}
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
        />
      </Modal>
    </section>
  );
}

function PivotSummaryTable({ data, report, navigate }) {
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
                        onClick={() => openDrilldown(navigate, report.key, data.groupBy, entry.row)}
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

  /*
   * Existing single-group behaviour.
   *
   * One Group By field:
   *   Group 1 -> X-axis
   *   Total   -> bar value
   */
  if (groupBy.length <= 1) {
    const grouped = new Map();

    rows.forEach((row) => {
      const key = stableValueKey(row[groupBy[0]]);

      const existing = grouped.get(key);

      const amount = Number(row.total || 0);

      grouped.set(
        key,
        existing
          ? {
              ...existing,
              total: Number(existing.total || 0) + amount,
            }
          : row,
      );
    });

    const chartRows = Array.from(grouped.values());

    return {
      multiSeries: false,

      minWidth: Math.max(720, chartRows.length * 72 + 120),

      description: "Each bar represents one summary-table row.",

      data: chartRows.map((row, index) => ({
        ...row,
        chartLabel: rowLabel(row, groupBy),
        chartValue: Number(row.total || 0),
        index,
      })),

      series: [
        {
          dataKey: "chartValue",
          label: "Sum of expenses",
          fill: "var(--accent)",
        },
      ],
    };
  }

  const seriesMap = new Map();

  const chartRows = new Map();

  /*
   * Three Group By fields are rendered as a
   * pivot-style grouped bar chart:
   *
   *   Group 1 + Group 2 -> X-axis categories
   *   Group 3           -> bar series / legend
   *
   * Example:
   *
   *   Year + Category -> X-axis
   *   Payment Method  -> grouped bars
   *
   * This keeps all three dimensions visible
   * instead of combining Group 2 + Group 3 into
   * one legend label.
   *
   * For two Group By fields, the existing behaviour
   * is retained:
   *
   *   Group 1 -> X-axis
   *   Group 2 -> bar series / legend
   */
  const isThreeGroupPivot = groupBy.length === 3;

  const xColumns = isThreeGroupPivot ? groupBy.slice(0, 2) : [groupBy[0]];

  const seriesColumns = isThreeGroupPivot ? [groupBy[2]] : groupBy.slice(1);

  rows.forEach((row) => {
    /*
     * For three groups:
     *
     *   X key = Group 1 + Group 2
     *
     * This means each combination receives its
     * own grouped-bar category on the X-axis.
     */
    const xKey = xColumns.map((column) => stableValueKey(row[column])).join("\u001f");

    const xValue = xColumns.map((column) => prettyValue(row[column], column)).join(" · ");

    /*
     * For three groups:
     *
     *   Series = Group 3
     *
     * For two groups this remains:
     *
     *   Series = Group 2
     */
    const seriesLabel = seriesColumns.map((column) => prettyValue(row[column], column)).join(" · ");

    let series = seriesMap.get(seriesLabel);

    if (!series) {
      const seriesIndex = seriesMap.size;

      series = {
        dataKey: `series_${seriesIndex}`,
        label: seriesLabel,
        fill: `var(--dashboard-series-${(seriesIndex % 8) + 1})`,
      };

      seriesMap.set(seriesLabel, series);
    }

    if (!chartRows.has(xKey)) {
      chartRows.set(xKey, {
        chartLabel: xValue,
        _groupRows: {},
      });
    }

    const target = chartRows.get(xKey);

    target[series.dataKey] = Number(target[series.dataKey] || 0) + Number(row.total || 0);

    /*
     * Keep the original summary row so clicking
     * a bar still opens the correct drill-down.
     */
    if (!target._groupRows[series.dataKey]) {
      target._groupRows[series.dataKey] = row;
    }
  });

  return {
    multiSeries: true,

    minWidth: Math.max(
      720,
      chartRows.size * Math.max(seriesMap.size, 1) * (isThreeGroupPivot ? 58 : 52) + 140,
    ),

    description: isThreeGroupPivot
      ? `Pivot chart: ${groupBy[0]} × ${groupBy[1]}, grouped by ${groupBy[2]}. Click any bar to drill down.`
      : `Grouped by ${groupBy[0]} with ${seriesColumns.join(
          " + ",
        )} as the legend. Click any bar to drill down.`,

    data: Array.from(chartRows.values()),

    series: Array.from(seriesMap.values()),
  };
}

function openDrilldown(navigate, reportKey, groupBy, row) {
  const selection = {};

  for (const column of groupBy) {
    selection[column] = row[column];
  }

  if (row.category_id != null) {
    selection.category_id = row.category_id;
  }

  if (row.survivor_id != null) {
    selection.survivor_id = row.survivor_id;
  }

  const query = encodeURIComponent(JSON.stringify(selection));

  navigate(`/dashboard/drilldown/${reportKey}?selection=${query}`);
}
