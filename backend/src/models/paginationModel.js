import { q } from "../db/index.js";
import { paginationSql } from "../../scripts/sql/paginationSql.js";

export async function getPaginationSetting(userId, module) {
  const result = await q(paginationSql.get, [userId, module]);
  return (
    result.rows[0] || { page_size: 10, search_text: "", sort_column: null, sort_direction: "asc" }
  );
}
export async function savePaginationSetting(userId, module, data) {
  const result = await q(paginationSql.save, [
    userId,
    module,
    data.pageSize,
    data.search || "",
    data.sortColumn || null,
    data.sortDirection || "asc",
  ]);
  return result.rows[0];
}
