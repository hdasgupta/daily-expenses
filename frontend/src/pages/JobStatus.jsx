import React, { useEffect, useRef, useState } from "react";
import { BarChart3, CheckCircle2, Edit3, Info, LoaderCircle, RefreshCw, Trash2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import ScheduledReportForm from "../components/ScheduledReportForm";
import { usePagination } from "../hooks/usePagination";
import { getDashboardReports } from "./Dashboard";
import { shiftIsoDate, todayKolkata } from "../utils/dates.js";
import "./jobStatus.css";
import "./scheduledReports.css";

const scheduleLabels = {
  "daily-planned-recipe-email": "Daily planned recipe email (admin only)",
  "daily-email-report": "Daily 7-day email report",
  "weekly-email-report": "Weekly 4-week email report",
  "monthly-email-report": "Monthly 3-month email report",
  "yearly-email-report": "Yearly 2-year email report",
  "marketing-list-email": "Marketing List email",
};

const scheduleOrder = {
  daily: 1,
  weekly: 2,
  monthly: 3,
  yearly: 4,
};

const staticScheduleOrder = {
  "daily-planned-recipe-email": 1,
  "daily-email-report": 2,
  "weekly-email-report": 3,
  "monthly-email-report": 4,
  "yearly-email-report": 5,
  "marketing-list-email": 6,
};

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return "—";

  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;

  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}

function formatCronTime(hour, minute) {
  const date = new Date(2000, 0, 1, Number(hour), Number(minute));

  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function describeCron(cronExpression, jobName = "") {
  if (!cronExpression) return "—";

  const normalizedCron = cronExpression.trim();

  if (
    jobName === "monthly-email-report" &&
    /^\d+\s+\d+\s+(L|28-31)\s+\*\s+\*$/i.test(normalizedCron)
  ) {
    const parts = normalizedCron.split(/\s+/);
    return `Last day of every month at ${formatCronTime(parts[1], parts[0])}`;
  }

  const parts = normalizedCron.split(/\s+/);

  if (parts.length !== 5 && parts.length !== 6) {
    return cronExpression;
  }

  const offset = parts.length === 6 ? 1 : 0;

  const minute = parts[offset];
  const hour = parts[offset + 1];
  const dayOfMonth = parts[offset + 2];
  const month = parts[offset + 3];
  const dayOfWeek = parts[offset + 4];

  if (minute === "*" && hour === "*") {
    return "Every minute";
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const time = formatCronTime(hour, minute);

    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `Every day at ${time}`;
    }

    if (dayOfMonth === "1" && month === "*" && dayOfWeek === "*") {
      return `On the 1st day of every month at ${time}`;
    }

    if (dayOfMonth === "1" && month === "1" && dayOfWeek === "*") {
      return `Every January 1 at ${time}`;
    }

    if (dayOfMonth === "*" && month === "*" && /^\d+$/.test(dayOfWeek)) {
      return `Every ${weekdayNames[Number(dayOfWeek)] || dayOfWeek} at ${time}`;
    }

    if (dayOfMonth === "*" && month === "*" && /^\d+(,\d+)+$/.test(dayOfWeek)) {
      return `Every ${dayOfWeek
        .split(",")
        .map((value) => weekdayNames[Number(value)] || value)
        .join(", ")} at ${time}`;
    }

    if (/^\d+$/.test(dayOfMonth) && /^\d+$/.test(month) && dayOfWeek === "*") {
      return `Every ${monthNames[Number(month) - 1] || month} ${dayOfMonth} at ${time}`;
    }
  }

  if (/^\*\/\d+$/.test(minute) && hour === "*") {
    return `Every ${Number(minute.slice(2))} minutes`;
  }

  if (/^\*\/\d+$/.test(hour) && minute === "0") {
    return `Every ${Number(hour.slice(2))} hours`;
  }

  return cronExpression;
}

const reportFieldLabels = {
  date: "date",
  week: "week",
  month: "month",
  year: "year",
  survivor: "survivor",
  category: "category",
  item: "item",
  price: "amount",
};

