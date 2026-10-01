import { getSetting, saveSetting } from "../services/paginationService.js";

export async function get(req, res) {
  res.json(await getSetting(req.user.id, req.params.module));
}
export async function save(req, res) {
  res.json(await saveSetting(req.user.id, req.params.module, req.body || {}));
}
