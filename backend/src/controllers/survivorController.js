import { lookupPincode } from "../services/pincodeService.js";
import {
  deleteSurvivor,
  editSurvivor,
  listSurvivors,
  listSurvivorsForMeta,
  saveSurvivor,
} from "../services/survivorService.js";

function paging(req) {
  return {
    page: Math.max(1, Number(req.query.page) || 1),
    pageSize: [5, 10, 20, 50].includes(Number(req.query.pageSize))
      ? Number(req.query.pageSize)
      : 10,
    search: String(req.query.search || ""),
    sortColumn: String(req.query.sortColumn || "full_name"),
    sortDirection: req.query.sortDirection === "desc" ? "desc" : "asc",
  };
}

export async function list(req, res) {
  res.json(await listSurvivors(paging(req)));
}
export async function create(req, res) {
  res.status(201).json(await saveSurvivor(req.body || {}));
}
export async function update(req, res) {
  const result = await editSurvivor(req.params.id, req.body || {});
  if (!result) return res.status(404).json({ error: "Survivor not found" });
  res.json(result);
}
export async function remove(req, res) {
  await deleteSurvivor(req.params.id);
  res.json({ ok: true });
}
export async function meta(req, res) {
  res.json(await listSurvivorsForMeta());
}
export async function pincode(req, res) {
  res.json(await lookupPincode(req.params.pincode));
}
