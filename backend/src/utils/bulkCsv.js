export function normalizeBulkExpenseRow(row, header) {
  const values = row.slice();
  if (
    header[0] === "date" &&
    values.length >= 3 &&
    /^\d{4}$/.test(String(values[0] || "").trim()) &&
    /^\d{1,2}$/.test(String(values[1] || "").trim()) &&
    /^\d{1,2}$/.test(String(values[2] || "").trim())
  ) {
    values.splice(0, 3, `${values[0]},${values[1]},${values[2]}`);
  }
  return values;
}
