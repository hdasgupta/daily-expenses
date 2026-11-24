export function normalizeUnitFamily(unitName) {
  const raw = String(unitName || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");
  if (!raw) return null;
  if (["kg", "kgs", "kilogram", "kilograms", "kilo", "kilos"].includes(raw)) {
    return { family: "mass", factor: 1000 };
  }
  if (["g", "gm", "gms", "gram", "grams"].includes(raw)) {
    return { family: "mass", factor: 1 };
  }
  if (["mg", "milligram", "milligrams"].includes(raw)) {
    return { family: "mass", factor: 0.001 };
  }
  if (["l", "ltr", "ltrs", "litre", "litres", "liter", "liters"].includes(raw)) {
    return { family: "volume", factor: 1000 };
  }
  if (["ml", "millilitre", "millilitres", "milliliter", "milliliters"].includes(raw)) {
    return { family: "volume", factor: 1 };
  }
  if (["doz", "dozen", "dozens"].includes(raw)) {
    return { family: "count", factor: 12 };
  }
  if (
    ["pc", "pcs", "piece", "pieces", "no", "nos", "number", "numbers", "unit", "units"].includes(
      raw,
    )
  ) {
    return { family: "count", factor: 1 };
  }
  return { family: `exact:${raw}`, factor: 1 };
}

export function computeUnitConversionRatio(fromUnitId, fromUnitName, toUnitId, toUnitName) {
  if (fromUnitId && toUnitId && String(fromUnitId) === String(toUnitId)) {
    return 1;
  }
  const fromNorm = normalizeUnitFamily(fromUnitName);
  const toNorm = normalizeUnitFamily(toUnitName);
  if (fromNorm && toNorm && fromNorm.family === toNorm.family && fromNorm.factor > 0) {
    return toNorm.factor / fromNorm.factor;
  }
  return null;
}

export function getRowSavedApproximateCost(row) {
  if (!row) return null;
  const linkedCount = Number(row.expense_linked_item_count || 1);
  const rawCandidates = [
    row.approximate_cost,
    row.approximateCost,
    linkedCount === 1 ? row.expense_price : null,
    linkedCount === 1 ? row.expense_total_cost : null,
  ];
  for (const raw of rawCandidates) {
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    const cleaned = String(raw).replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Number(parsed.toFixed(2));
    }
  }
  return null;
}

export function calculateApproximateCostFromHistory(
  draftForm,
  allRows,
  allUnits,
  editingId = null,
) {
  const qty = Number(draftForm?.quantity);
  const unitId = String(draftForm?.unitId || "").trim();
  const itemId = String(draftForm?.itemId || "").trim();
  const itemName = String(draftForm?.itemName || "")
    .trim()
    .toLowerCase();

  if (!Number.isFinite(qty) || qty <= 0 || !unitId || (!itemId && !itemName)) {
    return { value: "", hint: "" };
  }

  const targetUnit = (allUnits || []).find((u) => String(u.id) === unitId);
  const targetUnitName = targetUnit?.name || "";

  const otherCandidates = [];
  const selfCandidates = [];

  for (const row of allRows || []) {
    const isSelf = Boolean(editingId && String(row.id) === String(editingId));

    const rowItemId = String(row.item_id || "").trim();
    const rowItemName = String(row.item_name || "")
      .trim()
      .toLowerCase();
    const matchesItem =
      (itemId && rowItemId && itemId === rowItemId) ||
      (itemName && rowItemName && itemName === rowItemName);
    if (!matchesItem) continue;

    const refCost = getRowSavedApproximateCost(row) || 0;
    if (!(refCost > 0)) continue;

    const approxCost = Number(row.approximate_cost ?? row.approximateCost);
    const usePlanned =
      Number.isFinite(approxCost) && approxCost > 0 && Number(row.quantity) > 0 && row.unit_id;
    const refQty = usePlanned
      ? Number(row.quantity)
      : Number(row.purchased_quantity) > 0
        ? Number(row.purchased_quantity)
        : Number(row.quantity);
    const refUnitId = usePlanned
      ? String(row.unit_id || "")
      : String(row.purchased_unit_id || row.unit_id || "");
    const refUnitName = usePlanned
      ? row.unit_name || ""
      : row.purchased_unit_name || row.unit_name || "";

    if (!(refQty > 0) || !refUnitId) continue;

    const ratio = computeUnitConversionRatio(refUnitId, refUnitName, unitId, targetUnitName);
    if (ratio === null) continue;

    const candidate = {
      row,
      refCost,
      refQty,
      refUnitId,
      refUnitName: refUnitName || targetUnitName,
      ratio,
      exactUnitMatch: refUnitId === unitId,
    };

    if (isSelf) {
      selfCandidates.push(candidate);
    } else {
      otherCandidates.push(candidate);
    }
  }

  const candidates = otherCandidates.length ? otherCandidates : selfCandidates;
  if (!candidates.length) {
    return { value: "", hint: "" };
  }

  const chosen = candidates.find((c) => c.exactUnitMatch) || candidates[0];
  const estimated = (chosen.refCost / chosen.refQty) * (qty * chosen.ratio);
  if (!Number.isFinite(estimated) || estimated <= 0) {
    return { value: "", hint: "" };
  }

  const rounded = Number(estimated.toFixed(2));
  return {
    value: String(rounded),
    hint: `Calculated from last entry (${chosen.refQty} ${chosen.refUnitName} @ ₹${chosen.refCost.toFixed(2)})`,
  };
}