function describeReportConfig(config = {}, { categoryOnly = false } = {}) {
  const filters = config.filters || {};
  const filterParts = [];

  if (filters.date) filterParts.push(`date = ${filters.date}`);
  if (filters.dateFrom || filters.dateTo) {
    filterParts.push(`date range = ${filters.dateFrom || "any"} to ${filters.dateTo || "any"}`);
  }
  if (filters.month) filterParts.push(`month = ${filters.month}`);
  if (filters.year) filterParts.push(`year = ${filters.year}`);
  if (filters.hasProof === "true") filterParts.push("has proof = yes");
  if (filters.hasProof === "false") filterParts.push("has proof = no");

  if (filters.categoryItems?.length) {
    const labels = Array.isArray(filters.categoryItemLabels)
      ? filters.categoryItemLabels
      : filters.categoryItems;
    const categoriesOnly = [
      ...new Set(
        labels
          .map((value) =>
            String(value)
              .split(/\s+-\s+/)[0]
              .trim(),
          )
          .filter(Boolean),
      ),
    ];
    filterParts.push(
      `${categoryOnly ? "categories" : "category"} = ${(categoryOnly ? categoriesOnly : labels).join(", ")}`,
    );
  }
  if (filters.categories?.length) {
    const categoryLabels = Array.isArray(filters.categoryLabels)
      ? filters.categoryLabels
      : filters.categories;
    filterParts.push(`categories = ${categoryLabels.join(", ")}`);
  }
  if (filters.survivors?.length) filterParts.push(`survivors = ${filters.survivors.join(", ")}`);

  const groupBy = Array.isArray(config.groupBy) ? config.groupBy : [];
  const groupText = groupBy.length
    ? groupBy.map((value) => reportFieldLabels[value] || value).join(", ")
    : "none";

  const sortColumns = Array.isArray(config.sortColumns) ? config.sortColumns : [];
  const sortText = sortColumns.length
    ? sortColumns
        .map(
          (item) =>
            `${reportFieldLabels[item.column] || item.column} ${item.direction === "desc" ? "descending" : "ascending"}`,
        )
        .join(", ")
    : groupBy.length
      ? "grouping order, then newest expense date first"
      : "default expense order";

  return {
    filters: filterParts.length ? filterParts.join("; ") : "none — all matching expense records",
    groupBy: groupText,
    sorting: sortText,
    summarise: config.summarise
      ? "yes — values are aggregated per group"
      : "no — individual expense records are retained",
  };
}

function describeDashboardJobFilters(filters = {}) {
  if (!filters || typeof filters !== "object") {
    return "All categories & survivors";
  }
  const parts = [];
  const categories =
    Array.isArray(filters.categoryLabels) && filters.categoryLabels.length
      ? filters.categoryLabels
      : Array.isArray(filters.categories) && filters.categories.length
        ? filters.categories
        : [];
  const survivors =
    Array.isArray(filters.survivorLabels) && filters.survivorLabels.length
      ? filters.survivorLabels
      : Array.isArray(filters.survivors) && filters.survivors.length
        ? filters.survivors
        : [];
  if (categories.length) {
    parts.push(`Categories: ${categories.join(", ")}`);
  }
  if (survivors.length) {
    parts.push(`Survivors: ${survivors.join(", ")}`);
  }
  return parts.length ? parts.join(" · ") : "All categories & survivors";
}

function PdfContentsInfo({
  config,
  dashboardSource = "",
  dashboardFilters = "",
  categoryOnly = false,
}) {
  const details = config ? describeReportConfig(config, { categoryOnly }) : null;
  const description = details
    ? `PDF contents: report chart, summary/pivot table, and filtered raw expense data. Filters: ${details.filters}. Group by: ${details.groupBy}. Sorting: ${details.sorting}. Summarised: ${details.summarise}. Interactive dashboard controls are not included.`
    : `PDF contains the dashboard report chart, summary/pivot table, and underlying expense data. Dashboard source: ${dashboardSource || "predefined dashboard report"}. Filters applied: ${dashboardFilters || "All categories & survivors"}. Interactive dashboard controls are not included.`;

  return (
    <span className="job-pdf-info">
      <button className="job-info-icon" type="button" aria-label="About PDF contents">
        <Info size={14} />
      </button>
      <span className="job-info-tooltip" role="tooltip">
        {description}
      </span>
    </span>
  );
}

const ERROR_TEXT_PATTERN =
  /\b(error|failed|failure|exception|timeout|timed out|refused|rejected|invalid|unable|cannot|denied|unhandled|interrupted|unauthorized|forbidden|econn|enotfound|etimedout|socket|crash)\b/i;

