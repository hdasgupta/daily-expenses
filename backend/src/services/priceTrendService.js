import { q } from "../db/index.js";

const UNIT_FAMILY = {
  kg: { family: "mass", toBase: 1000 },
  kilogram: { family: "mass", toBase: 1000 },
  kilograms: { family: "mass", toBase: 1000 },
  kilo: { family: "mass", toBase: 1000 },
  g: { family: "mass", toBase: 1 },
  gm: { family: "mass", toBase: 1 },
  gms: { family: "mass", toBase: 1 },
  gram: { family: "mass", toBase: 1 },
  grams: { family: "mass", toBase: 1 },
  l: { family: "volume", toBase: 1000 },
  ltr: { family: "volume", toBase: 1000 },
  liter: { family: "volume", toBase: 1000 },
  liters: { family: "volume", toBase: 1000 },
  litre: { family: "volume", toBase: 1000 },
  litres: { family: "volume", toBase: 1000 },
  ml: { family: "volume", toBase: 1 },
  milliliter: { family: "volume", toBase: 1 },
  millilitre: { family: "volume", toBase: 1 },
  milliliters: { family: "volume", toBase: 1 },
  millilitres: { family: "volume", toBase: 1 },
};

function normalizeUnitName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function convertQuantityToTargetUnit(
  quantity,
  sourceUnitId,
  sourceUnitName,
  targetUnitId,
  targetUnitName,
) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  if (String(sourceUnitId || "") === String(targetUnitId || "")) {
    return qty;
  }

  const srcMeta = UNIT_FAMILY[normalizeUnitName(sourceUnitName)];
  const tgtMeta = UNIT_FAMILY[normalizeUnitName(targetUnitName)];
  if (srcMeta && tgtMeta && srcMeta.family === tgtMeta.family) {
    return (qty * srcMeta.toBase) / tgtMeta.toBase;
  }

  return null;
}

