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
  doz: { family: "count", toBase: 12 },
  dozen: { family: "count", toBase: 12 },
  dozens: { family: "count", toBase: 12 },
  pc: { family: "count", toBase: 1 },
  pcs: { family: "count", toBase: 1 },
  piece: { family: "count", toBase: 1 },
  pieces: { family: "count", toBase: 1 },
  no: { family: "count", toBase: 1 },
  nos: { family: "count", toBase: 1 },
  unit: { family: "count", toBase: 1 },
  units: { family: "count", toBase: 1 },
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

function addDaysIso(isoDate, days) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function formatShortDate(isoDate) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export async function getItemOrderFrequency({
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

  const [rowsRes, expenseRowsRes] = await Promise.all([
    q(
      `SELECT m.id,
              m.purchase_date::text AS order_date,
              (DATE_TRUNC('week', (m.purchase_date + INTERVAL '1 day'))::date - 1)::text AS week_start,
              m.status,
              m.quantity,
              m.unit_id,
              u.name AS unit_name,
              m.purchased_quantity,
              m.purchased_unit_id,
              pu.name AS purchased_unit_name
         FROM public.marketing_list_items m
         LEFT JOIN public.units u ON u.id = m.unit_id
         LEFT JOIN public.units pu ON pu.id = m.purchased_unit_id
        WHERE ($1 = '' OR m.location_id = NULLIF($1, '')::bigint)
          AND m.status = 'purchased'
          AND (
            m.item_id = $2::bigint
            OR (
              m.category_id = $3::bigint
              AND lower(trim(m.item_name)) = lower(trim($4))
            )
          )
          AND (
            (m.quantity IS NOT NULL AND m.quantity > 0)
            OR (m.purchased_quantity IS NOT NULL AND m.purchased_quantity > 0)
          )
        ORDER BY m.purchase_date DESC, m.id DESC
        LIMIT 500`,
      [cleanLocationId, cleanItemId, cleanCategoryId, targetItemName],
    ),
    q(
      `SELECT e.id,
              e.expense_date::text AS order_date,
              (DATE_TRUNC('week', (e.expense_date + INTERVAL '1 day'))::date - 1)::text AS week_start,
              'purchased' AS status,
              e.quantity,
              e.unit_id,
              u.name AS unit_name,
              e.quantity AS purchased_quantity,
              e.unit_id AS purchased_unit_id,
              u.name AS purchased_unit_name
         FROM public.expenses e
         LEFT JOIN public.units u ON u.id = e.unit_id
        WHERE ($1 = '' OR e.location_id = NULLIF($1, '')::bigint OR e.location_id IS NULL)
          AND (
            e.item_id = $2::bigint
            OR (
              e.category_id = $3::bigint
              AND e.item_id IS NULL
              AND lower(trim(COALESCE(e.other_item, ''))) = lower(trim($4))
            )
          )
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
        LIMIT 500`,
      [cleanLocationId, cleanItemId, cleanCategoryId, targetItemName],
    ),
  ]);
  const combinedRows = [...(rowsRes.rows || []), ...(expenseRowsRes.rows || [])];

  const byWeek = new Map();
  let totalOrdered = 0;
  let totalOrders = 0;
  let firstOrderDate = "";

  for (const row of combinedRows) {
    const usePurchased =
      row.status === "purchased" && Number(row.purchased_quantity) > 0 && row.purchased_unit_id;
    const srcQty = usePurchased ? row.purchased_quantity : row.quantity;
    const srcUnitId = usePurchased ? row.purchased_unit_id : row.unit_id;
    const srcUnitName = usePurchased ? row.purchased_unit_name : row.unit_name;

    const converted = convertQuantityToTargetUnit(
      srcQty,
      srcUnitId,
      srcUnitName,
      cleanUnitId,
      targetUnitName,
    );
    if (!converted || !Number.isFinite(converted) || converted <= 0) continue;

    const orderDate = String(row.order_date || "").slice(0, 10);
    const weekStart = String(row.week_start || "").slice(0, 10);
    if (!weekStart) continue;

    if (orderDate && (!firstOrderDate || orderDate < firstOrderDate)) {
      firstOrderDate = orderDate;
    }

    totalOrdered += converted;
    totalOrders += 1;

    const existing = byWeek.get(weekStart);
    if (!existing) {
      const weekEnd = addDaysIso(weekStart, 6);
      byWeek.set(weekStart, {
        weekStart,
        weekEnd,
        weekLabel: `${formatShortDate(weekStart)}`,
        weekRange: `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`,
        totalQuantity: converted,
        orderCount: 1,
      });
    } else {
      existing.totalQuantity += converted;
      existing.orderCount += 1;
    }
  }

  const allWeeks = Array.from(byWeek.values())
    .map((w) => ({
      ...w,
      totalQuantity: Number(w.totalQuantity.toFixed(2)),
    }))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  // Show latest 12 weeks in chart (chronological order for display)
  const weeks = allWeeks.slice(0, 12);

  const activeWeekCount = allWeeks.length;
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  const todayDow = new Date(todayUtc).getUTCDay(); // 0 = Sun .. 6 = Sat
  const endSaturdayUtc = todayUtc + (6 - todayDow) * 86400000;

  // Continuous days from first order's Sunday (weekStart) through current/upcoming Saturday
  let totalDays = 0;
  if (allWeeks.length > 0) {
    const earliestWeekStart = allWeeks[allWeeks.length - 1].weekStart;
    const [fy, fm, fd] = earliestWeekStart.split("-").map(Number);
    const firstWeekStartUtc = Date.UTC(fy, fm - 1, fd);
    totalDays = Math.max(7, Math.floor((endSaturdayUtc - firstWeekStartUtc) / 86400000) + 1);
  }
  // Formula: (Total quantity item ordered / continuous days from first Sunday to current/upcoming Saturday) * 7
  const avgPerWeek =
    totalDays > 0 && totalOrdered > 0 ? Number(((totalOrdered / totalDays) * 7).toFixed(2)) : 0;
  const latestWeekAmount = weeks.length ? weeks[0].totalQuantity : 0;
  const maxWeekAmount = allWeeks.length
    ? Math.max(...allWeeks.map((w) => w.totalQuantity))
    : 0;
  const minWeekAmount = allWeeks.length
    ? Math.min(...allWeeks.map((w) => w.totalQuantity))
    : 0;

  return {
    locationName,
    categoryName: itemRow.category_name,
    itemName: targetItemName,
    unitName: targetUnitName,
    weeks,
    summary: {
      avgPerWeek,
      firstOrderDate,
      totalDays,
      latestWeekAmount,
      totalOrdered: Number(totalOrdered.toFixed(2)),
      totalOrders,
      activeWeeks: activeWeekCount,
      maxWeekAmount,
      minWeekAmount,
    },
  };
}

let prefTableReadyPromise = null;

async function ensureOrderFrequencyPreferencesTable() {
  if (!prefTableReadyPromise) {
    prefTableReadyPromise = q(
      `CREATE TABLE IF NOT EXISTS public.order_frequency_user_preferences (
        user_id BIGINT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
        location_id VARCHAR(50) NOT NULL DEFAULT '',
        category_id VARCHAR(50) NOT NULL DEFAULT '',
        item_id VARCHAR(50) NOT NULL DEFAULT '',
        unit_id VARCHAR(50) NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ).catch((err) => {
      prefTableReadyPromise = null;
      console.error("Failed to ensure public.order_frequency_user_preferences table", err);
    });
  }
  await prefTableReadyPromise;
}

export async function getUserOrderFrequencyPreferences(userId) {
  await ensureOrderFrequencyPreferencesTable();
  const res = await q(
    `SELECT location_id, category_id, item_id, unit_id
       FROM public.order_frequency_user_preferences
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

export async function saveUserOrderFrequencyPreferences(userId, payload = {}) {
  await ensureOrderFrequencyPreferencesTable();
  const cleanId = (v) => (/^\d+$/.test(String(v || "").trim()) ? String(v).trim() : "");
  const locationId = cleanId(payload.locationId);
  const categoryId = cleanId(payload.categoryId);
  const itemId = cleanId(payload.itemId);
  const unitId = cleanId(payload.unitId);

  await q(
    `INSERT INTO public.order_frequency_user_preferences (user_id, location_id, category_id, item_id, unit_id, updated_at)
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

export async function getItemsWithOrderFrequencyData({ categoryId = "", locationId = "" }) {
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
               AND (
                 (m.quantity IS NOT NULL AND m.quantity > 0)
                 OR (m.purchased_quantity IS NOT NULL AND m.purchased_quantity > 0)
               )
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
