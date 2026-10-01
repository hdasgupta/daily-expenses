import test from "node:test";
import assert from "node:assert/strict";
import { reportSql } from "../scripts/sql/reportSql.js";

function assertQueryShape(sql) {
  assert.match(sql, /^WITH\s+expense_source AS \(/i);
  assert.equal((sql.match(/\bSELECT\b/gi) || []).length >= 2, true);
  assert.doesNotMatch(sql, /SELECT\s+SELECT/i);
  assert.doesNotMatch(sql, /FROM\s+expense_source\s+SELECT/i);
  assert.doesNotMatch(sql, /\bundefined\b/i);
  assert.doesNotMatch(sql, /\[object Object\]/i);
}

test("per-expense source is a valid CTE prefix", () => {
  assert.match(reportSql.sourcePerExpense, /^expense_source AS \(/);
  assert.match(reportSql.sourcePerExpense, /FROM expenses e/i);
  assert.match(reportSql.sourcePerExpense, /GROUP BY e\.id, c\.name, i\.name/i);
  assert.match(reportSql.sourcePerExpense, /\)$/);
});

test("per-survivor source preserves calculated survivor share", () => {
  assert.match(reportSql.sourcePerSurvivor, /es\.amount AS report_amount/i);
  assert.match(reportSql.sourcePerSurvivor, /ARRAY\[s\.id\]::bigint\[\]/i);
});

test("raw report query has exactly one outer SELECT", () => {
  const sql = reportSql.raw(
    reportSql.sourcePerExpense,
    reportSql.rawSelectPerExpense,
    reportSql.where([reportSql.filterDate("expense_source", 1)]),
    reportSql.defaultRawOrder,
  );
  assertQueryShape(sql);
  assert.match(sql, /WHERE expense_source\.expense_date = \$1/i);
  assert.match(sql, /ORDER BY expense_date DESC, id DESC/i);
  assert.match(sql, /LIMIT 5000$/i);
});

test("grouped summary query has one GROUP BY and one ORDER BY", () => {
  const sql = reportSql.grouped(
    reportSql.sourcePerExpense,
    reportSql.groupedSelect(["category", "month"], reportSql.amountPerExpense),
    reportSql.where([]),
    reportSql.groupBy(["category", "month"]),
    reportSql.orderBySelectedGroup(["category", "month"], [{ column: "month", direction: "desc" }]),
  );
  assertQueryShape(sql);
  assert.match(sql, /GROUP BY category, date_trunc\('month', expense_date\)::date/i);
  assert.match(sql, /ORDER BY date_trunc\('month', expense_date\)::date DESC/i);
  assert.match(sql, /SUM\(total_cost\) AS total/i);
});

test("survivor summary uses share amounts, not whole expense amounts", () => {
  const sql = reportSql.grouped(
    reportSql.sourcePerSurvivor,
    reportSql.groupedSelect(["survivor"], reportSql.amountPerSurvivor),
    reportSql.where([reportSql.filterSurvivors("expense_source", 1)]),
    reportSql.groupBy(["survivor"]),
    reportSql.orderBySelectedGroup(["survivor"], []),
  );
  assertQueryShape(sql);
  assert.match(sql, /SUM\(report_amount\) AS total/i);
  assert.match(sql, /expense_source\.survivor_ids && \$1::bigint\[\]/i);
});

test("filter builders produce parameterized SQL", () => {
  assert.equal(reportSql.filterDate("expense_source", 2), "expense_source.expense_date = $2");
  assert.equal(reportSql.filterFrom("expense_source", 3), "expense_source.expense_date >= $3");
  assert.equal(reportSql.filterTo("expense_source", 4), "expense_source.expense_date <= $4");
  assert.match(reportSql.filterMonthFrom("expense_source", 5), /\$5::date/);
  assert.match(reportSql.filterMonthTo("expense_source", 6), /\$6::date/);
  assert.equal(reportSql.filterProof("expense_source", true), "expense_source.has_proof = TRUE");
  assert.equal(reportSql.filterProof("expense_source", false), "expense_source.has_proof = FALSE");
});
