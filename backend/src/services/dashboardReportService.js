import { runReport } from "./reportService.js";
import { todayIso } from "../utils/dates.js";

const definitions = {
  daily: { label: "Daily report", unit: "day", groupBy: ["date"], count: 7 },
  weekly: { label: "Weekly Report", unit: "week", groupBy: ["week"], count: 4 },
  monthly: { label: "Monthly Report", unit: "month", groupBy: ["month"], count: 3 },
  yearly: { label: "Yearly Report", unit: "year", groupBy: ["year"], count: 2 },
  "daily-category": { label: "Daily report by Category", unit: "day", groupBy: ["date", "category"], count: 7 },
  "weekly-category": { label: "Weekly report by Category", unit: "week", groupBy: ["week", "category"], count: 4 },
  "monthly-category": { label: "Monthly report by Category", unit: "month", groupBy: ["month", "category"], count: 3 },
  "yearly-category": { label: "Yearly report by Category", unit: "year", groupBy: ["year", "category"], count: 2 },
  "daily-survivor": { label: "Daily report by Survivor", unit: "day", groupBy: ["date", "survivor"], count: 7 },
  "weekly-survivor": { label: "Weekly report by Survivor", unit: "week", groupBy: ["week", "survivor"], count: 4 },
  "monthly-survivor": { label: "Monthly report by Survivor", unit: "month", groupBy: ["month", "survivor"], count: 3 },
  "yearly-survivor": { label: "Yearly report by Survivor", unit: "year", groupBy: ["year", "survivor"], count: 2 },
  "daily-survivor-category": { label: "Daily report Survivor vs Category", unit: "day", groupBy: ["date", "survivor", "category"], count: 7 },
  "weekly-survivor-category": { label: "Weekly report Survivor vs Category", unit: "week", groupBy: ["week", "survivor", "category"], count: 4 },
  "monthly-survivor-category": { label: "Monthly report Survivor vs Category", unit: "month", groupBy: ["month", "survivor", "category"], count: 3 },
  "yearly-survivor-category": { label: "Yearly report Survivor vs Category", unit: "year", groupBy: ["year", "survivor", "category"], count: 2 },
};

function dateFromParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function normalizeIsoDate(value, label = "date") {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!match) throw new Error(`Invalid ${label}: ${text || "empty value"}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid ${label}: ${text}`);
  }
  return date;
}

function addDays(value, amount) {
  const date = normalizeIsoDate(value);
  date.setUTCDate(date.getUTCDate() + Number(amount || 0));
  return date.toISOString().slice(0, 10);
}
function shiftMonthStart(value, amount) {
  const date = normalizeIsoDate(`${String(value).slice(0, 7)}-01`, "month");
  date.setUTCMonth(date.getUTCMonth() + Number(amount || 0), 1);
  return date.toISOString().slice(0, 10);
}
function shiftYearStart(value, amount) {
  const [year] = value.split("-").map(Number);
  return dateFromParts(year + amount, 1, 1);
}
function monthEnd(value) {
  return addDays(shiftMonthStart(value, 1), -1);
}
function yearEnd(value) {
  return addDays(shiftYearStart(value, 1), -1);
}
function weekStart(value) {
  const date = normalizeIsoDate(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addDays(value, -mondayOffset);
}

function rangeFor(unit, count, today = todayIso()) {
  if (unit === "day") return { dateFrom: addDays(today, -(count - 1)), dateTo: today, label: `${count} days` };
  if (unit === "week") {
    const start = shiftDays(weekStart(today), -(count - 1) * 7);
    const end = addDays(weekStart(today), 6);
    return { dateFrom: start, dateTo: end, label: `${count} weeks` };
  }
  if (unit === "month") {
    const end = monthEnd(today.slice(0, 7) + "-01");
    const start = shiftMonthStart(today.slice(0, 7) + "-01", -(count - 1));
    return { dateFrom: start, dateTo: end, label: `${count} months` };
  }
  const current = `${today.slice(0, 4)}-01-01`;
  return { dateFrom: shiftYearStart(current, -(count - 1)), dateTo: yearEnd(current), label: `${count} years` };
}
function shiftDays(value, amount) { return addDays(value, amount); }

function baseFilters(range) {
  return {
    date: "",
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    month: "",
    year: "",
    hasProof: "",
    categoryItems: [],
    categories: [],
    survivors: [],
  };
}

function addSelectionFilters(filters, selection, groupBy) {
  const next = { ...filters, categories: [...filters.categories], survivors: [...filters.survivors] };
  if (groupBy.includes("date") && selection.date) next.date = String(selection.date), next.dateFrom = "", next.dateTo = "";
  if (groupBy.includes("week") && selection.week) next.dateFrom = String(selection.week), next.dateTo = addDays(String(selection.week), 6);
  if (groupBy.includes("month") && selection.month) {
    next.month = String(selection.month).slice(0, 7);
    next.dateFrom = "";
    next.dateTo = "";
  }
  if (groupBy.includes("year") && selection.year) {
    next.year = Number(selection.year);
    next.dateFrom = "";
    next.dateTo = "";
  }
  if (groupBy.includes("category") && selection.category_id != null) next.categories = [String(selection.category_id)];
  if (groupBy.includes("survivor") && selection.survivor_id != null) next.survivors = [String(selection.survivor_id)];
  return next;
}

function drilldownTitle(definition, selection) {
  const parts = definition.groupBy
    .map((column) => selection[column])
    .filter((value) => value != null && value !== "")
    .map(String);
  return parts.length ? `${definition.label} · ${parts.join(" · ")}` : `${definition.label} · Drilldown`;
}

export function getDashboardDefinition(reportKey) {
  return definitions[reportKey] || null;
}

export async function runDashboardReport(reportKey, mode = "summary", selection = {}) {
  const definition = getDashboardDefinition(reportKey);
  if (!definition) throw new Error("Unknown dashboard report.");

  const range = rangeFor(definition.unit, definition.count);
  const filters = addSelectionFilters(baseFilters(range), selection || {}, definition.groupBy);
  if (mode === "drilldown") {
    const result = await runReport({
      dateFilterType: "range",
      filters,
      sortColumns: [{ column: "date", direction: "asc" }],
      groupBy: [],
      summarise: false,
    });
    return {
      mode: "raw",
      title: drilldownTitle(definition, selection),
      rangeLabel: `${range.dateFrom} to ${range.dateTo}`,
      ...result,
    };
  }

  const result = await runReport({
    dateFilterType: "range",
    filters,
    sortColumns: definition.groupBy.map((column) => ({ column, direction: "asc" })),
    groupBy: definition.groupBy,
    summarise: true,
  });

  return {
    ...result,
    reportKey,
    title: definition.label,
    groupBy: definition.groupBy,
    rangeLabel: `${range.dateFrom} to ${range.dateTo}`,
  };
}
