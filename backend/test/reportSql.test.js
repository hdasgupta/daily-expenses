import test from "node:test";
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



test("groupedOrder makes survivor grouping and sorting positional", () => {
  const order = reportSql.groupedOrder(
    ["survivor"],
    [{ column: "survivor", direction: "asc" }],
    "SUM(report_amount)",
  );
  assert.equal(order, "1 ASC");
  const query = reportSql.grouped(
    reportSql.sourcePerSurvivor,
    'survivor AS "survivor", SUM(report_amount) AS total',
    "",
    "1",
    order,
  );
  assert.match(query, /GROUP BY 1 ORDER BY 1 ASC LIMIT 5000$/);
  assert.doesNotMatch(query, /GROUP BY survivor/i);
  assert.doesNotMatch(query, /ORDER BY survivor\b/i);
});

test("groupedOrder uses the aggregate for price sorting", () => {
  const order = reportSql.groupedOrder(
    ["survivor"],
    [{ column: "price", direction: "desc" }],
    "SUM(report_amount)",
  );
  assert.equal(order, "SUM(report_amount) DESC");
});
