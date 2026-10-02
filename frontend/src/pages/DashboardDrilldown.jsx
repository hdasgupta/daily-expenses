import React, { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api } from "../lib/api";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}
function dateValue(value) {
  if (!value) return "—";
  const raw = String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  const [, year, month, day] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > 31) return raw;
  const date = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay, 12));
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
function readRoute() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return { reportKey: parts[2], selection: new URLSearchParams(window.location.search).get("selection") };
}

export default function DashboardDrilldown({ navigate }) {
  const { reportKey, selection: encoded } = readRoute();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let selection = {};
    try { selection = encoded ? JSON.parse(encoded) : {}; } catch { selection = {}; }
    api("/dashboard/query", {
      method: "POST",
      body: JSON.stringify({ reportKey, mode: "drilldown", selection }),
      loadingMessage: "Loading dashboard drilldown…",
    })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [reportKey, encoded]);

  return (
    <section>
      <div className="page-heading">
        <div>
          <button className="secondary dashboard-back-button" type="button" onClick={() => navigate(`/dashboard/report/${reportKey}`)}>
            <ArrowLeft size={17} /> Back to Dashboard Detail
          </button>
          <h1>Dashboard Drilldown</h1>
          <p>Raw expense rows corresponding to the selected dashboard summary.</p>
        </div>
      </div>

      {loading ? <div className="empty-card">Loading matching expense data…</div> : null}
      {!loading && data ? (
        <div className="card dashboard-drilldown-card">
          <div className="card-title">
            <strong>{data.title}</strong>
            <span>{data.rows?.length || 0} raw row(s) · total expense {money(data.total)}</span>
          </div>
          {data.rows?.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Category</th><th>Item</th><th>Survivor</th>
                    <th>Expense type</th><th className="number-cell">Expense</th>
                    <th className="number-cell">Share</th><th>Comment</th><th>Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => (
                    <tr key={`${row.expense_id || row.id || index}-${index}`}>
                      <td>{dateValue(row.expense_date)}</td>
                      <td>{row.category || "—"}</td>
                      <td>{row.item || "—"}</td>
                      <td>{row.survivor || "—"}</td>
                      <td>{row.expense_type || "—"}</td>
                      <td className="number-cell">{money(row.total_cost)}</td>
                      <td className="number-cell">{row.share_price == null ? "—" : money(row.share_price)}</td>
                      <td>{row.comment || "—"}</td>
                      <td>{row.proof_url ? <a href={row.proof_url} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-card">No matching expense data.</div>}
        </div>
      ) : null}
    </section>
  );
}
