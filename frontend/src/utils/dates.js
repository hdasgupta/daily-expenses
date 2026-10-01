export const APP_TIMEZONE = "Asia/Kolkata";

// Some browsers/older Android builds report the historical IANA alias
// Asia/Calcutta even though it represents the same India Standard Time zone.
export const INDIA_TIMEZONES = new Set(["Asia/Kolkata", "Asia/Calcutta"]);

export function getBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
}

export function isIndiaTimezone(timeZone = getBrowserTimezone()) {
  return INDIA_TIMEZONES.has(timeZone);
}

export function todayKolkata() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatDateKolkata(value) {
  if (!value) return "—";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  const [, year, month, day] = match;
  const monthName = new Intl.DateTimeFormat("en-IN", {
    month: "short",
    timeZone: APP_TIMEZONE,
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12)));
  return `${day}, ${monthName}, ${year.slice(-2)}`;
}
