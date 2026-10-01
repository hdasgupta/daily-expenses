const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export function todayIso(timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function nowIso(timeZone = DEFAULT_TIME_ZONE) {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .replace(" ", "T");
  return `${formatted}+05:30`;
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
