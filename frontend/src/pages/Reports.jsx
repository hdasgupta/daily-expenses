import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Download,
  Mail,
  CalendarClock,
  Filter,
  FolderOpen,
  Plus,
  RotateCcw,
  Save,
  Share2,
  CheckCircle2,
  UserRoundX,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { downloadPdf } from "../lib/download";
import { openRemoteFile } from "../lib/download";
import Modal from "../components/Modal";
import ProofViewer from "../components/ProofViewer";
import { formatDateKolkata, todayKolkata } from "../utils/dates.js";

const GROUP_OPTIONS = [
  ["date", "Date"],
  ["week", "Week"],
  ["month", "Month"],
  ["year", "Year"],
  ["category", "Category"],
  ["item", "Item"],
  ["survivor", "Survivor"],
];

const SORT_OPTIONS = [
  ["date", "Date"],
  ["category", "Category"],
  ["item", "Item"],
  ["survivor", "Survivor"],
];

const GROUP_SORT_BASE_OPTIONS = [
  ["date", "Date"],
  ["survivor", "Survivor"],
  ["category", "Category"],
  ["item", "Item"],
  ["price", "Price"],
];

const FILTER_OPTIONS = [
  ["date", "Date / range / month / year"],
  ["hasProof", "Has proof"],
  ["categoryItems", "Category / item"],
  ["survivors", "Survivors"],
];

const initialConfig = {
  activeFilters: [],
  dateFilterType: "none",

  filters: {
    date: "",
    dateFrom: "",
    dateTo: "",
    month: "",
    year: "",
    hasProof: "",
    categoryItems: [],
    survivors: [],
  },

  sortColumns: [],
  groupBy: [],
  summarise: false,
};

function optionLabel(options, value) {
  return options.find(([key]) => key === value)?.[1] || value;
}

function normalizeLoaded(config = {}) {
  const active = Array.isArray(config.activeFilters)
    ? config.activeFilters
    : [
        ...(config.dateFilterType && config.dateFilterType !== "none" ? ["date"] : []),
        ...(config.filters?.hasProof ? ["hasProof"] : []),
        ...(config.filters?.categoryItems?.length ? ["categoryItems"] : []),
        ...(config.filters?.survivors?.length ? ["survivors"] : []),
      ];

  return {
    ...initialConfig,
    ...config,

    activeFilters: [...new Set(active)],

    filters: {
      ...initialConfig.filters,
      ...(config.filters || {}),
    },

    sortColumns: Array.isArray(config.sortColumns) ? config.sortColumns : [],

    groupBy: Array.isArray(config.groupBy) ? config.groupBy : [],
  };
}

function formatCell(value, column) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (
    column === "total" ||
    column === "total_cost" ||
    column === "report_amount" ||
    column === "share_price"
  ) {
    return `₹${Number(value).toFixed(2)}`;
  }

  if (column === "expense_date") {
    return formatDateKolkata(value);
  }

  return String(value);
}

function buildUiShareRows(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const key =
      row.expense_id ??
      row.id ??
      [row.expense_date, row.category, row.item, row.comment].join("\u0001");

    if (!map.has(key)) {
      map.set(key, {
        ...row,
        survivorShares: [],
      });
    }

    const target = map.get(key);

    if (row.survivor && row.survivor !== "—") {
      target.survivorShares.push({
        name: row.survivor,
        amount: Number(row.share_price || 0),
      });
    }
  }

  return [...map.values()].map((row) => {
    const shares = row.survivorShares;

    const total = Number(row.total_cost || shares.reduce((sum, item) => sum + item.amount, 0));

    const share = shares.length
      ? shares
          .map(
            (item) =>
              `${item.name}: ₹${item.amount.toFixed(2)}${
                total ? ` (${((item.amount / total) * 100).toFixed(2)}%)` : ""
              }`,
          )
          .join(", ")
      : "No survivor share recorded";

    const { survivorShares, survivor, ...clean } = row;

    return {
      ...clean,
      share,
    };
  });
}

/*
 * Calculate a frontend fallback total from
 * the actual rows returned by the API.
 *
 * This is only used when the backend total is
 * missing or zero.
 */
function calculateDisplayTotal(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return 0;
  }

  let total = 0;

  for (const row of rows) {
    const totalCost = Number(row.total_cost);

    if (Number.isFinite(totalCost)) {
      total += totalCost;
      continue;
    }

    const reportAmount = Number(row.report_amount);

    if (Number.isFinite(reportAmount)) {
      total += reportAmount;
      continue;
    }

    const sharePrice = Number(row.share_price);

    if (Number.isFinite(sharePrice)) {
      total += sharePrice;
    }
  }

  return total;
}

function reportChartValue(value, column) {
  if (value == null || value === "") return "—";
  if (["date", "week", "month"].includes(column)) {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
    }
  }
  return String(value);
}

