import assert from "node:assert/strict";
import { reportSql } from "../scripts/sql/reportSql.js";

const base = reportSql.sourcePerExpense;

const grouped = reportSql.grouped(
  base,
  'category AS "category", SUM(total_cost) AS total',
  "",
  "category",
  "category ASC",
);
assert.match(grouped, /^WITH expense_source AS \(/);
assert.match(grouped, /GROUP BY category ORDER BY category ASC LIMIT 5000$/);
assert.doesNotMatch(grouped, /GROUP BY category\s+"category"/);

const groupedWithoutOrder = reportSql.grouped(
  base,
  'category AS "category", SUM(total_cost) AS total',
  "",
  "category",
  "",
);
assert.match(groupedWithoutOrder, /GROUP BY category LIMIT 5000$/);
assert.doesNotMatch(groupedWithoutOrder, /GROUP BY category\s+ORDER BY/);

const raw = reportSql.raw(base, reportSql.rawSelectPerExpense, "", "expense_date DESC, id DESC");
assert.match(raw, /WITH expense_source AS \([\s\S]*\) SELECT /);
assert.match(raw, /FROM expense_source\s+ORDER BY expense_date DESC, id DESC LIMIT 5000$/);

console.log("reportSql tests passed");