export async function getItemPriceTrend({
  locationId = "",
  categoryId = "",
  itemId = "",
  unitId = "",
}) {
  const cleanCategoryId = /^\d+$/.test(String(categoryId || "").trim())
    ? String(categoryId).trim()
    : "";
  const cleanItemId = /^\d+$/.test(String(itemId || "").trim()) ? String(itemId).trim() : "";
  const cleanUnitId = /^\d+$/.test(String(unitId || "").trim()) ? String(unitId).trim() : "";
  const cleanLocationId = /^\d+$/.test(String(locationId || "").trim())
    ? String(locationId).trim()
    : "";

  if (!cleanCategoryId || !cleanItemId || !cleanUnitId) {
    const err = new Error("Category, item, and unit are required.");
    err.statusCode = 400;
    throw err;
  }

  const [itemRes, unitRes, locRes] = await Promise.all([
    q(
      `SELECT i.id, i.name, c.name AS category_name
         FROM public.items i
         JOIN public.categories c ON c.id = i.category_id
        WHERE i.id = $1 AND i.category_id = $2`,
      [cleanItemId, cleanCategoryId],
    ),
    q(`SELECT id, name FROM public.units WHERE id = $1`, [cleanUnitId]),
    cleanLocationId
      ? q(`SELECT id, name FROM public.marketing_locations WHERE id = $1`, [cleanLocationId])
      : Promise.resolve({ rows: [] }),
  ]);

  const itemRow = itemRes.rows[0];
  const unitRow = unitRes.rows[0];
  if (!itemRow || !unitRow) {
    const err = new Error("Selected item or unit was not found.");
    err.statusCode = 404;
    throw err;
  }

  const targetUnitName = unitRow.name;
  const targetItemName = itemRow.name;
  const locationName = locRes.rows[0]?.name || "All locations";

  const marketingQuery = cleanLocationId
    ? `SELECT m.id,
              m.purchase_date::text AS price_date,
              m.approximate_cost AS approx_price,
              m.quantity,
              m.unit_id,
              u.name AS unit_name,
              ml.name AS location_name,
              m.status
         FROM public.marketing_list_items m
         LEFT JOIN public.units u ON u.id = m.unit_id
         LEFT JOIN public.marketing_locations ml ON ml.id = m.location_id
        WHERE m.location_id = $1::bigint
          AND m.status = 'purchased'
          AND (
            m.item_id = $2::bigint
            OR (
              m.category_id = $3::bigint
              AND lower(trim(m.item_name)) = lower(trim($4))
            )
          )
          AND m.approximate_cost IS NOT NULL
          AND m.approximate_cost > 0
          AND m.quantity IS NOT NULL
          AND m.quantity > 0
        ORDER BY m.purchase_date DESC, m.id DESC
        LIMIT 100`
    : `SELECT m.id,
              m.purchase_date::text AS price_date,
              m.approximate_cost AS approx_price,
              m.quantity,
              m.unit_id,
              u.name AS unit_name,
              ml.name AS location_name,
              m.status
         FROM public.marketing_list_items m
         LEFT JOIN public.units u ON u.id = m.unit_id
         LEFT JOIN public.marketing_locations ml ON ml.id = m.location_id
        WHERE m.status = 'purchased'
          AND (
            m.item_id = $1::bigint
            OR (
              m.category_id = $2::bigint
              AND lower(trim(m.item_name)) = lower(trim($3))
            )
          )
          AND m.approximate_cost IS NOT NULL
          AND m.approximate_cost > 0
          AND m.quantity IS NOT NULL
          AND m.quantity > 0
        ORDER BY m.purchase_date DESC, m.id DESC
        LIMIT 100`;

  const marketingParams = cleanLocationId
    ? [cleanLocationId, cleanItemId, cleanCategoryId, targetItemName]
    : [cleanItemId, cleanCategoryId, targetItemName];

  const expenseQuery = cleanLocationId
    ? `SELECT e.id,
              e.expense_date::text AS price_date,
              e.total_cost AS approx_price,
              e.quantity,
              e.unit_id,
              u.name AS unit_name,
              ml.name AS location_name
         FROM public.expenses e
         LEFT JOIN public.units u ON u.id = e.unit_id
         LEFT JOIN public.marketing_locations ml ON ml.id = e.location_id
        WHERE (e.location_id = $1::bigint OR e.location_id IS NULL)
          AND (
            e.item_id = $2::bigint
            OR (
              e.category_id = $3::bigint
              AND e.item_id IS NULL
              AND lower(trim(COALESCE(e.other_item, ''))) = lower(trim($4))
            )
          )
          AND e.total_cost IS NOT NULL
          AND e.total_cost > 0
          AND e.quantity IS NOT NULL
          AND e.quantity > 0
          AND e.unit_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM public.marketing_list_items m
             WHERE m.expense_id = e.id
               AND m.status = 'purchased'
          )
        ORDER BY e.expense_date DESC, e.id DESC
        LIMIT 100`
    : `SELECT e.id,
              e.expense_date::text AS price_date,
              e.total_cost AS approx_price,
              e.quantity,
              e.unit_id,
              u.name AS unit_name,
              ml.name AS location_name
         FROM public.expenses e
         LEFT JOIN public.units u ON u.id = e.unit_id
         LEFT JOIN public.marketing_locations ml ON ml.id = e.location_id
        WHERE (
            e.item_id = $1::bigint
            OR (
              e.category_id = $2::bigint
              AND e.item_id IS NULL
              AND lower(trim(COALESCE(e.other_item, ''))) = lower(trim($3))
            )
          )
          AND e.total_cost IS NOT NULL
          AND e.total_cost > 0
          AND e.quantity IS NOT NULL
          AND e.quantity > 0
          AND e.unit_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM public.marketing_list_items m
             WHERE m.expense_id = e.id
               AND m.status = 'purchased'
          )
        ORDER BY e.expense_date DESC, e.id DESC
        LIMIT 100`;

  const [marketingRes, expenseRes] = await Promise.all([
    q(marketingQuery, marketingParams),
    q(expenseQuery, marketingParams),
  ]);

  const candidates = [];
  for (const row of marketingRes.rows || []) {
    const convertedQty = convertQuantityToTargetUnit(
      row.quantity,
      row.unit_id,
      row.unit_name,
      cleanUnitId,
      targetUnitName,
    );
    if (!convertedQty) continue;
    const approxPrice = Number(row.approx_price);
    const unitPrice = Number((approxPrice / convertedQty).toFixed(2));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;

    candidates.push({
      id: `mkt-${row.id}`,
      date: String(row.price_date || "").slice(0, 10),
      sortId: Number(row.id) || 0,
      unitPrice,
      totalPrice: Number(approxPrice.toFixed(2)),
      quantity: Number(row.quantity),
      unitName: row.unit_name || targetUnitName,
      locationName: row.location_name || locationName,
      source: row.status === "purchased" ? "Purchased (Approx. price)" : "Pending (Approx. price)",
    });
  }

  for (const row of expenseRes.rows || []) {
    const convertedQty = convertQuantityToTargetUnit(
      row.quantity,
      row.unit_id,
      row.unit_name,
      cleanUnitId,
      targetUnitName,
    );
    if (!convertedQty) continue;
    const totalCost = Number(row.approx_price);
    const unitPrice = Number((totalCost / convertedQty).toFixed(2));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;

    candidates.push({
      id: `exp-${row.id}`,
      date: String(row.price_date || "").slice(0, 10),
      sortId: Number(row.id) || 0,
      unitPrice,
      totalPrice: Number(totalCost.toFixed(2)),
      quantity: Number(row.quantity),
      unitName: row.unit_name || targetUnitName,
      locationName: row.location_name || locationName,
      source: "Direct Expense",
    });
  }

  candidates.sort((a, b) => {
    const dateDiff = b.date.localeCompare(a.date);
    if (dateDiff !== 0) return dateDiff;
    return b.sortId - a.sortId;
  });

  const points = candidates.slice(0, 5);

  return {
    locationName,
    categoryName: itemRow.category_name,
    itemName: targetItemName,
    unitName: targetUnitName,
    points,
  };
}

