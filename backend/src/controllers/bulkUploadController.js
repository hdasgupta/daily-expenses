import { importCategoriesItems, importExpenses } from "../services/bulkUploadService.js";

export async function expenses(req, res) {
  if (!req.file) return res.status(400).json({ error: "CSV file is required" });
  res.json(await importExpenses(req.file.buffer, req.user.id));
}

export async function categoriesItems(req, res) {
  if (!req.file) return res.status(400).json({ error: "CSV file is required" });
  res.json(await importCategoriesItems(req.file.buffer));
}
