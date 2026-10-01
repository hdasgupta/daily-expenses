import {
  findExpense,
  listExpenses,
  saveExpense,
  deleteExpense,
} from "../services/expenseService.js";
import { uploadExpenseProof } from "../services/proofService.js";
import { signedObjectUrl } from "../services/storageService.js";
import { todayIso } from "../utils/dates.js";

function paging(req) {
  return {
    page: Math.max(1, Number(req.query.page) || 1),
    pageSize: [5, 10, 20, 50].includes(Number(req.query.pageSize))
      ? Number(req.query.pageSize)
      : 10,
    search: String(req.query.search || ""),
    sortColumn: String(req.query.sortColumn || "expense_date"),
    sortDirection: req.query.sortDirection === "asc" ? "asc" : "desc",
  };
}

function today() {
  return todayIso();
}

export async function list(req, res) {
  const date = req.query.date || today();
  res.json(await listExpenses({ date, ...paging(req) }));
}

export async function create(req, res) {
  res.status(201).json(await saveExpense(req.body || {}, req.user.id));
}
export async function update(req, res) {
  const result = await saveExpense(req.body || {}, req.user.id, req.params.id);
  if (!result) return res.status(404).json({ error: "Expense not found" });
  res.json(result);
}
export async function remove(req, res) {
  await deleteExpense(req.params.id);
  res.json({ ok: true });
}

export async function uploadProof(req, res) {
  if (!req.file) return res.status(400).json({ error: "A proof file is required" });
  const expense = await findExpense(req.params.id);
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  const key = await uploadExpenseProof(req.params.id, req.file);
  res.json({ ok: true, proofKey: key });
}

export async function proofUrl(req, res) {
  const expense = await findExpense(req.params.id);
  if (!expense?.proof_key) return res.status(404).json({ error: "Proof not found" });
  const url = await signedObjectUrl(expense.proof_key);
  if (!url) return res.status(503).json({ error: "Storage is not configured" });
  res.json({ url });
}