let prefTableReadyPromise = null;

async function ensurePriceTrendPreferencesTable() {
  if (!prefTableReadyPromise) {
    prefTableReadyPromise = q(
      `CREATE TABLE IF NOT EXISTS public.price_trend_user_preferences (
        user_id BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
        location_id VARCHAR(50) NOT NULL DEFAULT '',
        category_id VARCHAR(50) NOT NULL DEFAULT '',
        item_id VARCHAR(50) NOT NULL DEFAULT '',
        unit_id VARCHAR(50) NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ).catch((err) => {
      prefTableReadyPromise = null;
      console.error("Failed to ensure public.price_trend_user_preferences table", err);
    });
  }
  await prefTableReadyPromise;
}

const GRAM_NAMES = new Set(["g", "gm", "gms", "gram", "grams"]);
const KG_NAMES = new Set(["kg", "kilo", "kilos", "kilogram", "kilograms"]);
const ML_NAMES = new Set(["ml", "milliliter", "millilitre", "milliliters", "millilitres"]);
const LITRE_NAMES = new Set(["l", "ltr", "liter", "litre", "liters", "litres"]);

export async function getSmartUnitForItem({ locationId = "", categoryId = "", itemId = "" }) {
  const cleanCategoryId = /^\d+$/.test(String(categoryId || "").trim())
    ? String(categoryId).trim()
    : "";
  const cleanItemId = /^\d+$/.test(String(itemId || "").trim()) ? String(itemId).trim() : "";
  const cleanLocationId = /^\d+$/.test(String(locationId || "").trim())
    ? String(locationId).trim()
    : "";

  if (!cleanItemId) {
    return { unitId: "", unitName: "" };
  }

  const [itemRes, unitsRes] = await Promise.all([
    q(`SELECT id, name, category_id FROM public.items WHERE id = $1`, [cleanItemId]),
    q(`SELECT id, name FROM public.units ORDER BY id ASC`),
  ]);

  const itemRow = itemRes.rows[0];
  const allUnits = unitsRes.rows || [];
  const itemName = itemRow?.name || "";
  const resolvedCatId = cleanCategoryId || String(itemRow?.category_id || "");

  const findMostUsed = async (locId) => {
    const res = locId
      ? await q(
          `SELECT m.unit_id, u.name AS unit_name, COUNT(*)::int AS usage_count
             FROM public.marketing_list_items m
             JOIN public.units u ON u.id = m.unit_id
            WHERE m.location_id = $1::bigint
              AND m.status <> 'removed'
              AND m.unit_id IS NOT NULL
              AND (
                m.item_id = $2::bigint
                OR ($3 <> '' AND m.category_id = $3::bigint AND lower(trim(m.item_name)) = lower(trim($4)))
              )
            GROUP BY m.unit_id, u.name
            ORDER BY usage_count DESC, MAX(m.purchase_date) DESC
            LIMIT 1`,
          [locId, cleanItemId, resolvedCatId, itemName],
        )
      : await q(
          `SELECT m.unit_id, u.name AS unit_name, COUNT(*)::int AS usage_count
             FROM public.marketing_list_items m
             JOIN public.units u ON u.id = m.unit_id
            WHERE m.status <> 'removed'
              AND m.unit_id IS NOT NULL
              AND (
                m.item_id = $1::bigint
                OR ($2 <> '' AND m.category_id = $2::bigint AND lower(trim(m.item_name)) = lower(trim($3)))
              )
            GROUP BY m.unit_id, u.name
            ORDER BY usage_count DESC, MAX(m.purchase_date) DESC
            LIMIT 1`,
          [cleanItemId, resolvedCatId, itemName],
        );
    return res.rows[0] || null;
  };

  let top = cleanLocationId ? await findMostUsed(cleanLocationId) : null;
  if (!top) {
    top = await findMostUsed("");
  }

  // Fallback to expenses table if no marketing list unit history exists
  if (!top) {
    const expRes = await q(
      `SELECT e.unit_id, u.name AS unit_name, COUNT(*)::int AS usage_count
         FROM public.expenses e
         JOIN public.units u ON u.id = e.unit_id
        WHERE e.item_id = $1::bigint
          AND e.unit_id IS NOT NULL
        GROUP BY e.unit_id, u.name
        ORDER BY usage_count DESC, MAX(e.expense_date) DESC
        LIMIT 1`,
      [cleanItemId],
    );
    top = expRes.rows[0] || null;
  }

  if (!top) {
    return { unitId: "", unitName: "" };
  }

  let chosenId = String(top.unit_id);
  let chosenName = top.unit_name;
  const norm = normalizeUnitName(chosenName);

  // Prefer Kilogram over Gram
  if (GRAM_NAMES.has(norm)) {
    const kgUnit = allUnits.find((u) => KG_NAMES.has(normalizeUnitName(u.name)));
    if (kgUnit) {
      chosenId = String(kgUnit.id);
      chosenName = kgUnit.name;
    }
  }

  // Prefer Litre over Millilitre
  if (ML_NAMES.has(norm)) {
    const litreUnit = allUnits.find((u) => LITRE_NAMES.has(normalizeUnitName(u.name)));
    if (litreUnit) {
      chosenId = String(litreUnit.id);
      chosenName = litreUnit.name;
    }
  }

  return { unitId: chosenId, unitName: chosenName };
}

export async function getUserPriceTrendPreferences(userId) {
  await ensurePriceTrendPreferencesTable();
  const res = await q(
    `SELECT location_id, category_id, item_id, unit_id
       FROM public.price_trend_user_preferences
      WHERE user_id = $1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return { preferences: null };
  return {
    preferences: {
      locationId: String(row.location_id || ""),
      categoryId: String(row.category_id || ""),
      itemId: String(row.item_id || ""),
      unitId: String(row.unit_id || ""),
    },
  };
}

export async function saveUserPriceTrendPreferences(userId, payload = {}) {
  await ensurePriceTrendPreferencesTable();
  const cleanId = (v) => (/^\d+$/.test(String(v || "").trim()) ? String(v).trim() : "");
  const locationId = cleanId(payload.locationId);
  const categoryId = cleanId(payload.categoryId);
  const itemId = cleanId(payload.itemId);
  const unitId = cleanId(payload.unitId);

  await q(
    `INSERT INTO public.price_trend_user_preferences (user_id, location_id, category_id, item_id, unit_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id)
     DO UPDATE SET
       location_id = EXCLUDED.location_id,
       category_id = EXCLUDED.category_id,
       item_id = EXCLUDED.item_id,
       unit_id = EXCLUDED.unit_id,
       updated_at = now()`,
    [userId, locationId, categoryId, itemId, unitId],
  );

  return {
    preferences: { locationId, categoryId, itemId, unitId },
  };
}

export async function getItemsWithPriceTrendData({ categoryId = "", locationId = "" }) {
  const cleanCategoryId = /^\d+$/.test(String(categoryId || "").trim())
    ? String(categoryId).trim()
    : "";
  const cleanLocationId = /^\d+$/.test(String(locationId || "").trim())
    ? String(locationId).trim()
    : "";

  if (!cleanCategoryId) {
    return [];
  }

  const res = await q(
    `SELECT i.id, i.name
       FROM public.items i
      WHERE i.category_id = $1::bigint
        AND (
          EXISTS (
            SELECT 1
              FROM public.marketing_list_items m
             WHERE ($2 = '' OR m.location_id = NULLIF($2, '')::bigint)
               AND m.status = 'purchased'
               AND m.approximate_cost IS NOT NULL
               AND m.approximate_cost > 0
               AND m.quantity IS NOT NULL
               AND m.quantity > 0
               AND (
                 m.item_id = i.id
                 OR (
                   m.category_id = i.category_id
                   AND lower(trim(m.item_name)) = lower(trim(i.name))
                 )
               )
          )
          OR EXISTS (
            SELECT 1
              FROM public.expenses e
             WHERE ($2 = '' OR e.location_id = NULLIF($2, '')::bigint OR e.location_id IS NULL)
               AND e.total_cost IS NOT NULL
               AND e.total_cost > 0
               AND e.quantity IS NOT NULL
               AND e.quantity > 0
               AND e.unit_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                   FROM public.marketing_list_items m
                  WHERE m.expense_id = e.id
                    AND m.status = 'purchased'
               )
               AND (
                 e.item_id = i.id
                 OR (
                   e.category_id = i.category_id
                   AND e.item_id IS NULL
                   AND lower(trim(COALESCE(e.other_item, ''))) = lower(trim(i.name))
                 )
               )
          )
        )
      ORDER BY LOWER(i.name) ASC, i.id ASC`,
    [cleanCategoryId, cleanLocationId],
  );
  return res.rows || [];
}
