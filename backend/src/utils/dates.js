export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function dateMinusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function monthStart(year, month) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
