import { q } from "../db/index.js";
import { expenseSql } from "../../scripts/sql/expenseSql.js";

const sortSql = {
  expense_date: "e.expense_date",
  category: "c.name",
  item: "COALESCE(i.name,e.other_item,'Total')",
  total_cost: "e.total_cost",
  expense_type: "e.expense_type",
};

let expenseLocationSchemaPromise = null;

export async function ensureExpenseLocationSchema() {
  if (!expenseLocationSchemaPromise) {
    expenseLocationSchemaPromise = q(
      `ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS location_id BIGINT`,
    ).catch((err) => {
      expenseLocationSchemaPromise = null;
      console.error("Failed to ensure public.expenses.location_id column", err);
    });
  }
  await expenseLocationSchemaPromise;
}

export async function listExpenses({ date, page, pageSize, search, sortColumn, sortDirection }) {
  await ensureExpenseLocationSchema();
  const sort = sortSql[sortColumn] || "e.id";
  const dir = sortDirection === "asc" ? "ASC" : "DESC";
  const like = `%${search || ""}%`;
  const count = await q(expenseSql.countByDate, [date, like]);
  const offset = (page - 1) * pageSize;
  const rows = await q(expenseSql.listByDate(sort, dir), [date, like, pageSize, offset]);
  return {
    rows: rows.rows,
    total: Number(count.rows[0].count),
    totalAmount: Number(count.rows[0].date_total_amount ?? count.rows[0].total_amount ?? 0),
    filteredTotalAmount: Number(count.rows[0].total_amount || 0),
    page,
    pageSize,
    date,
  };
}

export async function findExpense(id) {
  await ensureExpenseLocationSchema();
  const result = await q(expenseSql.find, [id]);
  return result.rows[0] || null;
}

export async function createExpense(client, data) {
  await ensureExpenseLocationSchema();
  const result = await client.query(expenseSql.create, [
    data.expenseDate,
    data.categoryId,
    data.itemId,
    data.otherItem,
    data.quantity,
    data.unitId,
    data.totalCost,
    data.expenseType,
    data.comment,
    data.userId,
    data.locationId || null,
  ]);
  return result.rows[0].id;
}

export async function updateExpense(client, id, data) {
  await ensureExpenseLocationSchema();
  const result = await client.query(expenseSql.update, [
    data.expenseDate,
    data.categoryId,
    data.itemId,
    data.otherItem,
    data.quantity,
    data.unitId,
    data.totalCost,
    data.expenseType,
    data.comment,
    data.locationId || null,
    id,
  ]);
  return result.rows[0]?.id || null;
}

export async function replaceExpenseShares(client, expenseId, shares) {
  await client.query(expenseSql.deleteShares, [expenseId]);
  for (const share of shares)
    await client.query(expenseSql.insertShare, [
      expenseId,
      share.survivorId,
      share.shareType,
      share.amount,
    ]);
}

export async function deleteExpense(id) {
  await q(expenseSql.delete, [id]);
}
export async function setProofKey(id, key) {
  const result = await q(expenseSql.setProof, [key, id]);
  return result.rows[0] || null;
}
export async function clearProofKey(id) {
  await q(expenseSql.clearProof, [id]);
}
export async function setBulkSource(id, googleDocsId, contractUrl) {
  await q(expenseSql.setBulkSource, [googleDocsId || null, contractUrl || null, id]);
}
