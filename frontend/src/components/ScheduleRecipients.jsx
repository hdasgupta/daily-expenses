import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function ScheduleRecipients({ isAdmin, value = [], onChange, multiple = true }) {
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    api("/scheduled-reports/recipients", { loadingMessage: "Loading managers…" })
      .then((rows) => setManagers(Array.isArray(rows) ? rows : []))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) return null;

  const selected = new Set((Array.isArray(value) ? value : []).map(String));
  const toggle = (id) => {
    const key = String(id);
    if (multiple) {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key); else next.add(key);
      onChange([...next].map(Number));
    } else {
      onChange([Number(id)]);
    }
  };

  return (
    <div className="schedule-recipient-picker">
      <strong>Schedule for manager(s)</strong>
      <span className="field-note">The selected managers will receive the scheduled email and see the job in their Job Status page.</span>
      {loading ? <span className="field-note">Loading managers…</span> : null}
      {!loading && !managers.length ? <span className="field-note">No active managers found.</span> : null}
      <div className="schedule-recipient-list">
        {managers.map((manager) => (
          <label key={manager.id} className="schedule-recipient-option">
            <input type="checkbox" checked={selected.has(String(manager.id))} onChange={() => toggle(manager.id)} />
            <span>{manager.full_name} · {manager.email}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