function isLikelyErrorText(text, status) {
  if (status === "failed") return true;
  if (status === "skipped") return false;
  return ERROR_TEXT_PATTERN.test(String(text || ""));
}

function renderExecutionDetailCell(row) {
  const raw = String(row?.error_message || "").trim();
  if (!raw) {
    return <span className="job-detail-muted">—</span>;
  }

  const splitMatch = raw.match(/^(Recipients:\s*\d+)\s*[—-]\s*(.+)$/i);
  if (splitMatch) {
    const recipientPart = splitMatch[1];
    const detailPart = splitMatch[2].trim();
    const isErr = isLikelyErrorText(detailPart, row?.status);
    return (
      <span className="job-detail-split">
        <span className={`job-detail-chip ${isErr ? "muted" : "info"}`}>{recipientPart}</span>
        <span className={isErr ? "job-detail-error" : "job-detail-muted"}>{detailPart}</span>
      </span>
    );
  }

  if (/^Recipients:\s*\d+$/i.test(raw) || /^recipients=\d+/i.test(raw)) {
    const isSuccess = row?.status === "completed";
    return (
      <span className={`job-detail-chip ${isSuccess ? "success" : "info"}`}>{raw}</span>
    );
  }

  if (isLikelyErrorText(raw, row?.status)) {
    return <span className="job-detail-error">{raw}</span>;
  }

  return <span className="job-detail-info">{raw}</span>;
}

function statusIcon(status) {
  if (status === "completed") {
    return <CheckCircle2 size={15} />;
  }

  if (status === "failed") {
    return <XCircle size={15} />;
  }

  if (status === "skipped") {
    return <CheckCircle2 size={15} />;
  }

  return <LoaderCircle size={15} className="job-status-spin" />;
}

function describeScheduledJob(job) {
  if (job.frequency === "daily") {
    return `Every day at ${formatCronTime(
      Number(job.time_of_day.slice(0, 2)),
      Number(job.time_of_day.slice(3, 5)),
    )}`;
  }

  if (job.frequency === "weekly") {
    return `Every ${weekdayNames[Number(job.day_of_week)] || "week"} at ${formatCronTime(
      Number(job.time_of_day.slice(0, 2)),
      Number(job.time_of_day.slice(3, 5)),
    )}`;
  }

  if (job.frequency === "monthly") {
    return `Day ${job.day_of_month} of every month at ${formatCronTime(
      Number(job.time_of_day.slice(0, 2)),
      Number(job.time_of_day.slice(3, 5)),
    )}`;
  }

  return `Every ${
    monthNames[Number(job.month_of_year) - 1] || "year"
  } ${job.day_of_month} at ${formatCronTime(
    Number(job.time_of_day.slice(0, 2)),
    Number(job.time_of_day.slice(3, 5)),
  )}`;
}

const DASHBOARD_REPORT_SPECS = {
  daily: { unit: "day", count: 7, groupBy: ["date"] },
  weekly: { unit: "week", count: 4, groupBy: ["week"] },
  monthly: { unit: "month", count: 3, groupBy: ["month"] },
  yearly: { unit: "year", count: 2, groupBy: ["year"] },
  "daily-category": { unit: "day", count: 7, groupBy: ["date", "category"] },
  "weekly-category": { unit: "week", count: 4, groupBy: ["week", "category"] },
  "monthly-category": { unit: "month", count: 3, groupBy: ["month", "category"] },
  "yearly-category": { unit: "year", count: 2, groupBy: ["year", "category"] },
  "daily-survivor": { unit: "day", count: 7, groupBy: ["date", "survivor"] },
  "weekly-survivor": { unit: "week", count: 4, groupBy: ["week", "survivor"] },
  "monthly-survivor": { unit: "month", count: 3, groupBy: ["month", "survivor"] },
  "yearly-survivor": { unit: "year", count: 2, groupBy: ["year", "survivor"] },
  "daily-survivor-category": { unit: "day", count: 7, groupBy: ["date", "survivor", "category"] },
  "weekly-survivor-category": { unit: "week", count: 4, groupBy: ["week", "survivor", "category"] },
  "monthly-survivor-category": { unit: "month", count: 3, groupBy: ["month", "survivor", "category"] },
  "yearly-survivor-category": { unit: "year", count: 2, groupBy: ["year", "survivor", "category"] },
};

