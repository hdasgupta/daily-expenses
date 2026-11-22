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
          AND m.status <> 'removed'
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
        WHERE m.status <> 'removed'
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

  const marketingRes = await q(marketingQuery, marketingParams);

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
