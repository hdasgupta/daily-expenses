import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  Filter,
  RefreshCw,
  RotateCcw,
  Search,
  Tags,
  Users,
  X,
} from "lucide-react";
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

function SmartMultiSelect({
  label,
  icon: Icon,
  placeholder,
  options,
  selectedIds,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectedSet = useMemo(
    () => new Set((selectedIds || []).map(String)),
    [selectedIds],
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => String(opt.label || "").toLowerCase().includes(q));
  }, [options, query]);

  const selectedOptions = useMemo(
    () => options.filter((opt) => selectedSet.has(String(opt.id))),
    [options, selectedSet],
  );

  const toggleOption = (id) => {
    const key = String(id);
    if (selectedSet.has(key)) {
      onChange(selectedIds.filter((item) => String(item) !== key));
    } else {
      onChange([...selectedIds, key]);
    }
  };

  const selectAllMatching = () => {
    const next = new Set(selectedIds.map(String));
    filteredOptions.forEach((opt) => next.add(String(opt.id)));
    onChange(Array.from(next));
  };

  const clearSelection = (event) => {
    if (event) event.stopPropagation();
    onChange([]);
  };

  return (
    <div
      className={`smart-multiselect${open ? " is-open" : ""}${
        selectedIds.length ? " has-selection" : ""
      }`}
      ref={containerRef}
    >
      <div className="smart-multiselect-header">
        <span className="smart-multiselect-label">
          {Icon ? <Icon size={14} /> : null}
          {label}
        </span>
        <span className="smart-multiselect-count-badge">
          {selectedIds.length === 0
            ? "All"
            : selectedIds.length === options.length && options.length > 0
              ? `All (${options.length})`
              : `${selectedIds.length} selected`}
        </span>
      </div>

      <button
        type="button"
        className="smart-multiselect-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <div className="smart-multiselect-trigger-content">
          {selectedOptions.length === 0 ? (
            <span className="smart-multiselect-placeholder">{placeholder}</span>
          ) : (
            <div className="smart-multiselect-chips">
              {selectedOptions.slice(0, 3).map((opt) => (
                <span
                  key={opt.id}
                  className="smart-multiselect-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleOption(opt.id);
                  }}
                >
                  <span>{opt.label}</span>
                  <X size={12} />
                </span>
              ))}
              {selectedOptions.length > 3 ? (
                <span className="smart-multiselect-chip more">
                  +{selectedOptions.length - 3} more
                </span>
              ) : null}
            </div>
          )}
        </div>

        <div className="smart-multiselect-trigger-actions">
          {selectedIds.length > 0 ? (
            <span
              role="button"
              tabIndex={0}
              title="Clear selection"
              className="smart-multiselect-inline-clear"
              onClick={clearSelection}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") clearSelection(e);
              }}
            >
              <X size={14} />
            </span>
          ) : null}
          <ChevronDown
            size={16}
            className={`smart-multiselect-chevron${open ? " rotated" : ""}`}
          />
        </div>
      </button>

      {open ? (
        <div className="smart-multiselect-popover">
          <div className="smart-multiselect-search">
            <Search size={14} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              autoFocus
            />
            {query ? (
              <button
                type="button"
                className="smart-multiselect-search-clear"
                onClick={() => setQuery("")}
                title="Clear search"
              >
                <X size={13} />
              </button>
            ) : null}
          </div>

          <div className="smart-multiselect-toolbar">
            <button
              type="button"
              className="smart-multiselect-action-btn"
              onClick={selectAllMatching}
              disabled={!filteredOptions.length}
            >
              {query ? "Select matching" : "Select all"}
            </button>
            <button
              type="button"
              className="smart-multiselect-action-btn"
              onClick={() => onChange([])}
              disabled={!selectedIds.length}
            >
              Clear all
            </button>
            <span className="smart-multiselect-toolbar-meta">
              {selectedIds.length}/{options.length}
            </span>
          </div>

          <div className="smart-multiselect-options">
            {filteredOptions.length ? (
              filteredOptions.map((opt) => {
                const isSelected = selectedSet.has(String(opt.id));
                return (
                  <button
                    type="button"
                    key={opt.id}
                    className={`smart-multiselect-option${isSelected ? " is-selected" : ""}`}
                    onClick={() => toggleOption(opt.id)}
                  >
                    <span className={`smart-multiselect-checkbox${isSelected ? " checked" : ""}`}>
                      {isSelected ? <Check size={12} strokeWidth={3} /> : null}
                    </span>
                    <span className="smart-multiselect-option-label">{opt.label}</span>
                  </button>
                );
              })
            ) : (
              <div className="smart-multiselect-empty">No matching {label.toLowerCase()}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function filterDashboardData(
  data,
  categoryFilters = [],
  survivorFilters = [],
  categories = [],
  survivors = [],
) {
  if (!data) return null;
  const catIds = Array.isArray(categoryFilters)
    ? categoryFilters.map(String).filter(Boolean)
    : [];
  const survIds = Array.isArray(survivorFilters)
    ? survivorFilters.map(String).filter(Boolean)
    : [];

  if (!catIds.length && !survIds.length) return data;

  const groupBy = Array.isArray(data.groupBy) ? data.groupBy : [];
  const catIdSet = new Set(catIds);
  const survIdSet = new Set(survIds);

  const catNameSet = new Set(
    categories
      .filter((c) => catIdSet.has(String(c.id)))
      .map((c) => String(c.name)),
  );
  const survNameSet = new Set(
    survivors
      .filter((s) => survIdSet.has(String(s.id)))
      .map((s) => String(s.full_name)),
  );

  const sourceRows =
    Array.isArray(data.breakdownRows) && data.breakdownRows.length
      ? data.breakdownRows
      : Array.isArray(data.rows)
        ? data.rows
        : [];

  const matching = sourceRows.filter((row) => {
    if (catIds.length) {
      const idMatch = row.category_id != null && catIdSet.has(String(row.category_id));
      const nameMatch = row.category != null && catNameSet.has(String(row.category));
      if (!idMatch && !nameMatch) return false;
    }
    if (survIds.length) {
      const idMatch = row.survivor_id != null && survIdSet.has(String(row.survivor_id));
      const nameMatch = row.survivor != null && survNameSet.has(String(row.survivor));
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
      if (groupBy.includes("category") && row.category_id != null) {
        nextRow.category_id = row.category_id;
      } else if (catIds.length === 1) {
        nextRow.category_id = catIds[0];
      }
      if (groupBy.includes("survivor") && row.survivor_id != null) {
        nextRow.survivor_id = row.survivor_id;
      } else if (survIds.length === 1) {
        nextRow.survivor_id = survIds[0];
      }
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

function dashboardFilterStorageKey(userId, reportKey) {
  return `dashboard_filters:${userId || "anon"}:${reportKey || ""}`;
}

function readCachedDashboardFilters(userId, reportKey) {
  if (!reportKey) return { categories: [], survivors: [] };
  try {
    const raw = localStorage.getItem(dashboardFilterStorageKey(userId, reportKey));
    if (!raw) return { categories: [], survivors: [] };
    const parsed = JSON.parse(raw);
    return {
      categories: Array.isArray(parsed?.categories) ? parsed.categories.map(String).filter(Boolean) : [],
      survivors: Array.isArray(parsed?.survivors) ? parsed.survivors.map(String).filter(Boolean) : [],
    };
  } catch {
    return { categories: [], survivors: [] };
  }
}

function writeCachedDashboardFilters(userId, reportKey, filters) {
  if (!reportKey) return;
  try {
    localStorage.setItem(
      dashboardFilterStorageKey(userId, reportKey),
      JSON.stringify({
        categories: Array.isArray(filters?.categories) ? filters.categories.map(String).filter(Boolean) : [],
        survivors: Array.isArray(filters?.survivors) ? filters.survivors.map(String).filter(Boolean) : [],
      }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export default function DashboardDetail({ navigate, user }) {
  const reportKey = readReportKey();

  const report = getDashboardReports().find((item) => item.key === reportKey);

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [categories, setCategories] = useState([]);
  const [survivors, setSurvivors] = useState([]);
  const [categoryFilters, setCategoryFilters] = useState(
    () => readCachedDashboardFilters(user?.id, reportKey).categories,
  );
  const [survivorFilters, setSurvivorFilters] = useState(
    () => readCachedDashboardFilters(user?.id, reportKey).survivors,
  );

  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [scheduleBusy, setScheduleBusy] = useState(false);

  const saveFilterTimerRef = useRef(null);

  const canSchedule = user?.permissions?.includes("job-status");
  const canOpenReports =
    !Array.isArray(user?.permissions) || user.permissions.includes("report");

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
    let cancelled = false;
    const cached = readCachedDashboardFilters(user?.id, reportKey);
    setCategoryFilters(cached.categories);
    setSurvivorFilters(cached.survivors);
    load();

    if (report) {
      api(`/dashboard/filters/${encodeURIComponent(report.key)}`, { silent: true })
        .then((saved) => {
          if (cancelled || !saved) return;
          const nextCategories = Array.isArray(saved.categories)
            ? saved.categories.map(String).filter(Boolean)
            : [];
          const nextSurvivors = Array.isArray(saved.survivors)
            ? saved.survivors.map(String).filter(Boolean)
            : [];
          setCategoryFilters(nextCategories);
          setSurvivorFilters(nextSurvivors);
          writeCachedDashboardFilters(user?.id, report.key, {
            categories: nextCategories,
            survivors: nextSurvivors,
          });
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [reportKey, user?.id]);

  useEffect(() => {
    return () => {
      if (saveFilterTimerRef.current) {
        clearTimeout(saveFilterTimerRef.current);
      }
    };
  }, []);

  const persistFilters = (nextCategories, nextSurvivors) => {
    if (!report) return;
    const targetReportKey = report.key;
    const payload = {
      categories: Array.isArray(nextCategories) ? nextCategories.map(String).filter(Boolean) : [],
      survivors: Array.isArray(nextSurvivors) ? nextSurvivors.map(String).filter(Boolean) : [],
    };
    writeCachedDashboardFilters(user?.id, targetReportKey, payload);
    if (saveFilterTimerRef.current) {
      clearTimeout(saveFilterTimerRef.current);
    }
    saveFilterTimerRef.current = setTimeout(() => {
      api(`/dashboard/filters/${encodeURIComponent(targetReportKey)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
        silent: true,
      }).catch(() => {});
    }, 250);
  };

  const handleCategoryFiltersChange = (nextCategories) => {
    setCategoryFilters(nextCategories);
    persistFilters(nextCategories, survivorFilters);
  };

  const handleSurvivorFiltersChange = (nextSurvivors) => {
    setSurvivorFilters(nextSurvivors);
    persistFilters(categoryFilters, nextSurvivors);
  };

  const handleResetFilters = () => {
    setCategoryFilters([]);
    setSurvivorFilters([]);
    persistFilters([], []);
  };

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ id: String(c.id), label: c.name })),
    [categories],
  );

  const survivorOptions = useMemo(
    () => survivors.map((s) => ({ id: String(s.id), label: s.full_name })),
    [survivors],
  );

  const activeFilters = useMemo(
    () => ({
      categories: categoryFilters,
      survivors: survivorFilters,
    }),
    [categoryFilters, survivorFilters],
  );

  const scheduleFilters = useMemo(() => {
    const categoryMap = new Map(categories.map((c) => [String(c.id), c.name]));
    const survivorMap = new Map(survivors.map((s) => [String(s.id), s.full_name]));
    return {
      categories: categoryFilters,
      categoryLabels: categoryFilters.map((id) => categoryMap.get(String(id)) || String(id)),
      survivors: survivorFilters,
      survivorLabels: survivorFilters.map((id) => survivorMap.get(String(id)) || String(id)),
    };
  }, [categoryFilters, survivorFilters, categories, survivors]);

  const filteredData = useMemo(
    () => filterDashboardData(data, categoryFilters, survivorFilters, categories, survivors),
    [data, categoryFilters, survivorFilters, categories, survivors],
  );

  const chartModel = useMemo(() => buildChartModel(filteredData), [filteredData]);

  const chartData = chartModel.data;

  const openInReports = () => {
    const groupBy =
      Array.isArray(data?.groupBy) && data.groupBy.length
        ? data.groupBy
        : (() => {
            const parts = String(reportKey || "").split("-");
            const periodMap = { daily: "date", weekly: "week", monthly: "month", yearly: "year" };
            const cols = [periodMap[parts[0]] || "date"];
            if (parts.includes("survivor")) cols.push("survivor");
            if (parts.includes("category")) cols.push("category");
            return cols;
          })();

    const rangeMatch = String(data?.rangeLabel || "").match(
      /^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/,
    );
    const dateFrom = rangeMatch ? rangeMatch[1] : "";
    const dateTo = rangeMatch ? rangeMatch[2] : "";

    const activeFilterTypes = [];
    if (dateFrom || dateTo) activeFilterTypes.push("date");
    if (categoryFilters.length) activeFilterTypes.push("categories");
    if (survivorFilters.length) activeFilterTypes.push("survivors");

    const sortColumns = groupBy.map((column, index) => ({
      column,
      direction: index === 0 ? "desc" : "asc",
    }));

    const reportConfig = {
      activeFilters: activeFilterTypes,
      dateFilterType: dateFrom || dateTo ? "range" : "none",
      filters: {
        date: "",
        dateFrom,
        dateTo,
        month: "",
        year: "",
        hasProof: "",
        categoryItems: [],
        categories: [...categoryFilters],
        survivors: [...survivorFilters],
      },
      sortColumns,
      groupBy: [...groupBy],
      summarise: true,
    };

    try {
      sessionStorage.setItem(
        "job_status_open_report_config",
        JSON.stringify({ config: reportConfig, autoRun: true }),
      );
    } catch {
      // Ignore storage errors
    }

    navigate("/report");
  };

  const createSchedule = async (payload) => {
    setScheduleBusy(true);

    try {
      await api("/scheduled-reports", {
        method: "POST",

        body: JSON.stringify({
          ...payload,
          filters: payload?.filters ?? scheduleFilters,
        }),

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
          {canOpenReports ? (
            <button
              className="secondary"
              type="button"
              onClick={openInReports}
              disabled={loading && !data}
              title="Open this dashboard report in the Reports page with current filters, grouping, sorting, and summarise applied"
            >
              <BarChart3 size={17} />
              Show report
            </button>
          ) : null}

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
          <div className="dashboard-detail-filter-title">
            <span className="dashboard-detail-filter-icon">
              <Filter size={15} />
            </span>
            <div>
              <strong>Smart Instant Filters</strong>
              <small>Filter chart & summary table in real time across multiple categories and survivors</small>
            </div>
          </div>
          {(categoryFilters.length > 0 || survivorFilters.length > 0) ? (
            <button
              type="button"
              className="secondary dashboard-filter-clear-btn"
              onClick={handleResetFilters}
            >
              <RotateCcw size={14} />
              Reset filters ({categoryFilters.length + survivorFilters.length})
            </button>
          ) : null}
        </div>

        <div className="dashboard-detail-filter-grid">
          <SmartMultiSelect
            label="Categories"
            icon={Tags}
            placeholder="All categories included — click to select…"
            options={categoryOptions}
            selectedIds={categoryFilters}
            onChange={handleCategoryFiltersChange}
          />

          <SmartMultiSelect
            label="Survivors"
            icon={Users}
            placeholder="All survivors included — click to select…"
            options={survivorOptions}
            selectedIds={survivorFilters}
            onChange={handleSurvivorFiltersChange}
          />
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
          filters={scheduleFilters}
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
  } else if (Array.isArray(activeFilters.categories) && activeFilters.categories.length) {
    selection.categories = activeFilters.categories;
  }

  if (row.survivor_id != null) {
    selection.survivor_id = row.survivor_id;
  } else if (Array.isArray(activeFilters.survivors) && activeFilters.survivors.length) {
    selection.survivors = activeFilters.survivors;
  }

  const query = encodeURIComponent(JSON.stringify(selection));

  navigate(`/dashboard/drilldown/${reportKey}?selection=${query}`);
}
