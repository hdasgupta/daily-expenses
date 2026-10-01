import { q } from "../db/index.js";
import { survivorSql } from "../../scripts/sql/survivorSql.js";

export async function listSurvivors({ page, pageSize, search, sortColumn, sortDirection }) {
  const allowed = {
    full_name: "full_name",
    nickname: "nickname",
    district: "district",
    state: "state",
    pincode: "pincode",
  };
  const sort = allowed[sortColumn] || "full_name";
  const dir = sortDirection === "desc" ? "DESC" : "ASC";
  const like = `%${search || ""}%`;
  const count = await q(survivorSql.count, [like]);
  const offset = (page - 1) * pageSize;
  const rows = await q(survivorSql.list(sort, dir), [like, pageSize, offset]);
  return {
    rows: rows.rows,
    total: Number(count.rows[0].count),
    page,
    pageSize,
  };
}
export async function createSurvivor(data) {
  const result = await q(survivorSql.create, [
    data.fullName,
    data.fatherName,
    data.motherName,
    data.nickname,
    data.houseNo,
    data.street,
    data.area,
    data.villageCity,
    data.pincode,
    data.district,
    data.state,
  ]);
  return result.rows[0];
}
export async function updateSurvivor(id, data) {
  const result = await q(survivorSql.update, [
    data.fullName,
    data.fatherName,
    data.motherName,
    data.nickname,
    data.houseNo,
    data.street,
    data.area,
    data.villageCity,
    data.pincode,
    data.district,
    data.state,
    id,
  ]);
  return result.rows[0] || null;
}
export async function deleteSurvivor(id) {
  await q(survivorSql.delete, [id]);
}
export async function listSurvivorsForMeta() {
  const result = await q(survivorSql.meta);
  return result.rows;
}
