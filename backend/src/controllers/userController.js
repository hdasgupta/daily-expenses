import {
  createUser,
  deleteUser,
  getRoles,
  listUsers,
  updateUser,
} from "../services/userService.js";

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
  res.json(await listUsers(paging(req)));
}
export async function create(req, res) {
  res.status(201).json(await createUser(req.body || {}));
}
export async function update(req, res) {
  const result = await updateUser(req.params.id, req.body || {});
  if (!result) return res.status(404).json({ error: "User not found" });
  res.json(result);
}
export async function remove(req, res) {
  if (String(req.params.id) === String(req.user.id))
    return res.status(400).json({ error: "You cannot remove your own account" });
  await deleteUser(req.params.id);
  res.json({ ok: true });
}
export async function roles(req, res) {
  res.json(await getRoles());
}
