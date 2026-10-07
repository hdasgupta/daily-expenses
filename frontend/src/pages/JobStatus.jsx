import React, { useEffect, useState } from "react";
import { CheckCircle2, Edit3, Info, LoaderCircle, RefreshCw, Trash2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import ScheduledReportForm from "../components/ScheduledReportForm";
import { usePagination } from "../hooks/usePagination";
import { getDashboardReports } from "./Dashboard";
import "./jobStatus.css";
import "./scheduledReports.css";

const scheduleLabels = {
  "daily-email-report": "Daily 7-day email report",
  "weekly-email-report": "Weekly 4-week email report",
  "monthly-email-report": "Monthly 3-month email report",
  "yearly-email-report": "Yearly 12-month email report",
};

const scheduleOrder = {
  daily: 1,
  weekly: 2,
  monthly: 3,
  yearly: 4,
};

const staticScheduleOrder = {
  "daily-email-report": 1,
  "weekly-email-report": 2,
  "monthly-email-report": 3,
  "yearly-email-report": 4,
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

function describeCron(cronExpression) {
  if (!cronExpression) return "—";

  const parts = cronExpression.trim().split(/\s+/);

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
    const categoriesOnly = [...new Set(
      labels
        .map((value) => String(value).split(/\s+-\s+/)[0].trim())
        .filter(Boolean),
    )];
    filterParts.push(
      `${categoryOnly ? "categories" : "category"} = ${(categoryOnly ? categoriesOnly : labels).join(", ")}`,
    );
  }
  if (filters.categories?.length) filterParts.push(`categories = ${filters.categories.join(", ")}`);
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

function PdfContentsInfo({ config, dashboardSource = "", categoryOnly = false }) {
  const details = config ? describeReportConfig(config, { categoryOnly }) : null;
  const description = details
    ? `PDF contents: report chart, summary/pivot table, and filtered raw expense data. Filters: ${details.filters}. Group by: ${details.groupBy}. Sorting: ${details.sorting}. Summarised: ${details.summarise}. Interactive dashboard controls are not included.`
    : `PDF contains the dashboard report chart, summary/pivot table, and underlying expense data. Dashboard source: ${dashboardSource || "predefined dashboard report"}. Interactive dashboard controls are not included.`;

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

function statusIcon(status) {
  if (status === "completed") {
    return <CheckCircle2 size={15} />;
  }

  if (status === "failed") {
    return <XCircle size={15} />;
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

export default function JobStatus({ user }) {
  const pagination = usePagination("job-status", null);

  const [page, setPage] = useState(1);
  const [schedules, setSchedules] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [scheduledJobs, setScheduledJobs] = useState([]);
  const [oneTimeJobs, setOneTimeJobs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [editingJob, setEditingJob] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [deletingJob, setDeletingJob] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deletingOneTimeJob, setDeletingOneTimeJob] = useState(null);
  const [oneTimeDeleteBusy, setOneTimeDeleteBusy] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  const load = async ({ silent = false } = {}) => {
    if (!pagination.ready) return;

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
      [...(statusData.schedules || [])].sort(
        (a, b) => (staticScheduleOrder[a.jobName] || 99) - (staticScheduleOrder[b.jobName] || 99),
      ),
    );

    setRows(statusData.rows || []);
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
    }, 30000);

    return () => clearInterval(timer);
  }, [page, pagination.pageSize, pagination.search, pagination.ready]);

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
            {scheduledJobs.map((job) => (
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
                    <b>Dashboard source:</b> {job.report_label} — {job.report_help || "Dashboard report"}
                  </span>

                  <span className="job-pdf-content">
                    <b>PDF contents:</b> Chart · summary/pivot table · raw data <PdfContentsInfo dashboardSource={`${job.report_label} — ${job.report_help || "Dashboard report"}`} />
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

                {canManage(job) ? (
                  <div className="scheduled-report-actions" style={{ marginTop: 10 }}>
                    <button className="secondary" type="button" onClick={() => setEditingJob(job)}>
                      <Edit3 size={15} />
                      Edit
                    </button>

                    <button className="danger" type="button" onClick={() => setDeletingJob(job)}>
                      <Trash2 size={15} />
                      Remove
                    </button>
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
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">
          <strong>One-time report PDF emails</strong>
          <span>Scheduled from the Report page. Each item disappears after the email is successfully triggered.</span>
        </div>

        {oneTimeJobs.length ? (
          <div className="scheduled-job-stack">
            {oneTimeJobs.map((job) => (
              <article className="scheduled-job-card" key={job.id}>
                <div className="scheduled-job-head">
                  <div>
                    <strong>{job.name}</strong>
                    <span>Report PDF email</span>
                  </div>
                  <span className={`scheduled-job-status ${job.status === "failed" ? "paused" : "active"}`}>
                    {job.status === "failed" ? "Retrying" : "Scheduled"}
                  </span>
                </div>

                <div className="scheduled-job-meta">
                  <span><b>Scheduled for:</b> {formatDate(job.scheduled_for)}</span>
                  <span><b>Timezone:</b> Asia/Kolkata</span>
                  <span className="job-pdf-content"><b>PDF contents:</b> Report chart · summary/pivot table · raw data <PdfContentsInfo config={job.config} categoryOnly /></span>
                  {job.last_attempt_at ? <span><b>Last attempt:</b> {formatDate(job.last_attempt_at)}</span> : null}
                  {job.last_error ? <span><b>Last error:</b> {job.last_error}</span> : null}
                </div>

                <div className="scheduled-report-actions" style={{ marginTop: 10 }}>
                  <button className="danger" type="button" onClick={() => setDeletingOneTimeJob(job)}>
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
                <b>Execution timing:</b> {describeCron(schedule.cron)}
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
                <th>Status</th>
                <th>Scheduled key</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Running since</th>
                <th>Duration</th>
                <th>Error</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.scheduled_report_name || scheduleLabels[row.job_name] || row.job_name}
                  </td>

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

                  <td className="job-error-cell">{row.error_message || "—"}</td>
                </tr>
              ))}

              {!rows.length ? (
                <tr>
                  <td colSpan="8">
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
