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
  return { rows: rows.rows, total: Number(count.rows[0].count), page, pageSize };
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
export async function listSurvivorsForMeta(locationId = "") {
  const cleanLocId = /^\d+$/.test(String(locationId || "").trim())
    ? String(locationId).trim()
    : "";

  if (!cleanLocId) {
    const result = await q(survivorSql.meta);
    return result.rows;
  }

  try {
    const result = await q(
      `WITH loc_usage AS (
         SELECT es.survivor_id,
                COUNT(DISTINCT e.id)::int AS usage_count,
                MAX(e.expense_date) AS last_used_date
           FROM public.expense_shares es
           JOIN public.expenses e ON e.id = es.expense_id
           LEFT JOIN public.marketing_list_items m ON m.expense_id = e.id
          WHERE COALESCE(e.location_id, m.location_id) = $1::bigint
          GROUP BY es.survivor_id
       )
       SELECT s.id,
              s.full_name,
              COALESCE(u.usage_count, 0)::int AS usage_count
         FROM public.survivors s
         LEFT JOIN loc_usage u ON u.survivor_id = s.id
        ORDER BY COALESCE(u.usage_count, 0) DESC,
                 u.last_used_date DESC NULLS LAST,
                 s.full_name ASC`,
      [cleanLocId],
    );
    return result.rows;
  } catch {
    const result = await q(survivorSql.meta);
    return result.rows;
  }
}
