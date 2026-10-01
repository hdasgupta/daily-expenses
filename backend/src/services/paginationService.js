import { getPaginationSetting, savePaginationSetting } from "../models/paginationModel.js";

const sizes = new Set([5, 10, 20, 50]);

export async function getSetting(userId, module) {
  return getPaginationSetting(userId, module);
}

export async function saveSetting(userId, module, input) {
  return savePaginationSetting(userId, module, {
    pageSize: sizes.has(Number(input.pageSize)) ? Number(input.pageSize) : 10,
    search: String(input.search || ""),
    sortColumn: input.sortColumn || null,
    sortDirection: input.sortDirection === "desc" ? "desc" : "asc",
  });
}
