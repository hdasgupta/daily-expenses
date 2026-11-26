import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, LocateFixed, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import {
  describeAutoMatchReason,
  fetchLocationsWithGps,
  formatLocationOptionLabel,
  getCurrentGpsPosition,
  isValidCoordinates,
  pickBestLocation,
} from "../lib/locationTracker";

function formatAmount(value, unitName = "") {
  const num = Number(value || 0);
  const formatted = Number.isInteger(num) ? String(num) : num.toFixed(2);
  return unitName ? `${formatted} ${unitName}` : formatted;
}

function prefStorageKey(userId) {
  return `order_frequency_prefs:${userId || "anon"}`;
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

export default function OrderFrequency({ user }) {
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

  const [data, setData] = useState(null);
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
      api("/order-frequency/preferences", { silent: true }).catch(() => ({ preferences: null })),
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
        } else if (locs.length) {
          const best = pickBestLocation(locs);
          if (best) {
            setLocationId(String(best.id));
            setAutoLocationHint(describeAutoMatchReason(best));
          }
        }
        if (saved.categoryId) {
          pendingRestoredItemIdRef.current = saved.itemId || "";
          setCategoryId(saved.categoryId);
        }
        if (saved.unitId) {
          setUnitId(saved.unitId);
        }
      } else if (locs.length && !userChoseLocationRef.current) {
        const best = pickBestLocation(locs);
        if (best) {
          setLocationId(String(best.id));
          setAutoLocationHint(describeAutoMatchReason(best));
        }
      }

      prefsHydratedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Background GPS refinement when no saved/user-selected location
  useEffect(() => {
    let cancelled = false;
    if (userChoseLocationRef.current) return undefined;

    getCurrentGpsPosition({ timeout: 5000 }).then((coords) => {
      if (cancelled || !isValidCoordinates(coords) || userChoseLocationRef.current) return;
      setCurrentCoords(coords);
      fetchLocationsWithGps({ coords, silent: true })
        .then((bundle) => {
          if (cancelled || userChoseLocationRef.current) return;
          const locs = Array.isArray(bundle?.locations) ? bundle.locations : [];
          if (locs.length) {
            setLocations(locs);
            const best = pickBestLocation(locs);
            if (best) {
              setLocationId(String(best.id));
              setAutoLocationHint(describeAutoMatchReason(best));
            }
          }
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load items when category changes
  useEffect(() => {
    let cancelled = false;
    if (!categoryId) {
      setItems([]);
      setItemId("");
      return undefined;
    }

    api(`/meta/items/${categoryId}`, { silent: true })
      .then((list) => {
        if (cancelled) return;
        const arr = Array.isArray(list) ? list : [];
        setItems(arr);

        const pendingId = pendingRestoredItemIdRef.current;
        pendingRestoredItemIdRef.current = "";
        if (pendingId && arr.some((it) => String(it.id) === String(pendingId))) {
          setItemId(String(pendingId));
        } else if (!arr.some((it) => String(it.id) === String(itemId))) {
          setItemId("");
        }
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  // Auto-select smart unit when item changes (if no unit is already chosen)
  useEffect(() => {
    let cancelled = false;
    if (!itemId) return undefined;

    if (unitId) return undefined;

    const qs = new URLSearchParams({ itemId: String(itemId) });
    if (locationId) qs.set("locationId", String(locationId));
    if (categoryId) qs.set("categoryId", String(categoryId));

    api(`/price-trend/smart-unit?${qs.toString()}`, { silent: true })
      .then((res) => {
        if (cancelled || !res?.unitId) return;
        setUnitId(String(res.unitId));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [itemId, categoryId, locationId]);

  // Persist preferences per user
  useEffect(() => {
    if (!prefsHydratedRef.current) return undefined;
    const payload = { locationId, categoryId, itemId, unitId };
    writeCachedPrefs(user?.id, payload);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api("/order-frequency/preferences", {
        method: "PUT",
        body: JSON.stringify(payload),
        silent: true,
        silentToast: true,
      }).catch(() => {});
    }, 350);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [locationId, categoryId, itemId, unitId, user?.id]);

  // Fetch order frequency whenever category, item, unit, or location changes
  const fetchFrequency = async () => {
    if (!categoryId || !itemId || !unitId) {
      setData(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        categoryId: String(categoryId),
        itemId: String(itemId),
        unitId: String(unitId),
      });
      if (locationId) qs.set("locationId", String(locationId));
      const res = await api(`/order-frequency?${qs.toString()}`, { silent: true });
      setData(res);
    } catch (e) {
      setError(e.message || "Unable to load order frequency.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchFrequency();
  }, [locationId, categoryId, itemId, unitId]);

  const handleUseGps = async () => {
    setDetectingGps(true);
    try {
      const coords = await getCurrentGpsPosition({ timeout: 6000 });
      if (isValidCoordinates(coords)) {
        setCurrentCoords(coords);
        const bundle = await fetchLocationsWithGps({ coords, silent: true });
        const locs = Array.isArray(bundle?.locations) ? bundle.locations : [];
        if (locs.length) {
          setLocations(locs);
          const best = pickBestLocation(locs);
          if (best) {
            userChoseLocationRef.current = false;
            setLocationId(String(best.id));
            setAutoLocationHint(describeAutoMatchReason(best));
          }
        }
      }
    } finally {
      setDetectingGps(false);
    }
  };

  const handleReset = () => {
    userChoseLocationRef.current = false;
    pendingRestoredItemIdRef.current = "";
    const best = pickBestLocation(locations);
    setLocationId(best ? String(best.id) : "");
    setAutoLocationHint(best ? describeAutoMatchReason(best) : "");
    setCategoryId("");
    setItems([]);
    setItemId("");
    setUnitId("");
    setData(null);
    setError("");
  };

  const chartData = useMemo(() => {
    const weeks = Array.isArray(data?.weeks) ? [...data.weeks] : [];
    return weeks.reverse();
  }, [data]);

  const summary = data?.summary || null;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BarChart3 size={22} /> Order Frequency
          </h1>
          <p className="muted">
            Track weekly ordered quantities per item from your Marketing List history.
          </p>
        </div>
        <div className="action-row">
          <button
            type="button"
            className="secondary"
            disabled={loading || !categoryId || !itemId || !unitId}
            onClick={() => void fetchFrequency()}
            title="Refresh order frequency"
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button type="button" className="secondary" onClick={handleReset}>
            <RotateCcw size={15} /> Reset
          </button>
        </div>
      </div>

      <section className="card">
        <div className="form-grid">
          <label>
            Location
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                value={locationId}
                onChange={(e) => {
                  userChoseLocationRef.current = Boolean(e.target.value);
                  setAutoLocationHint("");
                  setLocationId(e.target.value);
                }}
                style={{ flex: 1, minWidth: 0 }}
              >
                <option value="">All locations</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {formatLocationOptionLabel(loc)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="secondary"
                onClick={handleUseGps}
                disabled={detectingGps}
                title="Detect nearest location via GPS"
                style={{ padding: "8px 10px", flexShrink: 0 }}
              >
                <LocateFixed size={15} />
              </button>
            </div>
            {autoLocationHint && (
              <small className="location-auto-hint">{autoLocationHint}</small>
            )}
          </label>

          <label>
            Category
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setItemId("");
                setUnitId("");
              }}
            >
              <option value="">Select category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Item
            <select
              value={itemId}
              disabled={!categoryId}
              onChange={(e) => {
                setItemId(e.target.value);
                setUnitId("");
              }}
            >
              <option value="">Select item</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Unit
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Select unit</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {!categoryId || !itemId || !unitId ? (
        <div className="empty-card">
          Select a category, item, and unit to see weekly order frequency.
        </div>
      ) : loading && !data ? (
        <div className="empty-card">Calculating weekly order frequency…</div>
      ) : data && chartData.length ? (
        <>
          {summary ? (
            <div className="price-trend-kpis">
              <div className="summary-card dashboard-summary-card">
                <span>Weekly frequency</span>
                <strong>{formatAmount(summary.avgPerWeek, data.unitName)}</strong>
                {summary.firstOrderDate ? (
                  <small className="muted" style={{ fontSize: "0.76rem", marginTop: 2 }}>
                    Since {summary.firstOrderDate} ({summary.totalDays}{" "}
                    {summary.totalDays === 1 ? "day" : "days"})
                  </small>
                ) : null}
              </div>
              <div className="summary-card dashboard-summary-card">
                <span>Latest week ordered</span>
                <strong>{formatAmount(summary.latestWeekAmount, data.unitName)}</strong>
              </div>
              <div className="summary-card dashboard-summary-card">
                <span>Total ({summary.totalOrders} orders)</span>
                <strong>{formatAmount(summary.totalOrdered, data.unitName)}</strong>
              </div>
              <div className="summary-card dashboard-summary-card">
                <span>Min / Max week</span>
                <strong>
                  {formatAmount(summary.minWeekAmount)} /{" "}
                  {formatAmount(summary.maxWeekAmount, data.unitName)}
                </strong>
              </div>
            </div>
          ) : null}

          <section className="card">
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>
              {data.itemName} — Weekly Ordered Amount ({data.unitName})
            </h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
              {data.locationName} · {data.categoryName} · Showing latest {chartData.length}{" "}
              {chartData.length === 1 ? "week" : "weeks"}
            </p>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="weekLabel" />
                  <YAxis />
                  <Tooltip
                    formatter={(val) => [formatAmount(val, data.unitName), "Ordered"]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.weekRange
                        ? `Week: ${payload[0].payload.weekRange}`
                        : ""
                    }
                  />
                  <Bar
                    dataKey="totalQuantity"
                    fill="var(--primary, #1769aa)"
                    radius={[6, 6, 0, 0]}
                  >
                    <LabelList
                      dataKey="totalQuantity"
                      position="top"
                      formatter={(val) => `${val}`}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Weekly Breakdown</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Orders</th>
                    <th>Total Ordered ({data.unitName})</th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => (
                    <tr key={w.weekStart}>
                      <td>{w.weekRange}</td>
                      <td>{w.orderCount}</td>
                      <td>
                        <strong>{formatAmount(w.totalQuantity, data.unitName)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="empty-card">
          No marketing list orders found for {data?.itemName || "this item"} in{" "}
          {data?.locationName || "selected location"} with a convertible {data?.unitName || "unit"}.
        </div>
      )}
    </div>
  );
}
