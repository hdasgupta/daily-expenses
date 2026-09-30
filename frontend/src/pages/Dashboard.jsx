import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
export default function Dashboard() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10),
      from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    api(`/reports/data?from=${from}&to=${to}`).then(setRows);
  }, []);
  const data = Object.values(
    rows.reduce((a, r) => {
      const d = r.expense_date.slice(0, 10);
      a[d] ??= { name: d, total: 0 };
      a[d].total += Number(r.total_cost);
      return a;
    }, {}),
  );
  return (
    <section>
      <h2>Dashboard</h2>
      <div className="stats">
        <div>
          <small>Last 7 days</small>
          <b>₹{data.reduce((a, x) => a + x.total, 0).toFixed(2)}</b>
        </div>
        <div>
          <small>Expenses recorded</small>
          <b>{rows.length}</b>
        </div>
      </div>
      <div className="card chart">
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={data}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="total" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