function recordFreq(map, key, rowDate, rowId) {
  if (!key) return;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, { count: 1, latestDate: rowDate, latestId: rowId });
    return;
  }
  prev.count += 1;
  if (rowDate > prev.latestDate || (rowDate === prev.latestDate && rowId > prev.latestId)) {
    prev.latestDate = rowDate;
    prev.latestId = rowId;
  }
}

function pickMostFrequentKey(map) {
  let bestKey = "";
  let bestStat = null;
  for (const [key, stat] of map.entries()) {
    if (
      !bestStat ||
      stat.count > bestStat.count ||
      (stat.count === bestStat.count &&
        (stat.latestDate > bestStat.latestDate ||
          (stat.latestDate === bestStat.latestDate && stat.latestId > bestStat.latestId)))
    ) {
      bestKey = key;
      bestStat = stat;
    }
  }
  return bestKey;
}

const CATEGORY_HINTS = [
  {
    keywords: [
      "onion", "potato", "tomato", "chilli", "ginger", "garlic", "coriander", "spinach",
      "palak", "okra", "bhindi", "cauliflower", "cabbage", "eggplant", "brinjal", "begun",
      "carrot", "peas", "capsicum", "bell pepper", "cucumber", "radish", "pumpkin",
      "bitter gourd", "karela", "ridge gourd", "bottle gourd", "beans", "mushroom",
      "curry leaves", "mint", "pudina", "lemon", "beetroot", "sweet potato", "arbi",
    ],
    categoryNames: ["vegetable", "vegetables", "veggies", "produce", "greens"],
  },
  {
    keywords: [
      "milk", "curd", "yogurt", "dahi", "paneer", "chhena", "butter", "ghee",
      "cheese", "khoya", "mawa", "cream", "condensed milk", "buttermilk",
    ],
    categoryNames: ["dairy", "milk", "milk products", "groceries", "grocery"],
  },
  {
    keywords: [
      "chicken", "egg", "fish", "prawn", "chingri", "mutton", "rohu", "katla",
      "hilsa", "bhetki", "pabda", "parshe", "meat",
    ],
    categoryNames: ["non-veg", "non veg", "meat", "fish", "poultry", "seafood", "protein"],
  },
  {
    keywords: [
      "turmeric", "cumin", "jeera", "garam masala", "cardamom", "cinnamon", "clove",
      "pepper", "mustard seeds", "nigella", "kalo jeere", "fenugreek", "methi",
      "hing", "asafoetida", "fennel", "bay leaf", "bay leaves", "chilli powder",
      "coriander powder", "chaat masala", "panch phoron", "saffron", "salt",
    ],
    categoryNames: ["spice", "spices", "masala", "condiments", "groceries", "grocery"],
  },
  {
    keywords: [
      "rice", "flour", "maida", "besan", "atta", "sooji", "semolina", "poha",
      "muri", "puffed rice", "dal", "lentil", "sugar", "jaggery", "gur", "oil",
      "mustard oil", "cooking oil", "bread", "sabudana", "baking", "cornflour",
      "noodles", "pasta", "cashew", "raisin", "almond", "peanut", "coconut",
    ],
    categoryNames: ["grocery", "groceries", "staples", "grains", "ration", "pantry", "food"],
  },
];

function guessCategoryIdFromName(itemName, categories) {
  const lower = String(itemName || "").trim().toLowerCase();
  if (!lower || !Array.isArray(categories) || !categories.length) return "";

  for (const group of CATEGORY_HINTS) {
    if (group.keywords.some((kw) => lower.includes(kw))) {
      for (const catName of group.categoryNames) {
        const match = categories.find((c) => {
          const cn = String(c.name || "").trim().toLowerCase();
          return cn === catName || cn.includes(catName);
        });
        if (match) return String(match.id);
      }
    }
  }
  return "";
}

