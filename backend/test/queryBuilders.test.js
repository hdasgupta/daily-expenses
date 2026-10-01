import test from "node:test";
import assert from "node:assert/strict";
import { expenseSql } from "../scripts/sql/expenseSql.js";
import { masterDataSql } from "../scripts/sql/masterDataSql.js";
import { survivorSql } from "../scripts/sql/survivorSql.js";
import { userSql } from "../scripts/sql/userSql.js";
import { dashboardSql } from "../scripts/sql/dashboardSql.js";

test("user list sort is always whitelisted", () => {
  const safe = userSql.userList("email", "desc");
  const fallback = userSql.userList("email; DROP TABLE users;--", "desc");
  assert.match(safe, /ORDER BY u\.email DESC/i);
  assert.match(fallback, /ORDER BY u\.full_name DESC/i);
  assert.doesNotMatch(fallback, /DROP TABLE/i);
});

test("survivor list sort is always whitelisted", () => {
  const safe = survivorSql.list("district", "desc");
  const fallback = survivorSql.list("district; DELETE FROM survivors;--", "desc");
  assert.match(safe, /ORDER BY district DESC/i);
  assert.match(fallback, /ORDER BY full_name DESC/i);
  assert.doesNotMatch(fallback, /DELETE FROM survivors/i);
});

test("expense list query does not interpolate an undefined sort", () => {
  const safe = expenseSql.listByDate("category", "asc");
  const fallback = expenseSql.listByDate("not-a-column", "desc");
  assert.match(safe, /ORDER BY c\.name ASC/i);
  assert.match(fallback, /ORDER BY e\.expense_date DESC/i);
});

test("unit list sort is always whitelisted", () => {
  const safe = masterDataSql.units("created_at", "desc");
  const fallback = masterDataSql.units("bad-column", "desc");
  assert.match(safe, /ORDER BY created_at DESC/i);
  assert.match(fallback, /ORDER BY name DESC/i);
});

test("dashboard survivor breakdown groups by survivor id and name", () => {
  const query = dashboardSql.breakdownQuery(
    dashboardSql.trend.day.expression,
    dashboardSql.breakdown.survivor.idField,
    dashboardSql.breakdown.survivor.field,
    dashboardSql.breakdown.survivor.amount,
    dashboardSql.breakdown.survivor.join,
    dashboardSql.trend.day.start,
  );
  assert.match(query, /GROUP BY e\.expense_date,s\.id,s\.full_name/i);
});
