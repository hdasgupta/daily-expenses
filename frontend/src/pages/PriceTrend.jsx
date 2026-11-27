import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { LocateFixed, RefreshCw, RotateCcw, TrendingUp } from "lucide-react";
import { api } from "../lib/api";
import {
  describeAutoMatchReason,
  fetchLocationsWithGps,
  formatLocationOptionLabel,
  getCurrentGpsPosition,
  isValidCoordinates,
  pickBestLocation,
} from "../lib/locationTracker";
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

function prefStorageKey(userId) {
  return `price_trend_prefs:${userId || "anon"}`;
}

function readCachedPrefs(userId) {
  try {
    const raw = localStorage.getItem(prefStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      locationId: String(parsed.locationId || ""),
      categoryId: String(parsed.categoryId || ""),
      itemId: String(parsed.itemId || ""),
      unitId: String(parsed.unitId || ""),
    };
  } catch {
    return null;
  }
}

function writeCachedPrefs(userId, prefs) {
  try {
    localStorage.setItem(prefStorageKey(userId), JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

export default function PriceTrend({ user }) {
  const initialCached = useMemo(() => readCachedPrefs(user?.id), [user?.id]);

  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);

  const [locationId, setLocationId] = useState(() => initialCached?.locationId || "");
  const [categoryId, setCategoryId] = useState(() => initialCached?.categoryId || "");
  const [itemId, setItemId] = useState(() => initialCached?.itemId || "");
  const [unitId, setUnitId] = useState(() => initialCached?.unitId || "");

  const [currentCoords, setCurrentCoords] = useState(null);
  const [autoLocationHint, setAutoLocationHint] = useState("");
  const [detectingGps, setDetectingGps] = useState(false);

  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const prefsHydratedRef = useRef(false);
  const userChoseLocationRef = useRef(Boolean(initialCached?.locationId));
  const pendingRestoredItemIdRef = useRef(initialCached?.itemId || "");
  const saveTimerRef = useRef(null);

  // Initial metadata + saved user preferences + nearest GPS location
  useEffect(() => {
    let cancelled = false;
    prefsHydratedRef.current = false;

    Promise.all([
      fetchLocationsWithGps({ silent: true, fastInitial: true }).catch(() => ({ locations: [] })),
      api("/meta/categories", { silent: true }).catch(() => []),
      api("/meta/units", { silent: true }).catch(() => []),
      api("/price-trend/preferences", { silent: true }).catch(() => ({ preferences: null })),
    ]).then(([locBundle, cats, unitList, prefRes]) => {
      if (cancelled) return;
      const locs = Array.isArray(locBundle?.locations) ? locBundle.locations : [];
      setLocations(locs);
      setCategories(Array.isArray(cats) ? cats : []);
      setUnits(Array.isArray(unitList) ? unitList : []);
      if (isValidCoordinates(locBundle?.coords)) {
        setCurrentCoords(locBundle.coords);
      }

      const saved = prefRes?.preferences || readCachedPrefs(user?.id);
      if (saved && (saved.locationId || saved.categoryId || saved.itemId || saved.unitId)) {
        if (saved.locationId) {
          userChoseLocationRef.current = true;
          setLocationId(saved.locationId);
        } else if (locBundle?.bestLocation) {
          setLocationId(String(locBundle.bestLocation.id));
          setAutoLocationHint(describeAutoMatchReason(locBundle.bestLocation));
        }
        if (saved.categoryId) {
          pendingRestoredItemIdRef.current = saved.itemId || "";
          setCategoryId(saved.categoryId);
        }
        if (saved.itemId) setItemId(saved.itemId);
        if (saved.unitId) setUnitId(saved.unitId);
        writeCachedPrefs(user?.id, saved);
      } else if (locBundle?.bestLocation) {
        setLocationId(String(locBundle.bestLocation.id));
        setAutoLocationHint(describeAutoMatchReason(locBundle.bestLocation));
      }

      prefsHydratedRef.current = true;

      // Refine with live GPS in background if user hasn't manually locked a location
      if (!userChoseLocationRef.current) {
        getCurrentGpsPosition({ timeout: 6000 })
          .then(async (liveCoords) => {
            if (cancelled || !isValidCoordinates(liveCoords)) return;
            setCurrentCoords(liveCoords);
            try {
              const refreshed = await fetchLocationsWithGps({ coords: liveCoords, silent: true });
              if (cancelled) return;
              if (Array.isArray(refreshed?.locations) && refreshed.locations.length) {
                setLocations(refreshed.locations);
                if (!userChoseLocationRef.current && refreshed.bestLocation) {
                  setLocationId(String(refreshed.bestLocation.id));
                  setAutoLocationHint(describeAutoMatchReason(refreshed.bestLocation));
                }
              }
            } catch {
              const localRefined = pickBestLocation(locs, liveCoords);
              if (!cancelled && localRefined.bestLocation && !userChoseLocationRef.current) {
                setLocations(localRefined.locations);
                setLocationId(String(localRefined.bestLocation.id));
                setAutoLocationHint(describeAutoMatchReason(localRefined.bestLocation));
              }
            }
          })
          .catch(() => {});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Persist selections per user whenever they change after hydration
  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    const payload = { locationId, categoryId, itemId, unitId };
    writeCachedPrefs(user?.id, payload);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api("/price-trend/preferences", {
        method: "PUT",
        body: JSON.stringify(payload),
        silent: true,
      }).catch(() => {});
    }, 250);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [locationId, categoryId, itemId, unitId, user?.id]);

  // Load items when category changes (preserving restored itemId if applicable)
  useEffect(() => {
    let cancelled = false;
    if (!categoryId) {
      setItems([]);
      setItemId("");
      setTrend(null);
      return undefined;
    }

    const expectedItemId = pendingRestoredItemIdRef.current;
    pendingRestoredItemIdRef.current = "";

    const qs = new URLSearchParams({ categoryId: String(categoryId) });
    if (locationId) qs.set("locationId", String(locationId));

    api(`/price-trend/items?${qs.toString()}`, { silent: true })
      .then((list) => {
        if (cancelled) return;
        const arr = Array.isArray(list) ? list : [];
        setItems(arr);
        if (expectedItemId && arr.some((i) => String(i.id) === String(expectedItemId))) {
          setItemId(String(expectedItemId));
        } else if (itemId && !arr.some((i) => String(i.id) === String(itemId))) {
          setItemId("");
          setUnitId("");
        }
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [categoryId, locationId]);

  const selectSmartUnitForItem = async (targetItemId, targetCategoryId, targetLocationId) => {
    if (!targetItemId) return;
    try {
      const qs = new URLSearchParams({ itemId: String(targetItemId) });
      if (targetCategoryId) qs.set("categoryId", String(targetCategoryId));
      if (targetLocationId) qs.set("locationId", String(targetLocationId));
      const res = await api(`/price-trend/smart-unit?${qs.toString()}`, { silent: true });
      if (res?.unitId) {
        setUnitId(String(res.unitId));
      }
    } catch {
      // Ignore smart-unit lookup errors
    }
  };

  const handleCategoryChange = (nextCategoryId) => {
    pendingRestoredItemIdRef.current = "";
    setCategoryId(nextCategoryId);
    setItemId("");
    setTrend(null);
  };

  const handleItemChange = (nextItemId) => {
    setItemId(nextItemId);
    setTrend(null);
    if (nextItemId) {
      void selectSmartUnitForItem(nextItemId, categoryId, locationId);
    }
  };

  const handleAutoDetectLocation = async () => {
    setDetectingGps(true);
    try {
      const coords = await getCurrentGpsPosition({
        timeout: 8000,
        maximumAge: 0,
        enableHighAccuracy: true,
      });
      setCurrentCoords(coords);
      const refreshed = await fetchLocationsWithGps({ coords, silent: true });
      const locList = Array.isArray(refreshed?.locations) ? refreshed.locations : locations;
      setLocations(locList);
      const best = refreshed?.bestLocation || pickBestLocation(locList, coords).bestLocation;
      if (best) {
        userChoseLocationRef.current = false;
        setLocationId(String(best.id));
        setAutoLocationHint(describeAutoMatchReason(best));
      }
    } catch {
      const fallback = pickBestLocation(locations, currentCoords);
      if (fallback?.bestLocation) {
        setLocations(fallback.locations);
        setLocationId(String(fallback.bestLocation.id));
        setAutoLocationHint(describeAutoMatchReason(fallback.bestLocation));
      }
    } finally {
      setDetectingGps(false);
    }
  };

  const handleReset = async () => {
    pendingRestoredItemIdRef.current = "";
    userChoseLocationRef.current = false;
    setCategoryId("");
    setItemId("");
    setUnitId("");
    setItems([]);
    setTrend(null);
    setError("");
    setAutoLocationHint("");

    let nextLocId = "";
    setDetectingGps(true);
    try {
      const coords = await getCurrentGpsPosition({
        timeout: 6000,
        maximumAge: 0,
        enableHighAccuracy: true,
      });
      setCurrentCoords(coords);
      const refreshed = await fetchLocationsWithGps({ coords, silent: true });
      const locList = Array.isArray(refreshed?.locations) ? refreshed.locations : locations;
      setLocations(locList);
      const best = refreshed?.bestLocation || pickBestLocation(locList, coords).bestLocation;
      if (best) {
        nextLocId = String(best.id);
        setAutoLocationHint(describeAutoMatchReason(best));
      }
    } catch {
      const fallback = pickBestLocation(locations, currentCoords);
      if (fallback?.bestLocation) {
        setLocations(fallback.locations);
        nextLocId = String(fallback.bestLocation.id);
        setAutoLocationHint(describeAutoMatchReason(fallback.bestLocation));
      }
    } finally {
      setLocationId(nextLocId);
      setDetectingGps(false);
    }
  };

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
            Select location, category, item, and unit to plot the 1-unit approximate price trend for
            up to 5 latest dates (newest to oldest).
          </p>
        </div>

        <div className="toolbar-actions">
          <button
            className="secondary"
            type="button"
            onClick={handleReset}
            disabled={detectingGps}
            title="Reset selections and auto-detect nearest GPS location"
          >
            <RotateCcw size={16} />
            {detectingGps ? "Resetting…" : "Reset"}
          </button>

          <button
            className="secondary"
            type="button"
            onClick={fetchTrend}
            disabled={loading || !categoryId || !itemId || !unitId}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <div className="card price-trend-filters">
        <label>
          <span className="location-label-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
            <span>Location</span>
            <button
              type="button"
              className="secondary"
              style={{ padding: "2px 7px", fontSize: 11 }}
              onClick={handleAutoDetectLocation}
              disabled={detectingGps || !locations.length}
              title="Auto-select nearest GPS location"
            >
              <LocateFixed size={12} />
              {detectingGps ? "Locating…" : "Auto GPS"}
            </button>
          </span>
          <select
            value={locationId}
            onChange={(e) => {
              userChoseLocationRef.current = Boolean(e.target.value);
              setAutoLocationHint("");
              setLocationId(e.target.value);
            }}
          >
            <option value="">All locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {formatLocationOptionLabel(loc)}
              </option>
            ))}
          </select>
          {autoLocationHint ? (
            <small className="field-note" style={{ color: "var(--primary)" }}>
              {autoLocationHint}
            </small>
          ) : null}
        </label>

        <label>
          Category
          <select value={categoryId} onChange={(e) => handleCategoryChange(e.target.value)}>
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
            onChange={(e) => handleItemChange(e.target.value)}
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
          Select a Category, Item, and Unit (and optionally a Location) to view the 1-unit
          approximate price trend.
        </div>
      ) : loading && !trend ? (
        <div className="empty-card">Loading price trend…</div>
      ) : trend && chartData.length ? (
        <>
          {stats ? (
            <div className="price-trend-kpis">
              <div className="summary-card dashboard-summary-card">
                <span>Latest 1 {trend.unitName} approx. price</span>
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
                      formatter={(value) => [
                        `${money(value)} / ${trend.unitName}`,
                        "1 unit approx. price",
                      ]}
                      labelFormatter={(_, payload) => {
                        const pt = payload?.[0]?.payload;
                        if (!pt) return "";
                        return `${formatLongDateWithWeekday(pt.date)} · ${pt.locationName} (${pt.quantity} ${pt.unitName} = ${money(pt.totalPrice)})`;
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="unitPrice"
                      name={`Approx. price per 1 ${trend.unitName}`}
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
                    <th className="number-cell">Quantity</th>
                    <th className="number-cell">Approx. Price</th>
                    <th className="number-cell">1 {trend.unitName} Approx. Price</th>
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
          No matching approximate price records found for this item and unit
          {locationId ? " at the selected location" : ""}.
        </div>
      )}
    </section>
  );
}