function computeDashboardDateRange(unit, count) {
  const yesterday = shiftIsoDate(todayKolkata(), -1);
  if (unit === "day") {
    return { dateFrom: shiftIsoDate(yesterday, -(count - 1)), dateTo: yesterday };
  }
  if (unit === "week") {
    return { dateFrom: shiftIsoDate(yesterday, -(count * 7 - 1)), dateTo: yesterday };
  }
  if (unit === "month") {
    const [y, m] = yesterday.split("-").map(Number);
    const startDate = new Date(Date.UTC(y, m - 1 - (count - 1), 1));
    return { dateFrom: startDate.toISOString().slice(0, 10), dateTo: yesterday };
  }
  const [y] = yesterday.split("-").map(Number);
  return { dateFrom: `${y - (count - 1)}-01-01`, dateTo: yesterday };
}

function buildDashboardJobReportConfig(job) {
  const spec = DASHBOARD_REPORT_SPECS[job?.report_key] || {
    unit: "day",
    count: 7,
    groupBy: ["date"],
  };
  const range = computeDashboardDateRange(spec.unit, spec.count);
  const categories = Array.isArray(job?.filters?.categories)
    ? job.filters.categories.map(String).filter(Boolean)
    : [];
  const survivors = Array.isArray(job?.filters?.survivors)
    ? job.filters.survivors.map(String).filter(Boolean)
    : [];

  const activeFilters = ["date"];
  if (categories.length) activeFilters.push("categories");
  if (survivors.length) activeFilters.push("survivors");

  const sortColumns = spec.groupBy.map((column, index) => ({
    column,
    direction: index === 0 ? "desc" : "asc",
  }));

  return {
    activeFilters,
    dateFilterType: "range",
    filters: {
      date: "",
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      month: "",
      year: "",
      hasProof: "",
      categoryItems: [],
      categories,
      survivors,
    },
    sortColumns,
    groupBy: [...spec.groupBy],
    summarise: true,
  };
}