function buildReportChartModel(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const groupBy = Array.isArray(result?.groupBy) ? result.groupBy : [];
  if (groupBy.length <= 1) {
    return {
      stackedCategory: false,
      data: rows.map((row, index) => ({ ...row, chartLabel: groupBy[0] ? reportChartValue(row[groupBy[0]], groupBy[0]) : "Total", chartValue: Number(row.total || 0), index })),
      series: [{ dataKey: "chartValue", label: "Total", fill: "var(--accent)" }],
      description: "Each bar represents one summary-table row.",
    };
  }

  const period = groupBy.find((column) => ["date", "week", "month", "year"].includes(column));
  const category = groupBy.includes("category") ? "category" : null;
  const survivor = groupBy.includes("survivor") ? "survivor" : null;
  const xColumn = period || groupBy.find((column) => column !== survivor && column !== category) || groupBy[0];

  if (category && survivor) {
    const categoryValues = [...new Map(rows.map((row) => [String(row[category] ?? "—"), row[category]])).entries()];
    const survivorValues = [...new Map(rows.map((row) => [String(row[survivor] ?? "—"), row[survivor]])).entries()];
    const dataMap = new Map();
    const series = [];
    const palette = Array.from({ length: 8 }, (_, i) => `var(--dashboard-series-${i + 1})`);

    categoryValues.forEach(([categoryKey, categoryValue], categoryIndex) => {
      survivorValues.forEach(([survivorKey, survivorValue]) => {
        const dataKey = `cat_${categoryIndex}_surv_${survivorKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        series.push({ dataKey, label: reportChartValue(categoryValue, category), category: String(categoryValue ?? "—"), survivor: reportChartValue(survivorValue, survivor), stackId: `category_${categoryIndex}`, fill: palette[categoryIndex % palette.length], legendType: "none" });
      });
    });

    rows.forEach((row) => {
      const xKey = String(row[xColumn] ?? "—");
      if (!dataMap.has(xKey)) dataMap.set(xKey, { chartLabel: reportChartValue(row[xColumn], xColumn), _groupRows: {} });
      const target = dataMap.get(xKey);
      const ci = categoryValues.findIndex(([key]) => key === String(row[category] ?? "—"));
      const dataKey = `cat_${ci}_surv_${String(row[survivor] ?? "—").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      target[dataKey] = Number(target[dataKey] || 0) + Number(row.total || 0);
      target._groupRows[dataKey] = row;
    });

    return {
      stackedCategory: true,
      data: [...dataMap.values()],
      series,
      categories: categoryValues.map(([, value], index) => ({ label: reportChartValue(value, category), fill: palette[index % palette.length] })),
      description: `${xColumn} on the X-axis; categories are the legend and survivors are stacked within each category.`,
    };
  }

  const seriesColumn = groupBy.find((column) => column !== xColumn) || groupBy[1];
  const seriesMap = new Map();
  const dataMap = new Map();
  rows.forEach((row) => {
    const seriesKey = String(row[seriesColumn] ?? "—");
    if (!seriesMap.has(seriesKey)) {
      const index = seriesMap.size;
      seriesMap.set(seriesKey, { dataKey: `series_${index}`, label: reportChartValue(row[seriesColumn], seriesColumn), fill: `var(--dashboard-series-${(index % 8) + 1})` });
    }
    const xKey = String(row[xColumn] ?? "—");
    if (!dataMap.has(xKey)) dataMap.set(xKey, { chartLabel: reportChartValue(row[xColumn], xColumn), _groupRows: {} });
    const target = dataMap.get(xKey);
    const series = seriesMap.get(seriesKey);
    target[series.dataKey] = Number(target[series.dataKey] || 0) + Number(row.total || 0);
    target._groupRows[series.dataKey] = row;
  });
  return { stackedCategory: false, data: [...dataMap.values()], series: [...seriesMap.values()], description: `${xColumn} on the X-axis with ${seriesColumn} as the legend.` };
}

export default function Reports() {
  const [config, setConfig] = useState(initialConfig);

  const [result, setResult] = useState(null);

  const [categories, setCategories] = useState([]);

  const [items, setItems] = useState([]);

  const [survivors, setSurvivors] = useState([]);

  const [filterModal, setFilterModal] = useState(false);

  const [filterType, setFilterType] = useState("");

  const [sortModal, setSortModal] = useState(false);

  const [groupModal, setGroupModal] = useState(false);

  const [sortColumn, setSortColumn] = useState("");

  const [sortDirection, setSortDirection] = useState("asc");

  const [groupColumn, setGroupColumn] = useState("");

  const [saveModal, setSaveModal] = useState(false);

  const [loadModal, setLoadModal] = useState(false);

  const [selectionName, setSelectionName] = useState("");

  const [selections, setSelections] = useState([]);

  const [shareModal, setShareModal] = useState(false);
  const [shareSelectionTarget, setShareSelectionTarget] = useState(null);
  const [shareableManagers, setShareableManagers] = useState([]);
  const [selectedManagerIds, setSelectedManagerIds] = useState([]);

  const [showChart, setShowChart] = useState(false);

  const [proofViewerUrl, setProofViewerUrl] = useState("");
  const [scheduleEmailModal, setScheduleEmailModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleBusy, setScheduleBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api("/meta/categories", {
        loadingMessage: "Loading report categories…",
      }),

      api("/meta/survivors", {
        loadingMessage: "Loading report survivors…",
      }),
    ])
      .then(([cats, surv]) => {
        setCategories(cats);
        setSurvivors(surv);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!categories.length) {
      return;
    }

    Promise.all(
      categories.map((category) =>
        api(`/meta/items/${category.id}`, {
          loadingMessage: "Loading report items…",
        }),
      ),
    )
      .then((lists) =>
        setItems(
          lists.flatMap((list, index) =>
            list.map((item) => ({
              ...item,
              categoryName: categories[index].name,
            })),
          ),
        ),
      )
      .catch(() => {});
  }, [categories]);

  const categoryItemOptions = useMemo(
    () =>
      categories.flatMap((category) => [
        {
          value: `${category.id}:total`,
          label: `${category.name} / Total`,
        },

        {
          value: `${category.id}:other`,
          label: `${category.name} / Other`,
        },

        ...items
          .filter((item) => String(item.category_id) === String(category.id))
          .map((item) => ({
            value: `${category.id}:item:${item.id}`,
            label: `${category.name} / ${item.name}`,
          })),
      ]),
    [categories, items],
  );

  const addFilter = () => {
    if (!filterType || config.activeFilters.includes(filterType)) {
      return;
    }

    setConfig((current) => ({
      ...current,

      activeFilters: [...current.activeFilters, filterType],

      dateFilterType: filterType === "date" ? "date" : current.dateFilterType,

      filters: {
        ...current.filters,

        hasProof: filterType === "hasProof" ? "" : current.filters.hasProof,
      },
    }));

    setFilterModal(false);
    setFilterType("");
  };

  const removeFilter = (type) =>
    setConfig((current) => {
      const next = {
        ...current,

        activeFilters: current.activeFilters.filter((x) => x !== type),
      };

      if (type === "date") {
        next.dateFilterType = "none";
      }

      if (type === "hasProof") {
        next.filters = {
          ...next.filters,
          hasProof: "",
        };
      }

      if (type === "categoryItems") {
        next.filters = {
          ...next.filters,
          categoryItems: [],
        };
      }

      if (type === "survivors") {
        next.filters = {
          ...next.filters,
          survivors: [],
        };
      }

      return next;
    });

  const setFilter = (key, value) =>
    setConfig((current) => ({
      ...current,

      filters: {
        ...current.filters,
        [key]: value,
      },
    }));

  const toggleUnique = (key, value) =>
    setFilter(
      key,
      config.filters[key].includes(String(value))
        ? config.filters[key].filter((item) => item !== String(value))
        : [...config.filters[key], String(value)],
    );

  const apply = async () => {
    const data = await api("/reports/query", {
      method: "POST",
      body: JSON.stringify(config),
      loadingMessage: "Running report query…",
    });

    const serverTotal = Number(data?.total);

    const fallbackTotal = calculateDisplayTotal(data?.rows);

    const resolvedTotal =
      Number.isFinite(serverTotal) && serverTotal !== 0 ? serverTotal : fallbackTotal;

    const next =
      data?.mode === "raw" && data?.columns?.includes("share_price")
        ? {
            ...data,

            total: resolvedTotal,

            rows: buildUiShareRows(data.rows),

            columns: [
              ...new Set(
                data.columns
                  .filter((column) => column !== "survivor")
                  .map((column) => (column === "share_price" ? "share" : column)),
              ),
            ],
          }
        : {
            ...data,
            total: resolvedTotal,
          };

    setResult(next);
  };

  const addSort = () => {
    if (!sortColumn || config.sortColumns.some((item) => item.column === sortColumn)) {
      return;
    }

    setConfig((current) => ({
      ...current,

      sortColumns: [
        ...current.sortColumns,
        {
          column: sortColumn,
          direction: sortDirection,
        },
      ],
    }));

    setSortModal(false);
    setSortColumn("");
    setSortDirection("asc");
  };

  const removeSort = (column) =>
    setConfig((current) => ({
      ...current,

      sortColumns: current.sortColumns.filter((item) => item.column !== column),
    }));

  const toggleSortDirection = (column) =>
    setConfig((current) => ({
      ...current,

      sortColumns: current.sortColumns.map((item) =>
        item.column === column
          ? {
              ...item,
              direction: item.direction === "asc" ? "desc" : "asc",
            }
          : item,
      ),
    }));

  const addGroup = () => {
    if (!groupColumn || config.groupBy.includes(groupColumn)) {
      return;
    }

    setConfig((current) => ({
      ...current,

      groupBy: [...current.groupBy, groupColumn],
    }));

    setGroupModal(false);
    setGroupColumn("");
  };

  const removeGroup = (column) =>
    setConfig((current) => {
      const nextGroup = current.groupBy.filter((item) => item !== column);

      return {
        ...current,

        groupBy: nextGroup,

        sortColumns: current.sortColumns.filter((sort) => sort.column !== column),
      };
    });

  const saveSelection = async (event) => {
    event.preventDefault();

    await api("/report-selections", {
      method: "POST",

      body: JSON.stringify({
        name: selectionName,
        config,
      }),

      loadingMessage: "Saving report selection…",

      toast: {
        type: "success",
        message: "Report selection saved.",
      },
    });

    setSelectionName("");
    setSaveModal(false);
  };

  const loadSelections = async () => {
    setSelections(
      await api("/report-selections", {
        loadingMessage: "Loading saved report selections…",
      }),
    );

    setLoadModal(true);
  };

  const refreshSelections = async () => {
    setSelections(
      await api("/report-selections", {
        loadingMessage: "Refreshing saved selections…",
      }),
    );
  };

  const openShareSelection = async (selection) => {
    const managers = await api(`/report-selections/${selection.id}/shareable-users`, {
      loadingMessage: "Loading managers…",
    });
    setShareSelectionTarget(selection);
    setShareableManagers(managers);
    setSelectedManagerIds(
      managers.filter((manager) => manager.shared).map((manager) => String(manager.id)),
    );
    setShareModal(true);
  };

  const shareCurrentSelection = async (event) => {
    event.preventDefault();
    if (!shareSelectionTarget) return;

    await api(`/report-selections/${shareSelectionTarget.id}/share`, {
      method: "PUT",
      body: JSON.stringify({ userIds: selectedManagerIds }),
      loadingMessage: "Sharing selection…",
      toast: { type: "success", message: "Selection shared." },
    });

    setShareModal(false);
    setShareSelectionTarget(null);
    await refreshSelections();
  };

  const unshareSelectionForMe = async (selection) => {
    await api(`/report-selections/${selection.id}/share/me`, {
      method: "DELETE",
      loadingMessage: "Removing shared selection…",
      toast: { type: "success", message: "Shared selection removed." },
    });
    await refreshSelections();
  };

  const reset = () => {
    setConfig(initialConfig);
    setResult(null);
    setShowChart(false);
  };

  const exportPdf = async () => {
    if (!result?.rows?.length) {
      return;
    }

    await downloadPdf("/reports/export-pdf", config);
  };

  const openScheduleEmail = () => {
    const now = new Date(Date.now() + 10 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const values = Object.fromEntries(
      parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]),
    );

    setScheduleDate(`${values.year}-${values.month}-${values.day}`);
    setScheduleTime(`${values.hour}:${values.minute}`);
    setScheduleName("Report PDF email");
    setScheduleEmailModal(true);
  };

  const scheduleEmail = async (event) => {
    event.preventDefault();
    if (!scheduleDate || !scheduleTime) return;

    setScheduleBusy(true);
    try {
      await api("/reports/schedule-email", {
        method: "POST",
        body: JSON.stringify({
          name: scheduleName,
          scheduledFor: `${scheduleDate}T${scheduleTime}`,
          config,
        }),
        loadingMessage: "Scheduling report PDF email…",
        toast: {
          type: "success",
          message: "Report PDF email scheduled.",
        },
      });
      setScheduleEmailModal(false);
    } finally {
      setScheduleBusy(false);
    }
  };

  const emailReport = async () => {
    if (!result?.rows?.length) {
      return;
    }

    await api("/reports/email-pdf", {
      method: "POST",

      body: JSON.stringify(config),

      loadingMessage: "Generating and emailing report PDF…",

      toast: {
        type: "success",
        message: "Report PDF emailed to your account email.",
      },
    });
  };

  const groupSortOptions = [
    ...GROUP_SORT_BASE_OPTIONS,

    ...config.groupBy
      .filter((value) => !GROUP_SORT_BASE_OPTIONS.some(([key]) => key === value))
      .map((value) => [value, optionLabel(GROUP_OPTIONS, value)]),
  ];

  const sortChoices = config.groupBy.length ? groupSortOptions : SORT_OPTIONS;

  const availableFilters = FILTER_OPTIONS.filter(
    ([value]) => !config.activeFilters.includes(value),
  );

  const renderCell = (row, column) => {
    if (column === "proof_url") {
      return row.proof_url ? (
        <button
          className="text-link"
          type="button"
          onClick={async () => {
            try {
              await openRemoteFile(
                row.proof_url,
                `expense-proof-${row.expense_id || row.id || "proof"}.pdf`,
              );
            } catch (error) {
              window.dispatchEvent(
                new CustomEvent("app:toast", {
                  detail: {
                    type: "error",
                    message: error?.message || "Unable to open proof.",
                  },
                }),
              );
            }
          }}
        >
          Open proof
        </button>
      ) : (
        "—"
      );
    }

    return formatCell(row[column], column);
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Reports</h1>

          <p>Add filters one by one, then sort, group and summarise the resulting expense data.</p>
        </div>

        <button className="secondary" type="button" onClick={reset}>
          <RotateCcw size={17} />
          Reset
        </button>
      </div>

      <div className="card report-filter-card">
        <div className="section-title">
          <Filter size={19} />
          Filters
        </div>

        {config.activeFilters.map((type) => (
          <FilterCard
            key={type}
            type={type}
            config={config}
            setConfig={setConfig}
            setFilter={setFilter}
            categoryItemOptions={categoryItemOptions}
            survivors={survivors}
            onRemove={() => removeFilter(type)}
          />
        ))}

        <button
          className="secondary"
          type="button"
          onClick={() => setFilterModal(true)}
          disabled={!availableFilters.length}
        >
          <Plus size={17} />
          Add filter
        </button>

        {!config.activeFilters.length ? (
          <div className="muted-inline">No filters selected. The report uses all expenses.</div>
        ) : null}
      </div>

      <div className="report-builder">
        {config.groupBy.length === 0 ? (
          <SortArea
            sortColumns={config.sortColumns}
            options={SORT_OPTIONS}
            onAdd={() => setSortModal(true)}
            onRemove={removeSort}
            onToggleDirection={toggleSortDirection}
          />
        ) : null}

        <GroupArea
          groupBy={config.groupBy}
          onAdd={() => setGroupModal(true)}
          onRemove={removeGroup}
        />

        {config.groupBy.length ? (
          <SortArea
            sortColumns={config.sortColumns}
            options={groupSortOptions}
            onAdd={() => setSortModal(true)}
            onRemove={removeSort}
            onToggleDirection={toggleSortDirection}
          />
        ) : null}
      </div>

      <div className="card report-actions">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={config.summarise}
            onChange={(e) => {
              setConfig((current) => ({
                ...current,
                summarise: e.target.checked,
              }));

              setShowChart(false);
            }}
          />

          <span className="switch" />

          <strong>Summarise</strong>

          {config.groupBy.length ? (
            <small className="field-note">Grouping does not automatically enable summarise.</small>
          ) : null}
        </label>

        <button className="secondary" type="button" onClick={apply}>
          Run report
        </button>

        {config.summarise ? (
          <button
            className="secondary"
            type="button"
            disabled={!result}
            onClick={() => setShowChart((value) => !value)}
          >
            <BarChart3 size={17} />

            {showChart ? "Hide chart" : "Show chart"}
          </button>
        ) : null}

        <button className="secondary" type="button" onClick={() => setSaveModal(true)}>
          <Save size={17} />
          Save selection
        </button>

        <button className="secondary" type="button" onClick={loadSelections}>
          <FolderOpen size={17} />
          Load selection
        </button>

        <button
          className="secondary"
          type="button"
          disabled={!result?.rows?.length}
          onClick={exportPdf}
        >
          <Download size={17} />
          Export PDF
        </button>

        <button
          className="secondary"
          type="button"
          disabled={!result?.rows?.length}
          onClick={emailReport}
        >
          <Mail size={17} />
          Email me report PDF
        </button>

        <button
          className="secondary"
          type="button"
          onClick={openScheduleEmail}
        >
          <CalendarClock size={17} />
          Schedule email
        </button>
      </div>

      {showChart && result?.rows?.length ? (() => {
        const chartModel = buildReportChartModel(result);
        return (
          <div className="card report-chart">
            {chartModel.stackedCategory ? (
              <div className="report-chart-legend">
                {chartModel.categories.map((item) => (
                  <span key={item.label}><i style={{ background: item.fill }} />{item.label}</span>
                ))}
              </div>
            ) : null}
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={chartModel.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="chartLabel" tick={{ fontSize: 11 }} interval={0} angle={chartModel.stackedCategory ? -25 : -25} textAnchor="end" height={90} />
                <YAxis />
                <Tooltip formatter={(value, name, item) => [`₹${Number(value).toFixed(2)}`, item?.payload?._groupRows?.[item?.dataKey] ? `${name}` : name]} />
                {!chartModel.stackedCategory && chartModel.series.length > 1 ? <Legend /> : null}
                {chartModel.series.map((series) => (
                  <Bar key={series.dataKey} dataKey={series.dataKey} name={series.label} fill={series.fill} stackId={series.stackId} stroke="var(--surface)" strokeWidth={1} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            <div className="report-chart-description">{chartModel.description}</div>
          </div>
        );
      })() : null}

      <ReportContent result={result} renderCell={renderCell} />

      <Modal
        open={filterModal}
        title="Add filter"
        onClose={() => setFilterModal(false)}
        footer={
          <>
            <button className="secondary" type="button" onClick={() => setFilterModal(false)}>
              Cancel
            </button>

            <button className="primary" type="button" onClick={addFilter}>
              <Plus size={17} />
              Add
            </button>
          </>
        }
      >
        <label>
          Filter
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">Select filter</option>

            {availableFilters.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </Modal>

      <Modal
        open={sortModal}
        title="Add sort column"
        onClose={() => setSortModal(false)}
        footer={
          <>
            <button className="secondary" type="button" onClick={() => setSortModal(false)}>
              Cancel
            </button>

            <button className="primary" type="button" onClick={addSort}>
              <Plus size={17} />
              Add
            </button>
          </>
        }
      >
        <div className="form-stack">
          <label>
            Column
            <select value={sortColumn} onChange={(e) => setSortColumn(e.target.value)}>
              <option value="">Select column</option>

              {sortChoices
                .filter(([value]) => !config.sortColumns.some((sort) => sort.column === value))
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </label>

          <label>
            Order
            <select value={sortDirection} onChange={(e) => setSortDirection(e.target.value)}>
              <option value="asc">Ascending</option>

              <option value="desc">Descending</option>
            </select>
          </label>
        </div>
      </Modal>

      <Modal
        open={groupModal}
        title="Add group by column"
        onClose={() => setGroupModal(false)}
        footer={
          <>
            <button className="secondary" type="button" onClick={() => setGroupModal(false)}>
              Cancel
            </button>

            <button className="primary" type="button" onClick={addGroup}>
              <Plus size={17} />
              Add
            </button>
          </>
        }
      >
        <label>
          Column
          <select value={groupColumn} onChange={(e) => setGroupColumn(e.target.value)}>
            <option value="">Select column</option>

            {GROUP_OPTIONS.filter(([value]) => !config.groupBy.includes(value)).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </label>
      </Modal>

      <Modal
        open={saveModal}
        title="Save report selection"
        onClose={() => setSaveModal(false)}
        footer={
          <>
            <button className="secondary" type="button" onClick={() => setSaveModal(false)}>
              Cancel
            </button>

            <button className="primary" type="submit" form="save-report-form">
              <Save size={17} />
              Save
            </button>
          </>
        }
      >
        <form id="save-report-form" className="form-stack" onSubmit={saveSelection}>
          <label>
            Selection name
            <input
              required
              autoFocus
              value={selectionName}
              onChange={(e) => setSelectionName(e.target.value)}
            />
          </label>
        </form>
      </Modal>

      <Modal open={loadModal} title="Load report selection" onClose={() => setLoadModal(false)}>
        <div className="selection-list">
          {selections.map((selection) => (
            <div className="selection-row" key={selection.id}>
              <button
                type="button"
                onClick={() => {
                  setConfig(normalizeLoaded(selection.config));

                  setShowChart(false);
                  setLoadModal(false);
                }}
              >
                <span>{selection.name}</span>
                {!selection.is_owner ? (
                  <span className="selection-shared-mark" title={`Shared by ${selection.owner_name || "another manager"}`}>
                    <CheckCircle2 size={15} />
                  </span>
                ) : null}
              </button>

              <div className="selection-actions">
                {selection.is_owner ? (
                  <button
                    type="button"
                    className="icon-button"
                    title="Share selection with managers"
                    onClick={() => openShareSelection(selection)}
                  >
                    <Share2 size={16} />
                  </button>
                ) : null}

                {selection.is_owner ? (
                  <button
                    type="button"
                    className="icon-button danger-soft"
                    title="Delete selection"
                    onClick={async () => {
                      await api(`/report-selections/${selection.id}`, {
                        method: "DELETE",
                        loadingMessage: "Deleting saved selection…",
                      });
                      await refreshSelections();
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-button danger-soft"
                    title="Remove shared selection"
                    onClick={() => unshareSelectionForMe(selection)}
                  >
                    <UserRoundX size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {!selections.length ? <div className="empty-card">No saved selections.</div> : null}
        </div>
      </Modal>

      <Modal
        open={shareModal}
        title={`Share selection${shareSelectionTarget ? ` — ${shareSelectionTarget.name}` : ""}`}
        onClose={() => {
          setShareModal(false);
          setShareSelectionTarget(null);
        }}
      >
        <form className="form-stack" onSubmit={shareCurrentSelection}>
          <div className="selection-share-list">
            {shareableManagers.map((manager) => (
              <label className={`selection-share-row${manager.shared ? " is-shared" : ""}`} key={manager.id}>
                <input
                  type="checkbox"
                  checked={selectedManagerIds.includes(String(manager.id))}
                  disabled={manager.shared}
                  onChange={(event) => {
                    const id = String(manager.id);
                    setSelectedManagerIds((current) =>
                      event.target.checked
                        ? [...new Set([...current, id])]
                        : current.filter((value) => value !== id),
                    );
                  }}
                />
                <span>
                  <b>{manager.full_name}</b>
                  {manager.email ? <small>{manager.email}</small> : null}
                </span>
                {manager.shared ? <CheckCircle2 size={15} title="Already shared" /> : null}
              </label>
            ))}
            {!shareableManagers.length ? <div className="empty-card">No other managers available to share with.</div> : null}
          </div>
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={() => setShareModal(false)}>Cancel</button>
            <button type="submit" className="button primary">Share</button>
          </div>
        </form>
      </Modal>

      <ProofViewer
        url={proofViewerUrl}
        title="Report proof"
        onClose={() => setProofViewerUrl("")}
      />

      <Modal
        open={scheduleEmailModal}
        title="Schedule report PDF email"
        onClose={() => scheduleBusy || setScheduleEmailModal(false)}
        footer={
          <>
            <button
              className="secondary"
              type="button"
              onClick={() => setScheduleEmailModal(false)}
              disabled={scheduleBusy}
            >
              Cancel
            </button>
            <button className="primary" type="submit" form="schedule-report-email-form" disabled={scheduleBusy}>
              {scheduleBusy ? "Scheduling…" : "Schedule email"}
            </button>
          </>
        }
      >
        <form id="schedule-report-email-form" onSubmit={scheduleEmail}>
          <div className="notice">
            The current report filters, grouping, sorting and summary settings will be saved as a snapshot and emailed once at the selected time.
          </div>

          <label>
            Schedule name
            <input
              value={scheduleName}
              maxLength={150}
              onChange={(event) => setScheduleName(event.target.value)}
              placeholder="Report PDF email"
            />
          </label>

          <div className="two-col">
            <label>
              Date
              <input
                type="date"
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                required
              />
            </label>

            <label>
              Time
              <input
                type="time"
                value={scheduleTime}
                onChange={(event) => setScheduleTime(event.target.value)}
                required
              />
            </label>
          </div>

          <span className="field-note">India Standard Time (Asia/Kolkata). The email will be sent to your account email.</span>
        </form>
      </Modal>
    </section>
  );
}

function FilterCard({
  type,
  config,
  setConfig,
  setFilter,
  categoryItemOptions,
  survivors,
  onRemove,
}) {
  const dateType = config.dateFilterType;

  return (
    <div className="filter-card">
      <div className="filter-card-head">
        <div>
          <strong>{FILTER_OPTIONS.find(([key]) => key === type)?.[1] || type}</strong>

          <span>Active filter</span>
        </div>

        <button
          className="icon-button danger-soft"
          type="button"
          title="Remove filter"
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {type === "date" ? (
        <div className="form-stack">
          <label>
            Date filter
            <select
              value={dateType}
              onChange={(e) =>
                setConfig((current) => ({
                  ...current,
                  dateFilterType: e.target.value,
                }))
              }
            >
              <option value="date">Specific date</option>

              <option value="range">Date range</option>

              <option value="month">Month</option>

              <option value="year">Year</option>
            </select>
          </label>

          {dateType === "date" ? (
            <label>
              Date
              <input
                type="date"
                max={todayKolkata()}
                value={config.filters.date}
                onChange={(e) => setFilter("date", e.target.value)}
              />
            </label>
          ) : null}

          {dateType === "range" ? (
            <div className="two-col">
              <label>
                From
                <input
                  type="date"
                  value={config.filters.dateFrom}
                  onChange={(e) => setFilter("dateFrom", e.target.value)}
                />
              </label>

              <label>
                To
                <input
                  type="date"
                  value={config.filters.dateTo}
                  onChange={(e) => setFilter("dateTo", e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {dateType === "month" ? (
            <label>
              Month
              <input
                type="month"
                value={config.filters.month}
                onChange={(e) => setFilter("month", e.target.value)}
              />
            </label>
          ) : null}

          {dateType === "year" ? (
            <label>
              Year
              <input
                type="number"
                min="2000"
                max={Number(todayKolkata().slice(0, 4))}
                value={config.filters.year}
                onChange={(e) => setFilter("year", e.target.value)}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {type === "hasProof" ? (
        <label>
          Proof status
          <select
            value={config.filters.hasProof}
            onChange={(e) => setFilter("hasProof", e.target.value)}
          >
            <option value="">Any</option>
            <option value="true">Has proof</option>
            <option value="false">No proof</option>
          </select>
        </label>
      ) : null}

      {type === "categoryItems" ? (
        <MultiPicker
          label="Category / item"
          options={categoryItemOptions}
          selected={config.filters.categoryItems}
          onToggle={(value) =>
            setFilter(
              "categoryItems",
              config.filters.categoryItems.includes(String(value))
                ? config.filters.categoryItems.filter((item) => item !== String(value))
                : [...config.filters.categoryItems, String(value)],
            )
          }
        />
      ) : null}

      {type === "survivors" ? (
        <MultiPicker
          label="Survivors"
          options={survivors.map((s) => ({
            value: s.id,
            label: s.full_name,
          }))}
          selected={config.filters.survivors}
          onToggle={(value) =>
            setFilter(
              "survivors",
              config.filters.survivors.includes(String(value))
                ? config.filters.survivors.filter((item) => item !== String(value))
                : [...config.filters.survivors, String(value)],
            )
          }
        />
      ) : null}
    </div>
  );
}

function SortArea({ sortColumns, options, onAdd, onRemove, onToggleDirection }) {
  return (
    <div className="builder-area">
      <div className="selected-row">
        {sortColumns.map((sort) => (
          <span className="chip" key={sort.column}>
            {optionLabel(options, sort.column)}

            <button
              type="button"
              title="Toggle order"
              onClick={() => onToggleDirection(sort.column)}
            >
              {sort.direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            </button>

            <button type="button" title="Remove" onClick={() => onRemove(sort.column)}>
              <X size={13} />
            </button>
          </span>
        ))}

        {!sortColumns.length ? (
          <span className="muted-inline">No sort columns selected.</span>
        ) : null}
      </div>

      <button className="secondary" type="button" onClick={onAdd}>
        <Plus size={17} />
        Add sort columns
      </button>
    </div>
  );
}

function GroupArea({ groupBy, onAdd, onRemove }) {
  return (
    <div className="builder-area">
      <div className="selected-row">
        {groupBy.map((column) => (
          <span className="chip" key={column}>
            {optionLabel(GROUP_OPTIONS, column)}

            <button type="button" title="Remove" onClick={() => onRemove(column)}>
              <X size={13} />
            </button>
          </span>
        ))}

        {!groupBy.length ? (
          <span className="muted-inline">No group-by columns selected.</span>
        ) : null}
      </div>

      <button className="secondary" type="button" onClick={onAdd}>
        <Plus size={17} />
        Add group by columns
      </button>
    </div>
  );
}

function MultiPicker({ label, options, selected, onToggle }) {
  return (
    <div className="multi-picker">
      <strong>{label}</strong>

      <div className="multi-options">
        {options.length ? (
          options.map((option) => (
            <label key={String(option.value)} className="check-option">
              <input
                type="checkbox"
                checked={selected.includes(String(option.value))}
                onChange={() => onToggle(option.value)}
              />

              <span>{option.label}</span>
            </label>
          ))
        ) : (
          <span className="muted-inline">No options available.</span>
        )}
      </div>
    </div>
  );
}

function ReportContent({ result, renderCell }) {
  if (!result) {
    return (
      <div className="empty-card">
        <BarChart3 size={30} />

        <span>Run the report to populate the content area.</span>
      </div>
    );
  }

  if (result.mode === "grouped-raw") {
    return <GroupedRawContent result={result} renderCell={renderCell} />;
  }

  return (
    <div className="report-content">
      <div className="summary-card">
        <div>
          <span>Result type</span>

          <strong>{result.mode}</strong>
        </div>

        <div>
          <span>Rows</span>

          <strong>{result.rows.length}</strong>
        </div>

        {result.mode !== "grouped" ? (
          <div>
            <span>Total</span>

            <strong>₹{Number(result.total || 0).toFixed(2)}</strong>
          </div>
        ) : null}
      </div>

      <div className="report-grid">
        {result.rows.map((row, index) => (
          <article className="report-row" key={`${index}-${row.id || index}`}>
            {result.columns.map((column) => (
              <div key={column}>
                <small>{column.replaceAll("_", " ")}</small>

                <strong>{renderCell(row, column)}</strong>
              </div>
            ))}
          </article>
        ))}

        {!result.rows.length ? (
          <div className="empty-card">No records match the selected filters.</div>
        ) : null}
      </div>
    </div>
  );
}

function GroupedRawContent({ result, renderCell }) {
  const grouped = useMemo(() => {
    const map = new Map();

    for (const row of result.rows) {
      const key = result.groupBy.map((column) => String(row[column] ?? "—")).join("\u0001");

      if (!map.has(key)) {
        map.set(key, {
          values: result.groupBy.reduce(
            (acc, column) => ({
              ...acc,
              [column]: row[column],
            }),
            {},
          ),

          rows: [],
        });
      }

      map.get(key).rows.push(row);
    }

    return [...map.values()];
  }, [result]);

  return (
    <div className="report-content">
      <div className="summary-card">
        <div>
          <span>Result type</span>

          <strong>Grouped raw data</strong>
        </div>

        <div>
          <span>Groups</span>

          <strong>{grouped.length}</strong>
        </div>

        <div>
          <span>Total</span>

          <strong>₹{Number(result.total || 0).toFixed(2)}</strong>
        </div>
      </div>

      <div className="grouped-raw-stack">
        {grouped.map((group, index) => (
          <section className="grouped-raw" key={index}>
            <div className="group-header">
              {result.groupBy.map((column) => (
                <span className="chip" key={column}>
                  {column}: {formatCell(group.values[column], column)}
                </span>
              ))}
            </div>

            {group.rows.map((row, rowIndex) => (
              <article className="report-row" key={`${row.id}-${rowIndex}`}>
                {result.columns
                  .filter((column) => !result.groupBy.includes(column))
                  .map((column) => (
                    <div key={column}>
                      <small>{column.replaceAll("_", " ")}</small>

                      <strong>{renderCell(row, column)}</strong>
                    </div>
                  ))}
              </article>
            ))}
          </section>
        ))}

        {!grouped.length ? (
          <div className="empty-card">No records match the selected filters.</div>
        ) : null}
      </div>
    </div>
  );
}
