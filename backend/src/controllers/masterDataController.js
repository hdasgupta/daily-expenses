import * as service from "../services/masterDataService.js";

function paging(req, defaultSort = "name") {
  return {
    page: Math.max(1, Number(req.query.page) || 1),
    pageSize: [5, 10, 20, 50].includes(Number(req.query.pageSize))
      ? Number(req.query.pageSize)
      : 10,
    search: String(req.query.search || ""),
    sortColumn: String(req.query.sortColumn || defaultSort),
    sortDirection: req.query.sortDirection === "desc" ? "desc" : "asc",
  };
}

export async function categories(req, res) {
  res.json(await service.listCategories());
}
export async function addCategory(req, res) {
  res.status(201).json(await service.addCategory(req.body?.name));
}
export async function updateCategory(req, res) {
  const result = await service.editCategory(req.params.id, req.body?.name);
  if (!result) return res.status(404).json({ error: "Category not found" });
  res.json(result);
}
export async function removeCategory(req, res) {
  await service.deleteCategory(req.params.id);
  res.json({ ok: true });
}

export async function items(req, res) {
  res.json(
    await service.listItems({
      ...paging(req),
      categoryId: req.query.categoryId || null,
    }),
  );
}
export async function addItem(req, res) {
  res.status(201).json(await service.addItem(req.body?.categoryId, req.body?.name));
}
export async function updateItem(req, res) {
  const result = await service.editItem(req.params.id, req.body?.categoryId, req.body?.name);
  if (!result) return res.status(404).json({ error: "Item not found" });
  res.json(result);
}
export async function removeItem(req, res) {
  await service.deleteItem(req.params.id);
  res.json({ ok: true });
}

export async function units(req, res) {
  res.json(await service.listUnits(paging(req)));
}
export async function addUnit(req, res) {
  res.status(201).json(await service.addUnit(req.body?.name));
}
export async function updateUnit(req, res) {
  const result = await service.editUnit(req.params.id, req.body?.name);
  if (!result) return res.status(404).json({ error: "Unit not found" });
  res.json(result);
}
export async function removeUnit(req, res) {
  await service.deleteUnit(req.params.id);
  res.json({ ok: true });
}

export async function metaCategories(req, res) {
  res.json(await service.listCategories());
}
export async function metaItems(req, res) {
  res.json(await service.listItemsForMeta(req.params.categoryId));
}
export async function metaUnits(req, res) {
  res.json(await service.listUnitsForMeta());
}