export default function JobStatus({ user, navigate }) {
  const pagination = usePagination("job-status", null);

  const [page, setPage] = useState(1);
  const [schedules, setSchedules] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [scheduledJobs, setScheduledJobs] = useState([]);
  const [oneTimeJobs, setOneTimeJobs] = useState([]);
  const [dashboardEmailPage, setDashboardEmailPage] = useState(1);
  const [dashboardEmailPageSize, setDashboardEmailPageSize] = useState(5);
  const [dashboardEmailSearch, setDashboardEmailSearch] = useState("");
  const [oneTimeEmailPage, setOneTimeEmailPage] = useState(1);
  const [oneTimeEmailPageSize, setOneTimeEmailPageSize] = useState(5);
  const [oneTimeEmailSearch, setOneTimeEmailSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [editingJob, setEditingJob] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [deletingJob, setDeletingJob] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deletingOneTimeJob, setDeletingOneTimeJob] = useState(null);
  const [oneTimeDeleteBusy, setOneTimeDeleteBusy] = useState(false);
  const followUpTimerRef = useRef(null);
  const loadInFlightRef = useRef(false);
  const lastDueTriggerAtRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearInterval(timer);
      if (followUpTimerRef.current) clearTimeout(followUpTimerRef.current);
    };
  }, []);

  const load = async ({ silent = false } = {}) => {
    if (!pagination.ready || loadInFlightRef.current) return;
    loadInFlightRef.current = true;

    if (followUpTimerRef.current) {
      clearTimeout(followUpTimerRef.current);
      followUpTimerRef.current = null;
    }

    try {
      const [statusData, customJobs] = await Promise.all([
        api(
          `/job-status?page=${page}&pageSize=${pagination.pageSize}&search=${encodeURIComponent(
            pagination.search,
          )}`,
          {
            loadingMessage: silent ? undefined : "Loading job status…",
            silent,
          },
        ),
        api("/scheduled-reports", {
          loadingMessage: silent ? undefined : "Loading scheduled reports…",
          silent,
        }),
      ]);

      setSchedules(
        [...(statusData.schedules || [])]
          .map((item) => ({
            ...item,
            label:
              scheduleLabels[item.jobName] ||
              String(item.label || "").replace(/\s*\(next day\)/gi, ""),
          }))
          .sort(
            (a, b) =>
              (staticScheduleOrder[a.jobName] || 99) - (staticScheduleOrder[b.jobName] || 99),
          ),
      );

      const fetchedRows = statusData.rows || [];
      setRows(fetchedRows);
      setTotal(statusData.total || 0);
      setOneTimeJobs(statusData.oneTimeScheduledJobs || []);

      setScheduledJobs(
        [...(customJobs || [])].sort(
          (a, b) =>
            (scheduleOrder[a.frequency] || 99) - (scheduleOrder[b.frequency] || 99) ||
            String(a.time_of_day).localeCompare(String(b.time_of_day)) ||
            String(a.name).localeCompare(String(b.name)),
        ),
      );

      if (statusData.hasMoreDueJobs || fetchedRows.some((row) => row.status === "running")) {
        followUpTimerRef.current = setTimeout(() => {
          load({ silent: true }).catch(() => {});
        }, 1500);
      }
    } finally {
      loadInFlightRef.current = false;
    }
  };

  useEffect(() => {
    setPage(1);
  }, [pagination.search, pagination.pageSize]);

  useEffect(() => {
    load().catch(() => {});
  }, [page, pagination.pageSize, pagination.search, pagination.ready]);

  useEffect(() => {
    if (!pagination.ready) return undefined;

    const timer = setInterval(() => {
      load({ silent: true }).catch(() => {});
    }, 15000);

    return () => clearInterval(timer);
  }, [page, pagination.pageSize, pagination.search, pagination.ready]);

  // Immediately trigger a silent poll as soon as any scheduled one-time email
  // or custom dashboard report crosses its scheduled timestamp.
  useEffect(() => {
    if (!pagination.ready || loadInFlightRef.current) return;
    if (now - lastDueTriggerAtRef.current < 8000) return;

    const hasDueOneTime = oneTimeJobs.some((job) => {
      if (!job.scheduled_for) return false;
      const targetMs = new Date(job.scheduled_for).getTime();
      return Number.isFinite(targetMs) && targetMs <= now;
    });

    const hasDueScheduled = scheduledJobs.some((job) => {
      if (!job.active || !job.next_run_at) return false;
      const targetMs = new Date(job.next_run_at).getTime();
      return Number.isFinite(targetMs) && targetMs <= now;
    });

    if (hasDueOneTime || hasDueScheduled) {
      lastDueTriggerAtRef.current = now;
      load({ silent: true }).catch(() => {});
    }
  }, [now, oneTimeJobs, scheduledJobs, pagination.ready]);

  const refresh = async () => {
    setRefreshing(true);

    try {
      await load({ silent: true });
    } finally {
      setRefreshing(false);
    }
  };

  const saveEdit = async (payload) => {
    setEditBusy(true);

    try {
      await api(`/scheduled-reports/${editingJob.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
        loadingMessage: "Saving scheduled report…",
      });

      setEditingJob(null);
      await load({ silent: true });
    } finally {
      setEditBusy(false);
    }
  };

  const removeJob = async () => {
    setDeleteBusy(true);

    try {
      await api(`/scheduled-reports/${deletingJob.id}`, {
        method: "DELETE",
        loadingMessage: "Removing scheduled report…",
      });

      setDeletingJob(null);
      await load({ silent: true });
    } finally {
      setDeleteBusy(false);
    }
  };

  const removeOneTimeJob = async () => {
    setOneTimeDeleteBusy(true);

    try {
      await api(`/reports/schedule-email/${deletingOneTimeJob.id}`, {
        method: "DELETE",
        loadingMessage: "Removing one-time report email…",
      });

      setDeletingOneTimeJob(null);
      await load({ silent: true });
    } finally {
      setOneTimeDeleteBusy(false);
    }
  };

  const reportForJob = (job) =>
    getDashboardReports().find((report) => report.key === job.report_key) || {
      key: job.report_key,
      label: job.report_label || job.report_key,
      help: "Scheduled dashboard report",
    };

  const canManage = (job) =>
    user?.role === "admin" || String(job.owner_user_id) === String(user?.id);

  const canOpenReports =
    !Array.isArray(user?.permissions) || user.permissions.includes("report");

  const openJobInReports = (reportConfig) => {
    try {
      sessionStorage.setItem(
        "job_status_open_report_config",
        JSON.stringify({ config: reportConfig || {}, autoRun: true }),
      );
    } catch {
      // Ignore storage errors
    }
    navigate?.("/reports");
  };

  const filteredDashboardEmails = scheduledJobs.filter((job) => {
    const query = dashboardEmailSearch.trim().toLocaleLowerCase();
    return (
      !query ||
      [
        job.name,
        job.report_label,
        job.report_help,
        job.owner_name,
        job.owner_email,
        describeDashboardJobFilters(job.filters),
      ].some((value) =>
        String(value || "")
          .toLocaleLowerCase()
          .includes(query),
      )
    );
  });
  const dashboardEmailPageCount = Math.max(
    1,
    Math.ceil(filteredDashboardEmails.length / dashboardEmailPageSize),
  );
  const visibleDashboardEmails = filteredDashboardEmails.slice(
    (Math.min(dashboardEmailPage, dashboardEmailPageCount) - 1) * dashboardEmailPageSize,
    Math.min(dashboardEmailPage, dashboardEmailPageCount) * dashboardEmailPageSize,
  );

  const filteredOneTimeEmails = oneTimeJobs.filter((job) => {
    const query = oneTimeEmailSearch.trim().toLocaleLowerCase();
    return (
      !query ||
      [
        job.name,
        job.status,
        job.last_error,
        job.owner_name,
        job.owner_email,
        job.creator_name,
        job.creator_email,
      ].some((value) =>
        String(value || "")
          .toLocaleLowerCase()
          .includes(query),
      )
    );
  });
  const oneTimeEmailPageCount = Math.max(
    1,
    Math.ceil(filteredOneTimeEmails.length / oneTimeEmailPageSize),
  );
  const visibleOneTimeEmails = filteredOneTimeEmails.slice(
    (Math.min(oneTimeEmailPage, oneTimeEmailPageCount) - 1) * oneTimeEmailPageSize,
    Math.min(oneTimeEmailPage, oneTimeEmailPageCount) * oneTimeEmailPageSize,
  );

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Job Status</h1>

          <p>View configured scheduler jobs and manage user-scheduled dashboard report emails.</p>
        </div>

        <button className="secondary" type="button" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={17} className={refreshing ? "job-status-spin" : ""} />

          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">
          <strong>Scheduled dashboard emails</strong>

          <span>
            Created from Dashboard detail pages. Each job sends one PDF to its owner at the selected
            time.
          </span>
        </div>

        {scheduledJobs.length ? (
          <div className="scheduled-job-stack">
            {visibleDashboardEmails.map((job) => (
              <article className="scheduled-job-card" key={job.id}>
                <div className="scheduled-job-head">
                  <div>
                    <strong>{job.name}</strong>

                    <span>{job.report_label}</span>
                  </div>

                  <span className={`scheduled-job-status ${job.active ? "active" : "paused"}`}>
                    {job.active ? "Active" : "Paused"}
                  </span>
                </div>

                <div className="scheduled-job-meta">
                  <span>
                    <b>Timing:</b> {describeScheduledJob(job)}
                  </span>

                  <span>
                    <b>Next run:</b> {job.next_run_at ? formatDate(job.next_run_at) : "—"}
                  </span>

                  <span>
                    <b>Job created by:</b>{" "}
                    {job.creator_name || job.creator_email
                      ? `${job.creator_name || "Unknown"} · ${job.creator_email || "—"}`
                      : "Unknown"}
                  </span>

                  <span>
                    <b>Dashboard source:</b> {job.report_label} —{" "}
                    {job.report_help || "Dashboard report"}
                  </span>

                  <span>
                    <b>Filters applied:</b> {describeDashboardJobFilters(job.filters)}
                  </span>

                  <span className="job-pdf-content">
                    <b>PDF contents:</b> Chart · summary/pivot table · raw data{" "}
                    <PdfContentsInfo
                      dashboardSource={`${job.report_label} — ${job.report_help || "Dashboard report"}`}
                      dashboardFilters={describeDashboardJobFilters(job.filters)}
                    />
                  </span>

                  <span>
                    <b>Timezone:</b> Asia/Kolkata
                  </span>
                </div>

                {user?.role === "admin" ? (
                  <div className="scheduled-job-owner">
                    <b>Owner:</b> {job.owner_name} · {job.owner_email}
                  </div>
                ) : null}

                {canOpenReports || canManage(job) ? (
                  <div className="scheduled-report-actions" style={{ marginTop: 10 }}>
                    {canOpenReports ? (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => openJobInReports(buildDashboardJobReportConfig(job))}
                      >
                        <BarChart3 size={15} />
                        Show report
                      </button>
                    ) : null}

                    {canManage(job) ? (
                      <>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => setEditingJob(job)}
                        >
                          <Edit3 size={15} />
                          Edit
                        </button>

                        <button
                          className="danger"
                          type="button"
                          onClick={() => setDeletingJob(job)}
                        >
                          <Trash2 size={15} />
                          Remove
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-card">
            No user-scheduled report emails yet. Open a Dashboard report and choose “Schedule
            email”.
          </div>
        )}
        {scheduledJobs.length ? (
          <Pagination
            page={dashboardEmailPage}
            total={filteredDashboardEmails.length}
            pageSize={dashboardEmailPageSize}
            setPage={setDashboardEmailPage}
            setPageSize={setDashboardEmailPageSize}
            search={dashboardEmailSearch}
            setSearch={(value) => {
              setDashboardEmailSearch(value);
              setDashboardEmailPage(1);
            }}
            sortColumn={null}
            sortDirection="asc"
            setSort={() => {}}
            sortOptions={[]}
          />
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">
          <strong>One-time report PDF emails</strong>
          <span>
            Scheduled from the Report page. Each item disappears after the email is successfully
            triggered.
          </span>
        </div>

        {oneTimeJobs.length ? (
          <div className="scheduled-job-stack">
            {visibleOneTimeEmails.map((job) => (
              <article className="scheduled-job-card" key={job.id}>
                <div className="scheduled-job-head">
                  <div>
                    <strong>{job.name}</strong>
                    <span>Report PDF email</span>
                  </div>
                  <span
                    className={`scheduled-job-status ${job.status === "failed" ? "paused" : "active"}`}
                  >
                    {job.status === "failed" ? "Retrying" : "Scheduled"}
                  </span>
                </div>

                <div className="scheduled-job-meta">
                  <span>
                    <b>Job created by:</b>{" "}
                    {job.creator_name || job.creator_email
                      ? `${job.creator_name || "Unknown"} · ${job.creator_email || "—"}`
                      : "—"}
                  </span>
                  <span>
                    <b>Job for:</b>{" "}
                    {job.owner_name || job.owner_email
                      ? `${job.owner_name || "Unknown"} · ${job.owner_email || "—"}`
                      : "—"}
                  </span>
                  <span>
                    <b>Scheduled for:</b> {formatDate(job.scheduled_for)}
                  </span>
                  <span>
                    <b>Timezone:</b> Asia/Kolkata
                  </span>
                  <span className="job-pdf-content">
                    <b>PDF contents:</b> Report chart · summary/pivot table · raw data{" "}
                    <PdfContentsInfo config={job.config} categoryOnly />
                  </span>
                  {job.last_attempt_at ? (
                    <span>
                      <b>Last attempt:</b> {formatDate(job.last_attempt_at)}
                    </span>
                  ) : null}
                  {job.last_error ? (
                    <span>
                      <b>Last error:</b> {job.last_error}
                    </span>
                  ) : null}
                </div>

                <div className="scheduled-report-actions" style={{ marginTop: 10 }}>
                  {canOpenReports ? (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => openJobInReports(job.config || {})}
                    >
                      <BarChart3 size={15} />
                      Show report
                    </button>
                  ) : null}
                  <button
                    className="danger"
                    type="button"
                    onClick={() => setDeletingOneTimeJob(job)}
                  >
                    <Trash2 size={15} />
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-card">No one-time report emails are currently scheduled.</div>
        )}
        {oneTimeJobs.length ? (
          <Pagination
            page={oneTimeEmailPage}
            total={filteredOneTimeEmails.length}
            pageSize={oneTimeEmailPageSize}
            setPage={setOneTimeEmailPage}
            setPageSize={setOneTimeEmailPageSize}
            search={oneTimeEmailSearch}
            setSearch={(value) => {
              setOneTimeEmailSearch(value);
              setOneTimeEmailPage(1);
            }}
            sortColumn={null}
            sortDirection="asc"
            setSort={() => {}}
            sortOptions={[]}
          />
        ) : null}
      </div>

      <div className="job-schedule-grid">
        {schedules.map((schedule) => (
          <article className="card job-schedule-card" key={schedule.jobName}>
            <div className="job-schedule-head">
              <strong>{schedule.label}</strong>

              <span
                className={`job-config-badge ${
                  schedule.configured && schedule.valid ? "configured" : "not-configured"
                }`}
              >
                {schedule.configured && schedule.valid ? "Configured" : "Not configured"}
              </span>
            </div>

            <div className="job-schedule-details">
              <span>
                <b>Execution timing:</b> {describeCron(schedule.cron, schedule.jobName)}
              </span>

              <span>
                <b>Timezone:</b> {schedule.timezone || "—"}
              </span>

              <span>
                <b>Next scheduled run:</b>{" "}
                {schedule.nextRunAt ? formatDate(schedule.nextRunAt) : "—"}
              </span>
            </div>
          </article>
        ))}
      </div>

      <Pagination page={page} setPage={setPage} total={total} {...pagination} sortOptions={[]} />

      <div className="card">
        <div className="card-title">
          <strong>Execution history</strong>

          <span>{total} recorded execution(s)</span>
        </div>

        <div className="table-scroll">
          <table className="data-table job-status-table">
            <thead>
              <tr>
                <th>Job</th>
                {user?.role === "admin" ? <th>Owner / manager</th> : null}
                <th>Status</th>
                <th>Scheduled key</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Running since</th>
                <th>Duration</th>
                <th>Error / details</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {String(
                      scheduleLabels[row.job_name] ||
                        row.scheduled_report_name ||
                        row.job_name ||
                        "",
                    ).replace(/\s*\(next day\)/gi, "")}
                  </td>

                  {user?.role === "admin" ? (
                    <td>
                      {row.owner_name || row.owner_email
                        ? `${row.owner_name || "Unknown"} · ${row.owner_email || "—"}`
                        : row.job_name?.startsWith("scheduled-report:")
                          ? "Owner unavailable (job removed)"
                          : "All managers / system"}
                    </td>
                  ) : null}

                  <td>
                    <span className={`job-status-badge ${row.status}`}>
                      {statusIcon(row.status)}
                      {row.status}
                    </span>
                  </td>

                  <td>{row.scheduled_key || "—"}</td>

                  <td>{formatDate(row.started_at)}</td>

                  <td>{formatDate(row.completed_at)}</td>

                  <td>{row.status === "running" ? formatDate(row.started_at) : "—"}</td>

                  <td>
                    {row.status === "running"
                      ? formatDuration(now - new Date(row.started_at).getTime())
                      : row.duration_ms == null
                        ? "—"
                        : `${row.duration_ms} ms`}
                  </td>

                  <td className="job-error-cell">{renderExecutionDetailCell(row)}</td>
                </tr>
              ))}

              {!rows.length ? (
                <tr>
                  <td colSpan={user?.role === "admin" ? 9 : 8}>
                    <div className="empty-card">
                      No scheduler executions have been recorded yet.
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} setPage={setPage} total={total} {...pagination} sortOptions={[]} />

      <Modal
        open={Boolean(editingJob)}
        title={editingJob ? `Edit ${editingJob.name}` : "Edit scheduled report"}
        onClose={() => editBusy || setEditingJob(null)}
      >
        {editingJob ? (
          <ScheduledReportForm
            report={reportForJob(editingJob)}
            job={editingJob}
            recipient={editingJob.owner_email}
            onSubmit={saveEdit}
            busy={editBusy}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingOneTimeJob)}
        title="Remove one-time report email"
        message={
          deletingOneTimeJob
            ? `Remove “${deletingOneTimeJob.name}”? The one-time email will no longer be sent.`
            : ""
        }
        onCancel={() => oneTimeDeleteBusy || setDeletingOneTimeJob(null)}
        onConfirm={removeOneTimeJob}
        busy={oneTimeDeleteBusy}
      />

      <ConfirmDialog
        open={Boolean(deletingJob)}
        title="Remove scheduled report"
        message={
          deletingJob ? `Remove “${deletingJob.name}”? Future emails for this job will stop.` : ""
        }
        onCancel={() => deleteBusy || setDeletingJob(null)}
        onConfirm={removeJob}
        busy={deleteBusy}
      />
    </section>
  );
}
