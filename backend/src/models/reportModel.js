import { q } from "../db/index.js";
import { reportModelSql } from "../../scripts/sql/reportModelSql.js";

export async function listSelections(userId) {
  const result = await q(reportModelSql.list, [userId]);
  return result.rows;
}
export async function saveSelection(userId, name, config) {
  const result = await q(reportModelSql.save, [userId, name, config]);
  return result.rows[0];
}
export async function deleteSelection(userId, id) {
  await q(reportModelSql.delete, [id, userId]);
}