function parseRecipeFallbackQuantity(rawQty) {
  const s = String(rawQty || "").trim();
  if (!s) return "";
  const num = Number(s);
  if (Number.isFinite(num) && num > 0) return String(num);
  const fracMatch = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fracMatch) {
    const den = Number(fracMatch[2]);
    if (den > 0) return String(Number((Number(fracMatch[1]) / den).toFixed(2)));
  }
  return "";
}

export function inferHistoryDefaultsForItem(
  itemName,
  marketingRows = [],
  categories = [],
  units = [],
  fallbackIngredient = null,
) {
  const cleanName = String(itemName || "").trim().toLowerCase();
  const validCatIds = new Set((categories || []).map((c) => String(c.id)));
  const validUnitIds = new Set((units || []).map((u) => String(u.id)));

  // Exact item_name match first; fallback to substring match if exact has 0 rows
  let matchedRows = [];
  if (cleanName) {
    matchedRows = (marketingRows || []).filter(
      (row) => String(row.item_name || "").trim().toLowerCase() === cleanName,
    );
    if (!matchedRows.length) {
      matchedRows = (marketingRows || []).filter((row) => {
        const rn = String(row.item_name || "").trim().toLowerCase();
        return rn && (rn === cleanName || rn.includes(cleanName) || cleanName.includes(rn));
      });
    }
  }

  const catStats = new Map();
  const itemStats = new Map();
  const unitStats = new Map();
  const parsedRows = [];

  for (const row of matchedRows) {
    const rowDate = String(row.purchase_date || "").slice(0, 10);
    const rowId = Number(row.id || 0);

    const cid = row.category_id != null && row.category_id !== "" ? String(row.category_id) : "";
    if (cid && validCatIds.has(cid)) {
      recordFreq(catStats, cid, rowDate, rowId);
    }

    const iid = row.item_id != null && row.item_id !== "" ? String(row.item_id) : "";
    if (iid) {
      recordFreq(itemStats, iid, rowDate, rowId);
    }

    const uid = row.unit_id != null && row.unit_id !== "" ? String(row.unit_id) : "";
    if (uid && validUnitIds.has(uid)) {
      recordFreq(unitStats, uid, rowDate, rowId);
    }

    const qtyNum = Number(row.quantity);
    const cleanQty = Number.isFinite(qtyNum) && qtyNum > 0 ? String(Number(qtyNum.toFixed(4))) : "";
    parsedRows.push({ uid, cleanQty, rowDate, rowId });
  }

  const historyCategoryId = pickMostFrequentKey(catStats);
  const guessedCategoryId = historyCategoryId || guessCategoryIdFromName(itemName, categories);
  const historyItemId = pickMostFrequentKey(itemStats);
  const historyUnitId = pickMostFrequentKey(unitStats);

  const qtyStatsForUnit = new Map();
  const qtyStatsAll = new Map();
  for (const entry of parsedRows) {
    if (!entry.cleanQty) continue;
    recordFreq(qtyStatsAll, entry.cleanQty, entry.rowDate, entry.rowId);
    if (historyUnitId && entry.uid === historyUnitId) {
      recordFreq(qtyStatsForUnit, entry.cleanQty, entry.rowDate, entry.rowId);
    }
  }
  const historyQuantity =
    pickMostFrequentKey(qtyStatsForUnit) || pickMostFrequentKey(qtyStatsAll) || "";

  // Fallback unit & quantity from recipe ingredient if history has none
  const ingredientUnitLower = String(fallbackIngredient?.unit || "").trim().toLowerCase();
  const fallbackUnit = (units || []).find(
    (u) => String(u.name || "").trim().toLowerCase() === ingredientUnitLower,
  );
  const fallbackUnitId = fallbackUnit ? String(fallbackUnit.id) : "";
  const fallbackQuantity = parseRecipeFallbackQuantity(fallbackIngredient?.quantity);

  return {
    categoryId: guessedCategoryId,
    categoryFromHistory: Boolean(historyCategoryId),
    itemId: historyItemId,
    unitId: historyUnitId || fallbackUnitId,
    unitFromHistory: Boolean(historyUnitId),
    quantity: historyQuantity || fallbackQuantity,
    quantityFromHistory: Boolean(historyQuantity),
  };
}
