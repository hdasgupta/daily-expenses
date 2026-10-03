import React, { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, RefreshCw, XCircle } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { usePagination } from "../hooks/usePagination";
import "./jobStatus.css";

const scheduleLabels = {
  dashboard: "Dashboard email",
  "daily-email-report": "Daily 7-day email report",
  "monthly-email-report": "Monthly 3-month email report",
};

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}

function statusIcon(status) {
  if (status === "completed") return <CheckCircle2 size={15} />;
  if (status === "failed") return <XCircle size={15} />;
  return <LoaderCircle size={15} className="job-status-spin" />;
}

export default function JobStatus() {
  const pagination = usePagination("job-status", null);
  const [page, setPage] = useState(1);
  const [schedules, setSchedules] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const load = async ({ silent = false } = {}) => {
    if (!pagination.ready) return;
    const data = await api(
      `/job-status?page=${page}&pageSize=${pagination.pageSize}&search=${encodeURIComponent(pagination.search)}`,
      { loadingMessage: silent ? undefined : "Loading job status…", silent },
    );
    setSchedules(data.schedules || []);
    setRows(data.rows || []);
    setTotal(data.total || 0);
  };

  useEffect(() => {
    setPage(1);
  }, [pagination.search, pagination.pageSize]);

  useEffect(() => {
    load().catch(() => {});
  }, [page, pagination.pageSize, pagination.search, pagination.ready]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load({ silent: true });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Cron Job Status</h1>
          <p>View configured scheduler jobs and their execution history.</p>
        </div>
        <button className="secondary" type="button" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={17} className={refreshing ? "job-status-spin" : ""} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
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
              <span><b>Cron:</b> {schedule.cron || "—"}</span>
              <span><b>Timezone:</b> {schedule.timezone || "—"}</span>
              <span><b>Next scheduled run:</b> {schedule.nextRunAt ? formatDate(schedule.nextRunAt) : "—"}</span>
            </div>
          </article>
        ))}
      </div>

      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[]}
      />

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
                  <td>{scheduleLabels[row.job_name] || row.job_name}</td>
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
                  <td>{row.status === "running" ? formatDuration(now - new Date(row.started_at).getTime()) : row.duration_ms == null ? "—" : `${row.duration_ms} ms`}</td>
                  <td className="job-error-cell">{row.error_message || "—"}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan="8">
                    <div className="empty-card">No scheduler executions have been recorded yet.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[]}
      />
    </section>
  );
}
