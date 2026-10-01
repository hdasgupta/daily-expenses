import { q } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
export async function findUserWithPermissions(id) {
  const result = await q(userSql.findById, [id]);
  return result.rows[0] || null;
}
export async function findByEmail(email) {
  const result = await q(userSql.findByEmail, [email]);
  return result.rows[0] || null;
}
export async function listUsers({ page, pageSize, search, sortColumn, sortDirection }) {
  const sortMap = {
    full_name: "u.full_name",
    email: "u.email",
    role: "r.name",
    created_at: "u.created_at",
  };
  const sort = sortMap[sortColumn] || "u.full_name";
  const dir = sortDirection === "desc" ? "DESC" : "ASC";
  const like = `%${search || ""}%`;
  const offset = (page - 1) * pageSize;
  const count = await q(userSql.userCount, [like]);
  const rows = await q(userSql.userList(sort, dir), [like, pageSize, offset]);
  return { rows: rows.rows, total: Number(count.rows[0].count), page, pageSize };
}
