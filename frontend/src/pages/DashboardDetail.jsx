import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { getDashboardReports } from "./Dashboard";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function prettyValue(value, column) {
  if (value == null || value === "") return "—";
  if (column === "year") return String(value);
  if (["date", "week", "month"].includes(column)) {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }
  return String(value);
}

function rowLabel(row, groupBy) {
  return groupBy.map((column) => prettyValue(row[column], column)).join(" · ");
}

function readReportKey() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[2] || "daily";
}

export default function DashboardDetail({ navigate }) {
  const reportKey = readReportKey();
  const report = getDashboardReports().find((item) => item.key === reportKey);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!report) return;
    setLoading(true);
    api("/dashboard/query", {
      method: "POST",
      body: JSON.stringify({ reportKey: report.key, mode: "summary" }),
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

  if (!report) {
    return (
      <section>
        <button className="secondary" type="button" onClick={() => navigate("/dashboard")}>
          <ArrowLeft size={17} /> Back to Dashboard
        </button>
        <div className="empty-card">Dashboard report not found.</div>
      </section>
    );
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <button className="secondary dashboard-back-button" type="button" onClick={() => navigate("/dashboard")}>
            <ArrowLeft size={17} /> Back to Dashboard
          </button>
          <h1>{report.label}</h1>
          <p>{report.help}. Click a bar or summary row to open the raw expense data.</p>
        </div>
        <button className="secondary" type="button" onClick={load} disabled={loading}>
          <RefreshCw size={17} /> Refresh
        </button>
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
                <strong><BarChart3 size={17} /> Summary bar chart</strong>
                <span>{chartModel.description}</span>
              </div>
              <div className="dashboard-detail-chart-scroll">
                <div
                  className="dashboard-detail-chart-inner"
                  style={{ minWidth: `${chartModel.minWidth}px` }}
                >
                  <ResponsiveContainer width="100%" height={380}>
                    <BarChart data={chartData} margin={{ top: 8, right: 18, left: 10, bottom: chartModel.multiSeries ? 55 : 90 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="chartLabel" angle={chartModel.multiSeries ? -20 : -35} textAnchor="end" interval={0} height={chartModel.multiSeries ? 65 : 100} tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip
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
                        barSize={40}
                        cursor="pointer"
                      onClick={(entry) => {
                        const row = entry?.payload?._groupRows?.[series.dataKey];
                        if (row) openDrilldown(navigate, report.key, data.groupBy, row);
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
                <table className="data-table dashboard-summary-table">
                  <thead>
                    <tr>
                      {(data.groupBy || []).map((column) => <th key={column}>{column}</th>)}
                      <th className="number-cell">Sum of expenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, index) => (
                      <tr key={`${index}-${rowLabel(row, data.groupBy || [])}`}>
                        {(data.groupBy || []).map((column) => (
                          <td key={column}>{prettyValue(row[column], column)}</td>
                        ))}
                        <td className="number-cell">
                          <button
                            type="button"
                            className="table-link-button"
                            onClick={() => openDrilldown(navigate, report.key, data.groupBy, row)}
                          >
                            {money(row.total)}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function buildChartModel(data) {
  const rows = data?.rows || [];
  const groupBy = data?.groupBy || [];

  if (groupBy.length <= 1) {
    return {
      multiSeries: false,
      minWidth: Math.max(720, rows.length * 72 + 120),
      description: "Each bar represents one summary-table row.",
      data: rows.map((row, index) => ({
        ...row,
        chartLabel: rowLabel(row, groupBy),
        chartValue: Number(row.total || 0),
        index,
      })),
      series: [{ dataKey: "chartValue", label: "Sum of expenses", fill: "var(--accent)" }],
    };
  }

  // With multiple group-by columns, use the first dimension as the X-axis
  // and each remaining dimension combination as a separate bar series.
  // This keeps the time/category buckets comparable and gives the chart a legend.
  const seriesMap = new Map();
  const chartRows = new Map();
  const secondaryColumns = groupBy.slice(1);

  rows.forEach((row) => {
    const xValue = prettyValue(row[groupBy[0]], groupBy[0]);
    const seriesLabel = secondaryColumns
      .map((column) => prettyValue(row[column], column))
      .join(" · ");
    const seriesIndex = seriesMap.size;
    const dataKey = `series_${seriesIndex}`;
    if (!seriesMap.has(seriesLabel)) seriesMap.set(seriesLabel, { dataKey, label: seriesLabel, fill: `var(--dashboard-series-${(seriesIndex % 8) + 1})` });

    if (!chartRows.has(xValue)) chartRows.set(xValue, { chartLabel: xValue, _groupRows: {} });
    const target = chartRows.get(xValue);
    target[dataKey] = Number(row.total || 0);
    target._groupRows[dataKey] = row;
  });

  return {
    multiSeries: true,
    minWidth: Math.max(720, chartRows.size * Math.max(secondaryColumns.length, 1) * 52 + 140),
    description: `Grouped by ${groupBy[0]} with ${secondaryColumns.join(" + ")} as the legend. Click any bar to drill down.`,
    data: Array.from(chartRows.values()),
    series: Array.from(seriesMap.values()),
  };
}

function openDrilldown(navigate, reportKey, groupBy, row) {
  const selection = {};
  for (const column of groupBy || []) {
    selection[column] = row[column];
  }
  if (row.category_id != null) selection.category_id = row.category_id;
  if (row.survivor_id != null) selection.survivor_id = row.survivor_id;
  const query = encodeURIComponent(JSON.stringify(selection));
  navigate(`/dashboard/drilldown/${reportKey}?selection=${query}`);
}
