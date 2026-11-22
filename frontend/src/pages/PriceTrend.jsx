import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw, TrendingUp } from "lucide-react";
import { api } from "../lib/api";
import { fetchLocationsWithGps } from "../lib/locationTracker";
import { formatLongDateWithWeekday } from "../utils/dates.js";

function money(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function shortDate(value) {
  if (!value) return "—";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  const [, y, m, d] = match;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12)));
}

export default function PriceTrend() {
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);

  const [locationId, setLocationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [itemId, setItemId] = useState("");
  const [unitId, setUnitId] = useState("");

  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetchLocationsWithGps({ silent: true, fastInitial: true }).catch(() => ({ locations: [] })),
      api("/meta/categories", { silent: true }).catch(() => []),
      api("/meta/units", { silent: true }).catch(() => []),
    ]).then(([locBundle, cats, unitList]) => {
      const locs = Array.isArray(locBundle?.locations) ? locBundle.locations : [];
      setLocations(locs);
      setCategories(Array.isArray(cats) ? cats : []);
      setUnits(Array.isArray(unitList) ? unitList : []);
    });
  }, []);

  useEffect(() => {
    setItemId("");
    setTrend(null);
    if (!categoryId) {
      setItems([]);
      return;
    }
    api(`/meta/items/${encodeURIComponent(categoryId)}`, { silent: true })
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch(() => setItems([]));
  }, [categoryId]);

  const fetchTrend = async () => {
    if (!categoryId || !itemId || !unitId) {
      setTrend(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        categoryId,
        itemId,
        unitId,
      });
      if (locationId) qs.set("locationId", locationId);
      const data = await api(`/price-trend?${qs.toString()}`, {
        loadingMessage: "Loading price trend…",
      });
      setTrend(data);
    } catch (e) {
      setError(e?.message || "Unable to load price trend.");
      setTrend(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (categoryId && itemId && unitId) {
      void fetchTrend();
    } else {
      setTrend(null);
    }
  }, [locationId, categoryId, itemId, unitId]);

  const chartData = useMemo(() => {
    const pts = Array.isArray(trend?.points) ? trend.points : [];
    // Points arrive sorted by date descending (at most 5 latest)
    return pts.map((pt, idx) => ({
      ...pt,
      xLabel: shortDate(pt.date),
      pointKey: `${pt.date}-${idx}`,
    }));
  }, [trend]);

  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const prices = chartData.map((p) => Number(p.unitPrice || 0));
    const latest = prices[0];
    const oldest = prices[prices.length - 1];
    const avg = prices.reduce((s, v) => s + v, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const diff = latest - oldest;
    return { latest, avg, min, max, diff };
  }, [chartData]);

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Price Trend</h1>
          <p>
            Select location, category, item, and unit to plot the 1-unit price trend for up to 5
            latest dates (newest to oldest).
          </p>
        </div>

        <button
          className="secondary"
          type="button"
          onClick={fetchTrend}
          disabled={loading || !categoryId || !itemId || !unitId}
        >
          <RefreshCw size={17} />
          Refresh
        </button>
      </div>

      <div className="card price-trend-filters">
        <label>
          Location
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">All locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Category
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Item
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            disabled={!categoryId}
          >
            <option value="">{categoryId ? "Choose item" : "Select category first"}</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Unit (1 unit price)
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Choose unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {!categoryId || !itemId || !unitId ? (
        <div className="empty-card">
          Select a Category, Item, and Unit (and optionally a Location) to view the 1-unit price
          trend.
        </div>
      ) : loading && !trend ? (
        <div className="empty-card">Loading price trend…</div>
      ) : trend && chartData.length ? (
        <>
          {stats ? (
            <div className="price-trend-kpis">
              <div className="summary-card dashboard-summary-card">
                <span>Latest 1 {trend.unitName} price</span>
                <strong>{money(stats.latest)}</strong>
              </div>
              <div className="summary-card dashboard-summary-card">
                <span>Average (last {chartData.length})</span>
                <strong>{money(stats.avg)}</strong>
              </div>
              <div className="summary-card dashboard-summary-card">
                <span>Min / Max</span>
                <strong>
                  {money(stats.min)} / {money(stats.max)}
                </strong>
              </div>
              <div className="summary-card dashboard-summary-card">
                <span>Change vs oldest shown</span>
                <strong
                  style={{
                    color:
                      stats.diff > 0
                        ? "var(--danger)"
                        : stats.diff < 0
                          ? "var(--success)"
                          : "var(--text)",
                  }}
                >
                  {stats.diff > 0 ? "+" : ""}
                  {money(stats.diff)}
                </strong>
              </div>
            </div>
          ) : null}

          <div className="card dashboard-detail-chart">
            <div className="card-title">
              <strong>
                <TrendingUp size={17} />
                1 {trend.unitName} Price Trend — {trend.itemName} ({trend.locationName})
              </strong>
              <span>Up to 5 latest prices in date descending order</span>
            </div>

            <div className="dashboard-detail-chart-scroll">
              <div className="dashboard-detail-chart-inner" style={{ minWidth: "560px" }}>
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 24, right: 30, left: 12, bottom: 24 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="xLabel" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `₹${Number(v).toFixed(0)}`}
                    />
                    <Tooltip
                      formatter={(value) => [`${money(value)} / ${trend.unitName}`, "1 unit price"]}
                      labelFormatter={(_, payload) => {
                        const pt = payload?.[0]?.payload;
                        if (!pt) return "";
                        return `${formatLongDateWithWeekday(pt.date)} · ${pt.locationName} (${pt.quantity} ${pt.unitName} = ${money(pt.totalPrice)})`;
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="unitPrice"
                      name={`Price per 1 ${trend.unitName}`}
                      stroke="var(--primary)"
                      strokeWidth={3}
                      dot={{ r: 5, fill: "var(--primary)", strokeWidth: 2, stroke: "var(--card)" }}
                      activeDot={{ r: 7 }}
                    >
                      <LabelList
                        dataKey="unitPrice"
                        position="top"
                        offset={10}
                        fill="var(--text)"
                        fontSize={11}
                        formatter={(v) => `₹${Number(v).toFixed(2)}`}
                      />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <strong>Latest {chartData.length} Price Records (Date Descending)</strong>
              <span>Normalized to 1 {trend.unitName}</span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Location</th>
                    <th className="number-cell">Purchased Qty</th>
                    <th className="number-cell">Total Price</th>
                    <th className="number-cell">1 {trend.unitName} Price</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((row) => (
                    <tr key={row.id}>
                      <td>{formatLongDateWithWeekday(row.date)}</td>
                      <td>{row.locationName}</td>
                      <td className="number-cell">
                        {row.quantity} {row.unitName}
                      </td>
                      <td className="number-cell">{money(row.totalPrice)}</td>
                      <td className="number-cell">
                        <strong>{money(row.unitPrice)}</strong>
                      </td>
                      <td>{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="empty-card">
          No matching price records found for this item and unit
          {locationId ? " at the selected location" : ""}.
        </div>
      )}
    </section>
  );
}
