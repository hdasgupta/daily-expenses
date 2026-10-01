import { q, withTransaction } from "../db/index.js";
import {
  createExpense,
  deleteExpense,
  findExpense,
  listExpenses,
  replaceExpenseShares,
  updateExpense,
} from "../models/expenseModel.js";
import { optionalText, positiveOrZero, requiredText } from "../utils/validation.js";
import { todayIso } from "../utils/dates.js";

function normalizeShares(totalCost, inputShares) {
  if (!Array.isArray(inputShares) || inputShares.length === 0) {
    throw new Error("At least one survivor share is required");
  }

  const shares = inputShares.map((share) => ({
    survivorId: requiredText(share.survivorId, "Survivor"),
    shareType: ["fixed", "average", "remaining"].includes(share.shareType) ? share.shareType : null,
    amount: share.shareType === "fixed" ? positiveOrZero(share.amount, "Fixed share amount") : null,
  }));

  if (shares.some((share) => !share.shareType)) throw new Error("Invalid survivor share type");
  if (new Set(shares.map((share) => String(share.survivorId))).size !== shares.length) {
    throw new Error("Each survivor can be selected only once for an expense");
  }
  if (shares.filter((share) => share.shareType === "remaining").length > 1) {
    throw new Error("Only one remaining share is allowed");
  }

  const fixed = shares
    .filter((share) => share.shareType === "fixed")
    .reduce((sum, share) => sum + Number(share.amount || 0), 0);
  const averageShares = shares.filter((share) => share.shareType === "average");
  const remainingShares = shares.filter((share) => share.shareType === "remaining");
  if (averageShares.length && remainingShares.length)
    throw new Error("Use average shares or one remaining share, not both");
  let remaining = Math.round((Number(totalCost) - fixed) * 100) / 100;

  if (remaining < 0) throw new Error("Fixed survivor shares exceed total cost");
  if (!averageShares.length && !remainingShares.length && Math.abs(remaining) > 0.009) {
    throw new Error("Survivor shares must equal total cost");
  }

  const resolved = shares.map((share) => ({ ...share }));
  if (averageShares.length) {
    const cents = Math.round(remaining * 100);
    const baseCents = Math.floor(cents / averageShares.length);
    const extraCents = cents % averageShares.length;
    resolved
      .filter((item) => item.shareType === "average")
      .forEach((share, index) => {
        share.amount = (baseCents + (index < extraCents ? 1 : 0)) / 100;
      });
    remaining = 0;
  }
  if (remainingShares.length) {
    remainingShares.forEach((share) => {
      const target = resolved.find((item) => String(item.survivorId) === String(share.survivorId));
      target.amount = Math.max(0, Math.round(remaining * 100) / 100);
    });
    remaining = 0;
  }
  if (Math.abs(remaining) > 0.009) throw new Error("Survivor shares must equal total cost");

  return resolved;
}

function normalizeExpense(input, userId) {
  if (input.totalCost === "" || input.totalCost === null || input.totalCost === undefined)
    throw new Error("Total cost is required");
  const totalCost = positiveOrZero(input.totalCost, "Total cost");
  if (!input.expenseDate) throw new Error("Expense date is required");
  if (String(input.expenseDate) > todayIso())
    throw new Error("Expense date cannot be in the future");
  if (!input.categoryId) throw new Error("Category is required");
  if (input.itemId === "__other__") {
    if (!String(input.otherItem || "").trim()) throw new Error("Other item is required");
  }
  return {
    expenseDate: input.expenseDate,
    categoryId: input.categoryId,
    itemId:
      input.itemId && input.itemId !== "__total__" && input.itemId !== "__other__"
        ? input.itemId
        : null,
    otherItem: input.itemId === "__other__" ? requiredText(input.otherItem, "Other item") : null,
    quantity:
      input.quantity === "" || input.quantity === null || input.quantity === undefined
        ? null
        : positiveOrZero(input.quantity, "Quantity"),
    unitId: input.unitId || null,
    totalCost,
    expenseType: input.expenseType === "online" ? "online" : "cash",
    comment: optionalText(input.comment),
    userId,
  };
}

export async function saveExpense(input, userId, id = null) {
  const data = normalizeExpense(input, userId);
  const shares = normalizeShares(data.totalCost, input.shares);
  const expenseId = await withTransaction(async (client) => {
    const currentId = id
      ? await updateExpense(client, id, data)
      : await createExpense(client, data);
    if (!currentId) throw new Error("Expense not found");
    await replaceExpenseShares(client, currentId, shares);
    return currentId;
  });
  return findExpense(expenseId);
}

export { deleteExpense, findExpense, listExpenses };
