import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge, RefreshCw, X } from "lucide-react";
import { api } from "../lib/api";
import Modal from "../components/Modal";
import { formatDateKolkata } from "../utils/dates.js";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}
function periodTotal(rows) {
  return rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
}
function datePlusDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
function rangeFor(unit, label) {
  if (unit === "day") return { dateFilterType: "date", filters: { date: label } };
  if (unit === "week")
    return {
      dateFilterType: "range",
      filters: { dateFrom: label, dateTo: datePlusDays(label, 6) },
    };
  if (unit === "month") return { dateFilterType: "month", filters: { month: label.slice(0, 7) } };
  return { dateFilterType: "year", filters: { year: label.slice(0, 4) } };
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const load = () =>
    api("/dashboard/overview", {
      loadingMessage: "Loading dashboard…",
      toast: { type: "success", message: "Dashboard refreshed." },
    })
      .then(setData)
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
  const currentBreakdowns = useMemo(() => {
    if (!data) return {};
    const map = {};
    for (const unit of ["daily", "weekly", "monthly", "yearly"]) {
      for (const type of ["Category", "Survivor"]) {
        const rows = data.breakdowns?.[`${unit}${type}`] || [];
        const latest = rows.reduce(
          (max, row) => (String(row.label) > String(max) ? row.label : max),
          "",
        );
        map[`${unit}${type}`] = rows.filter((row) => row.label === latest);
      }
    }
    return map;
  }, [data]);
  const openTrend = async (unit, row) => {
    const selection = rangeFor(unit, row.label);
    const cfg = {
      activeFilters: ["date"],
      ...selection,
      filters: {
        date: "",
        dateFrom: "",
        dateTo: "",
        month: "",
        year: "",
        hasProof: "",
        categoryItems: [],
        survivors: [],
        ...selection.filters,
      },
      sortColumns: [{ column: "date", direction: "asc" }],
      groupBy: [],
      summarise: false,
    };
    setDetail({ title: `${unit} expenses for ${row.label}`, loading: true, rows: [] });
    try {
      const result = await api("/reports/query", {
        method: "POST",
        body: JSON.stringify(cfg),
        loadingMessage: "Loading dashboard details…",
      });
      setDetail({
        title: `${unit} expenses for ${row.label}`,
        loading: false,
        rows: result.rows || [],
      });
    } catch {
      setDetail({ title: `${unit} expenses for ${row.label}`, loading: false, rows: [] });
    }
  };
  const openBreakdown = async (row) => {
    const base = rangeFor(row.unit, row.label);
    const cfg = {
      activeFilters: ["date"],
      ...base,
      filters: {
        date: "",
        dateFrom: "",
        dateTo: "",
        month: "",
        year: "",
        hasProof: "",
        categoryItems: [],
        survivors: [],
        ...base.filters,
      },
      sortColumns: [{ column: "date", direction: "asc" }],
      groupBy: [],
      summarise: false,
    };
    if (row.by === "category")
      (cfg.activeFilters.push("categoryItems"),
        (cfg.filters.categoryItems = [`${row.entityId}:total`]));
    else (cfg.activeFilters.push("survivors"), (cfg.filters.survivors = [String(row.entityId)]));
    setDetail({ title: `${row.name} · ${row.label}`, loading: true, rows: [] });
    try {
      const result = await api("/reports/query", {
        method: "POST",
        body: JSON.stringify(cfg),
        loadingMessage: "Loading dashboard details…",
      });
      setDetail({ title: `${row.name} · ${row.label}`, loading: false, rows: result.rows || [] });
    } catch {
      setDetail({ title: `${row.name} · ${row.label}`, loading: false, rows: [] });
    }
  };
  if (!data)
    return (
      <div className="empty-card">
        <Gauge size={30} />
        <span>Dashboard is loading or unavailable.</span>
      </div>
    );
  const trendCards = [
    ["day", "Daily · last 7 days", data.periods.daily],
    ["week", "Weekly · last 4 weeks", data.periods.weekly],
    ["month", "Monthly · last 3 months", data.periods.monthly],
    ["year", "Yearly · last 2 years", data.periods.yearly],
  ];
  const breakdownCards = [
    ["dailyCategory", "Category-wise daily"],
    ["dailySurvivor", "Survivor-wise daily"],
    ["weeklyCategory", "Category-wise weekly"],
    ["weeklySurvivor", "Survivor-wise weekly"],
    ["monthlyCategory", "Category-wise monthly"],
    ["monthlySurvivor", "Survivor-wise monthly"],
    ["yearlyCategory", "Category-wise yearly"],
    ["yearlySurvivor", "Survivor-wise yearly"],
  ];
  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Dashboard</h1>
          <p>Predefined summaries with chart drill-down. Dashboard summaries are always enabled.</p>
        </div>
        <button className="secondary" type="button" onClick={load}>
          <RefreshCw size={17} /> Refresh
        </button>
      </div>
      <div className="dashboard-summary-grid">
        <SummaryCard title="Daily · last 7 days" value={periodTotal(data.periods.daily)} />
        <SummaryCard title="Weekly · last 4 weeks" value={periodTotal(data.periods.weekly)} />
        <SummaryCard title="Monthly · last 3 months" value={periodTotal(data.periods.monthly)} />
        <SummaryCard title="Yearly · last 2 years" value={periodTotal(data.periods.yearly)} />
      </div>
      <div className="dashboard-chart-grid">
        {trendCards.map(([unit, title, rows]) => (
          <TrendCard
            key={unit}
            title={title}
            data={rows}
            onBarClick={(row) => openTrend(unit, row)}
          />
        ))}
      </div>
      <div className="section-title dashboard-section-title">
        <Gauge size={19} /> Category / survivor-wise summaries · latest period
      </div>
      <div className="dashboard-chart-grid">
        {breakdownCards.map(([key, title]) => (
          <TrendCard
            key={key}
            title={title}
            data={currentBreakdowns[key] || []}
            onBarClick={openBreakdown}
          />
        ))}
      </div>
      <div className="notice">
        Summarise: <strong>On</strong>. The scheduled job sends the dashboard as a PDF through the
        configured HTTP email API to active manager users.
      </div>
      <Modal
        open={Boolean(detail)}
        title={detail?.title || "Dashboard details"}
        onClose={() => setDetail(null)}
        footer={
          <button className="secondary" type="button" onClick={() => setDetail(null)}>
            <X size={17} /> Close
          </button>
        }
      >
        {detail?.loading ? (
          <div className="empty-card">Loading matching expense data…</div>
        ) : detail?.rows?.length ? (
          <div className="list-stack">
            {detail.rows.map((row, index) => (
              <article className="list-card" key={`${row.id}-${index}`}>
                <div className="list-main">
                  <strong>
                    {row.category} · {row.item}
                  </strong>
                  <span>
                    {formatDateKolkata(row.expense_date)} · {row.expense_type}
                  </span>
                  {row.survivor ? <span>Survivor: {row.survivor}</span> : null}
                  <span>
                    {row.report_amount !== undefined && row.report_amount !== null
                      ? `Share: ${money(row.report_amount)}`
                      : `Expense: ${money(row.total_cost)}`}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-card">No matching expense data.</div>
        )}
      </Modal>
    </section>
  );
}
function SummaryCard({ title, value }) {
  return (
    <div className="summary-card dashboard-summary-card">
      <span>{title}</span>
      <strong>{money(value)}</strong>
    </div>
  );
}
function TrendCard({ title, data, onBarClick }) {
  return (
    <div className="card dashboard-chart-card">
      <div className="card-title">
        <strong>{title}</strong>
        <span>Click a bar for corresponding data</span>
      </div>
      <ResponsiveContainer width="100%" height={290}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis />
          <Tooltip formatter={(value) => money(value)} />
          <Bar
            dataKey="total"
            fill="var(--accent)"
            onClick={(entry) => onBarClick?.(entry?.payload || entry)}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
