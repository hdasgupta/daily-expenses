import { q } from "../db/index.js";
import { masterDataSql } from "../../scripts/sql/masterDataSql.js";

export async function listCategories() {
  const result = await q(masterDataSql.categories);
  return result.rows;
}
export async function createCategory(name) {
  const result = await q(masterDataSql.addCategory, [name]);
  return result.rows[0];
}
export async function updateCategory(id, name) {
  const result = await q(masterDataSql.updateCategory, [name, id]);
  return result.rows[0] || null;
}
export async function deleteCategory(id) {
  await q(masterDataSql.deleteCategory, [id]);
}

export async function listItems({ categoryId, page, pageSize, search, sortColumn, sortDirection }) {
  const sort = sortColumn === "category" ? "c.name" : "i.name";
  const dir = sortDirection === "desc" ? "DESC" : "ASC";
  const conditions = [masterDataSql.itemSearchCondition];
  const params = [`%${search || ""}%`];
  if (categoryId) {
    params.push(categoryId);
    conditions.push(masterDataSql.itemCategoryCondition(params.length));
  }
  const where = conditions.join(" AND ");
  const count = await q(masterDataSql.itemCount(where), params);
  const offset = (page - 1) * pageSize;
  params.push(pageSize, offset);
  const rows = await q(
    masterDataSql.items(where, `${sort}`, `$${params.length - 1}`, `$${params.length}`),
    params,
  );
  return {
    rows: rows.rows,
    total: Number(count.rows[0].count),
    page,
    pageSize,
  };
}
export async function createItem(categoryId, name) {
  const result = await q(masterDataSql.addItem, [categoryId, name]);
  return result.rows[0];
}
export async function updateItem(id, categoryId, name) {
  const result = await q(masterDataSql.updateItem, [categoryId, name, id]);
  return result.rows[0] || null;
}
export async function deleteItem(id) {
  await q(masterDataSql.deleteItem, [id]);
}

export async function listUnits({ page, pageSize, search, sortColumn, sortDirection }) {
  const sort = sortColumn === "created_at" ? "created_at" : "name";
  const dir = sortDirection === "desc" ? "DESC" : "ASC";
  const like = `%${search || ""}%`;
  const count = await q(masterDataSql.unitCount, [like]);
  const offset = (page - 1) * pageSize;
  const rows = await q(masterDataSql.units(sort, dir), [like, pageSize, offset]);
  return {
    rows: rows.rows,
    total: Number(count.rows[0].count),
    page,
    pageSize,
  };
}
export async function createUnit(name) {
  const result = await q(masterDataSql.addUnit, [name]);
  return result.rows[0];
}
export async function updateUnit(id, name) {
  const result = await q(masterDataSql.updateUnit, [name, id]);
  return result.rows[0] || null;
}
export async function deleteUnit(id) {
  await q(masterDataSql.deleteUnit, [id]);
}
export async function listCategoriesForMeta() {
  return listCategories();
}
export async function listItemsForMeta(categoryId) {
  const result = await q(masterDataSql.metaItems, [categoryId]);
  return result.rows;
}
export async function listUnitsForMeta() {
  const result = await q(masterDataSql.metaUnits);
  return result.rows;
}
