const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export function toIsoDateString(value, timeZone = DEFAULT_TIME_ZONE) {
  if (value == null || value === "") return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return toIsoDateString(parsed, timeZone);
  }

  return text.slice(0, 10);
}

export function todayIso(timeZone = DEFAULT_TIME_ZONE) {
  return toIsoDateString(new Date(), timeZone);
}

export function nowIso(timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const hour = values.hour === "24" ? "00" : values.hour;
  return `${values.year}-${values.month}-${values.day}T${hour}:${values.minute}:${values.second}+05:30`;
}

export function dateMinusDays(days, timeZone = DEFAULT_TIME_ZONE) {
  const [year, month, day] = todayIso(timeZone).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - Number(days || 0)));
  return date.toISOString().slice(0, 10);
}

export function formatDateTimeIndia(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export function monthStart(year, month) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
