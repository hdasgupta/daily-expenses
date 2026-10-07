import React, { useEffect, useMemo, useState } from "react";

const frequencyLabels = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = [
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

function frequencyFor(reportKey) {
  return String(reportKey || "").split("-")[0] || "daily";
}

function defaultForm(reportKey, job) {
  const frequency = frequencyFor(reportKey);
  return {
    name: job?.name || "",
    reportKey,
    frequency,
    time: job?.time_of_day || "06:00",
    dayOfWeek: job?.day_of_week ?? 0,
    dayOfMonth: job?.day_of_month ?? 1,
    monthOfYear: job?.month_of_year ?? 1,
    active: job?.active ?? true,
  };
}

export default function ScheduledReportForm({
  report,
  job = null,
  recipient = "",
  onSubmit,
  busy,
}) {
  const [form, setForm] = useState(() => defaultForm(report?.key || job?.report_key, job));

  useEffect(() => {
    setForm(defaultForm(report?.key || job?.report_key, job));
  }, [report?.key, job?.id]);

  const frequency = form.frequency;
  const frequencyLabel = frequencyLabels[frequency] || frequency;
  const periodHelp = useMemo(() => report?.help || "Dashboard report", [report]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    onSubmit({
      ...form,
      dayOfWeek: Number(form.dayOfWeek),
      dayOfMonth: Number(form.dayOfMonth),
      monthOfYear: Number(form.monthOfYear),
    });
  };

  return (
    <form className="scheduled-report-form" onSubmit={submit}>
      <div className="notice schedule-summary">
        <div>
          <strong>{report?.label || job?.report_label || job?.report_key}</strong>
          <span>{periodHelp}</span>
        </div>
      </div>

      <label>
        Schedule name
        <input
          value={form.name}
          maxLength={150}
          onChange={(event) => update("name", event.target.value)}
          placeholder={`${report?.label || "Dashboard report"} email`}
          required
        />
      </label>

      <div className="two-col">
        <label>
          Delivery frequency
          <input value={frequencyLabel} readOnly />
          <span className="field-note">The delivery period matches this dashboard report.</span>
        </label>
        <label>
          Send time
          <input
            type="time"
            value={form.time}
            onChange={(event) => update("time", event.target.value)}
            required
          />
          <span className="field-note">India Standard Time (Asia/Kolkata)</span>
        </label>
      </div>

      {frequency === "weekly" ? (
        <label>
          Weekday
          <select
            value={form.dayOfWeek}
            onChange={(event) => update("dayOfWeek", event.target.value)}
          >
            {weekdays.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {frequency === "monthly" ? (
        <label>
          Day of month
          <select
            value={form.dayOfMonth}
            onChange={(event) => update("dayOfMonth", event.target.value)}
          >
            {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
          <span className="field-note">Days 1–28 are used so the job exists in every month.</span>
        </label>
      ) : null}

      {frequency === "yearly" ? (
        <div className="two-col">
          <label>
            Month
            <select
              value={form.monthOfYear}
              onChange={(event) => update("monthOfYear", event.target.value)}
            >
              {months.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <label>
            Day of month
            <select
              value={form.dayOfMonth}
              onChange={(event) => update("dayOfMonth", event.target.value)}
            >
              {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="scheduled-report-recipient">
        <strong>Send to</strong>
        <span>{recipient || job?.owner_email || "your account email"}</span>
      </div>

      <label className="switch-row">
        <input
          type="checkbox"
          checked={Boolean(form.active)}
          onChange={(event) => update("active", event.target.checked)}
        />
        <span className="switch" />
        <span>Schedule is active</span>
      </label>

      <div className="form-actions scheduled-report-form-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : job ? "Save changes" : "Schedule email"}
        </button>
      </div>
    </form>
  );
}
