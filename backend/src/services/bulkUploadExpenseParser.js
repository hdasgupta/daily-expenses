import { bulkUploadSql } from "../../scripts/sql/bulkUploadSql.js";

function number(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be zero or greater`);
  return parsed;
}
function parseDate(value) {
  const raw = String(value || "")
    .trim()
    .replace(/-/g, ",");
  const parts = raw.split(",").map(Number);
  if (parts.length !== 3 || !parts.every(Number.isInteger))
    throw new Error("date must be yyyy,mm,dd");
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error("Invalid date");
  return `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function parseShares(text, totalCost, survivorRows) {
  const parts = String(text || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error("shares is required");
  const shares = [];
  const skipped = [];
  for (const part of parts) {
    const split = part.split("|");
    if (split.length < 2) continue;
    const survivorName = String(split[0] || "").trim();
    const raw = String(split[1] || "").trim();
    const survivor = survivorRows.find(
      (row) => row.full_name.toLowerCase() === survivorName.toLowerCase(),
    );
    if (!survivor) {
      skipped.push(survivorName);
      continue;
    }
    if (raw === "~") {
      shares.push({ survivorId: survivor.id, shareType: "remaining", amount: null });
      continue;
    }
    if (raw.endsWith("%")) {
      const pct = Number(raw.slice(0, -1));
      if (!Number.isFinite(pct) || pct < 0) throw new Error(`Invalid percentage share: ${raw}`);
      shares.push({
        survivorId: survivor.id,
        shareType: "fixed",
        amount: Math.round(totalCost * pct) / 100,
      });
      continue;
    }
    shares.push({
      survivorId: survivor.id,
      shareType: "fixed",
      amount: number(raw, "Share amount"),
    });
  }
  if (!shares.length) throw new Error("No valid survivor names found in shares");
  if (new Set(shares.map((x) => String(x.survivorId))).size !== shares.length)
    throw new Error("Duplicate survivor share");
  if (shares.filter((x) => x.shareType === "remaining").length > 1)
    throw new Error("Only one remaining share is allowed");
  const fixed = shares
    .filter((x) => x.shareType === "fixed")
    .reduce((s, x) => s + Number(x.amount || 0), 0);
  let remaining = Math.round((totalCost - fixed) * 100) / 100;
  if (remaining < 0) throw new Error("Fixed shares exceed total cost");
  const remainder = shares.find((x) => x.shareType === "remaining");
  if (remainder) {
    remainder.amount = remaining;
    remaining = 0;
  }
  if (Math.abs(remaining) > 0.009)
    throw new Error("Share amounts/percentages must equal total cost or include ~ remaining");
  return { shares, skipped };
}

export async function normalizeForBulkExpense(client, input, userId) {
  const categoryResult = await client.query(bulkUploadSql.categoryByName, [input.category]);
  if (!categoryResult.rows[0]) throw new Error(`Category not found: ${input.category}`);
  const categoryId = categoryResult.rows[0].id;
  let itemId = null;
  let otherItem = null;
  const item = String(input.item || "").trim();
  if (item && item.toLowerCase() !== "total") {
    const itemResult = await client.query(bulkUploadSql.itemByName, [categoryId, item]);
    if (itemResult.rows[0]) itemId = itemResult.rows[0].id;
    else otherItem = item;
  }
  const unitResult = input.unit
    ? await client.query(bulkUploadSql.unitByName, [input.unit])
    : { rows: [] };
  if (input.unit && !unitResult.rows[0]) throw new Error(`Unit not found: ${input.unit}`);
  const survivorResult = await client.query(bulkUploadSql.survivors);
  const totalCost = number(input.total_cost || input.price, "total_cost");
  const parsed = parseShares(input.shares, totalCost, survivorResult.rows);
  return {
    date: parseDate(input.date),
    categoryId,
    itemId,
    otherItem,
    quantity: input.quantity ? number(input.quantity, "quantity") : null,
    unitId: unitResult.rows[0]?.id || null,
    totalCost,
    expenseType:
      String(input.expense_type || "cash").toLowerCase() === "online" ? "online" : "cash",
    comment: String(input.comment || "").trim() || null,
    shares: parsed.shares,
    skippedSurvivors: parsed.skipped,
    userId,
  };
}
