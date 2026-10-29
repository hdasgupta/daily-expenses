import crypto from "node:crypto";
import { q } from "../db/index.js";
import { env } from "../config/env.js";
import { sendMarketingListEmail } from "../services/mailService.js";

const itemSelect = `SELECT m.*, c.name AS category_name, u.name AS unit_name,
 l.name AS location_name, pu.name AS purchased_unit_name,
 cu.full_name AS created_by_name, uu.full_name AS purchased_by_name,
 e.expense_date::text AS expense_date, e.total_cost AS expense_total_cost,
 e.expense_type AS expense_type, e.comment AS expense_comment,
 e.quantity AS expense_quantity, e.other_item AS expense_other_item,
 e.proof_key AS expense_proof_key, e.created_at AS expense_created_at,
 ec.name AS expense_category_name, ei.name AS expense_item_name,
 eu.name AS expense_unit_name, ecu.full_name AS expense_created_by_name,
 COALESCE(
   (
     SELECT json_agg(
       json_build_object(
         'survivorId', s.id,
         'survivorName', s.full_name,
         'shareType', es.share_type,
         'amount', es.amount
       )
       ORDER BY s.full_name
     )
     FROM public.expense_shares es
     JOIN public.survivors s ON s.id = es.survivor_id
     WHERE es.expense_id = m.expense_id
   ),
   '[]'::json
 ) AS expense_shares
 FROM public.marketing_list_items m
 LEFT JOIN public.categories c ON c.id=m.category_id
 LEFT JOIN public.units u ON u.id=m.unit_id
 LEFT JOIN public.marketing_locations l ON l.id=m.location_id
 LEFT JOIN public.units pu ON pu.id=m.purchased_unit_id
 LEFT JOIN public.users cu ON cu.id=m.created_by
 LEFT JOIN public.users uu ON uu.id=m.updated_by
 LEFT JOIN public.expenses e ON e.id=m.expense_id
 LEFT JOIN public.categories ec ON ec.id=e.category_id
 LEFT JOIN public.items ei ON ei.id=e.item_id
 LEFT JOIN public.units eu ON eu.id=e.unit_id
 LEFT JOIN public.users ecu ON ecu.id=e.created_by`;

let locationGpsSchemaReady = false;
let marketingItemCostSchemaReady = false;

async function ensureMarketingItemCostSchema() {
  if (marketingItemCostSchemaReady) return;
  try {
    await q(`
      ALTER TABLE public.marketing_list_items
        ADD COLUMN IF NOT EXISTS approximate_cost NUMERIC(14, 2)
    `);
    marketingItemCostSchemaReady = true;
  } catch (error) {
    console.error("Failed to ensure marketing item approximate_cost schema", error);
  }
}

function normalizeApproximateCost(rawValue) {
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") {
    return "";
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "";
  }
  return String(Number(parsed.toFixed(2)));
}

async function ensureLocationGpsSchema() {
  if (locationGpsSchemaReady) return;
  try {
    await q(`
      ALTER TABLE public.marketing_locations
        ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION
    `);
    await q(`
      CREATE TABLE IF NOT EXISTS public.marketing_location_gps_logs (
        id BIGSERIAL PRIMARY KEY,
        location_id BIGINT NOT NULL REFERENCES public.marketing_locations(id) ON DELETE CASCADE,
        user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        source VARCHAR(50) NOT NULL DEFAULT 'selection',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await q(`
      CREATE INDEX IF NOT EXISTS idx_marketing_location_gps_logs_loc
        ON public.marketing_location_gps_logs(location_id, created_at DESC)
    `);
    locationGpsSchemaReady = true;
  } catch (error) {
    console.error("Failed to ensure location GPS schema", error);
  }
}

export function parseValidCoordinates(rawLat, rawLng) {
  if (rawLat === null || rawLat === undefined || rawLat === "") return null;
  if (rawLng === null || rawLng === undefined || rawLng === "") return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

export function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function recordLocationGpsSelection({
  locationId,
  userId = null,
  latitude = null,
  longitude = null,
  source = "selection",
  pinLocationCoordinates = false,
}) {
  const numericLocationId = Number(locationId);
  if (!Number.isInteger(numericLocationId) || numericLocationId <= 0) return;

  await ensureLocationGpsSchema();
  const coords = parseValidCoordinates(latitude, longitude);

  await q(
    `INSERT INTO public.marketing_location_gps_logs (location_id, user_id, latitude, longitude, source)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      numericLocationId,
      userId || null,
      coords ? coords.lat : null,
      coords ? coords.lng : null,
      String(source || "selection").slice(0, 50),
    ],
  );

  if (coords) {
    if (pinLocationCoordinates) {
      await q(
        `UPDATE public.marketing_locations
            SET latitude = $2,
                longitude = $3,
                updated_at = now()
          WHERE id = $1`,
        [numericLocationId, coords.lat, coords.lng],
      );
    } else {
      // Automatically populate or refine the location's coordinates from the
      // rolling centroid of GPS selections if explicit coordinates are not set.
      await q(
        `UPDATE public.marketing_locations l
            SET latitude = COALESCE(
                  l.latitude,
                  (
                    SELECT AVG(g.latitude)
                      FROM (
                        SELECT latitude
                          FROM public.marketing_location_gps_logs
                         WHERE location_id = $1
                           AND latitude IS NOT NULL
                           AND longitude IS NOT NULL
                         ORDER BY created_at DESC
                         LIMIT 25
                      ) g
                  ),
                  $2
                ),
                longitude = COALESCE(
                  l.longitude,
                  (
                    SELECT AVG(g.longitude)
                      FROM (
                        SELECT longitude
                          FROM public.marketing_location_gps_logs
                         WHERE location_id = $1
                           AND latitude IS NOT NULL
                           AND longitude IS NOT NULL
                         ORDER BY created_at DESC
                         LIMIT 25
                      ) g
                  ),
                  $3
                )
          WHERE l.id = $1`,
        [numericLocationId, coords.lat, coords.lng],
      );
    }
  }
}

const dateIST = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export function nextDayIST(baseDate = new Date()) {
  const todayText = dateIST(baseDate);
  const [year, month, day] = todayText.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return tomorrow.toISOString().slice(0, 10);
}

export async function listItems(req, res) {
  await ensureMarketingItemCostSchema();
  const result = await q(`${itemSelect} ORDER BY m.purchase_date DESC, m.id DESC`);
  res.json(result.rows);
}

export async function createItem(req, res) {
  await ensureMarketingItemCostSchema();
  const b = req.body || {};
  if (!String(b.itemName || "").trim() || !b.purchaseDate) {
    return res.status(400).json({ error: "Item name and purchase date are required" });
  }
  const approximateCost = normalizeApproximateCost(b.approximateCost ?? b.approximate_cost);
  const result = await q(
    `INSERT INTO public.marketing_list_items(category_id,item_id,item_name,quantity,unit_id,approximate_cost,purchase_date,location_id,created_by,updated_by)
     VALUES(NULLIF($1,'')::bigint,NULLIF($2,'')::bigint,$3,NULLIF($4,'')::numeric,NULLIF($5,'')::bigint,NULLIF($6,'')::numeric,$7,NULLIF($8,'')::bigint,$9,$9) RETURNING *`,
    [
      String(b.categoryId || ""),
      String(b.itemId || ""),
      String(b.itemName).trim(),
      String(b.quantity ?? ""),
      String(b.unitId || ""),
      approximateCost,
      b.purchaseDate,
      String(b.locationId || ""),
      req.user.id,
    ],
  );

  if (b.locationId) {
    void recordLocationGpsSelection({
      locationId: b.locationId,
      userId: req.user?.id,
      latitude: b.latitude ?? b.lat,
      longitude: b.longitude ?? b.lng,
      source: "marketing-item-create",
    }).catch(() => {});
  }

  res.status(201).json(result.rows[0]);
}

export async function updateItem(req, res) {
  await ensureMarketingItemCostSchema();
  const b = req.body || {};
  const existing = await q("SELECT status FROM public.marketing_list_items WHERE id=$1", [
    req.params.id,
  ]);
  if (!existing.rowCount) return res.status(404).json({ error: "Marketing item not found" });
  if (existing.rows[0].status !== "pending") {
    return res.status(409).json({ error: "Purchased or removed items are read-only" });
  }
  if (!String(b.itemName || "").trim() || !b.purchaseDate) {
    return res.status(400).json({ error: "Item name and purchase date are required" });
  }
  const approximateCost = normalizeApproximateCost(b.approximateCost ?? b.approximate_cost);
  const r = await q(
    `UPDATE public.marketing_list_items SET category_id=NULLIF($2,'')::bigint,item_id=NULLIF($3,'')::bigint,item_name=$4,quantity=NULLIF($5,'')::numeric,unit_id=NULLIF($6,'')::bigint,approximate_cost=NULLIF($7,'')::numeric,purchase_date=$8,location_id=NULLIF($9,'')::bigint,updated_by=$10,updated_at=now() WHERE id=$1 RETURNING *`,
    [
      req.params.id,
      String(b.categoryId || ""),
      String(b.itemId || ""),
      String(b.itemName).trim(),
      String(b.quantity ?? ""),
      String(b.unitId || ""),
      approximateCost,
      b.purchaseDate,
      String(b.locationId || ""),
      req.user.id,
    ],
  );

  if (b.locationId) {
    void recordLocationGpsSelection({
      locationId: b.locationId,
      userId: req.user?.id,
      latitude: b.latitude ?? b.lat,
      longitude: b.longitude ?? b.lng,
      source: "marketing-item-update",
    }).catch(() => {});
  }

  res.json(r.rows[0]);
}

export async function removeItem(req, res) {
  const result = await q(
    `DELETE FROM public.marketing_list_items
     WHERE id=$1 AND status='pending' RETURNING id`,
    [req.params.id],
  );
  if (!result.rowCount) {
    const existing = await q("SELECT status FROM public.marketing_list_items WHERE id=$1", [
      req.params.id,
    ]);
    if (!existing.rowCount) return res.status(404).json({ error: "Marketing item not found" });
    return res.status(409).json({
      error: "Purchased items cannot be deleted. Only pending items can be permanently deleted.",
    });
  }
  res.json({ ok: true, deleted: true, id: result.rows[0].id });
}

export async function markPurchased(req, res) {
  const b = req.body || {};
  const r = await q(
    `UPDATE public.marketing_list_items SET status='purchased',expense_id=$2,expense_price=$3,purchased_quantity=NULLIF($4,'')::numeric,purchased_unit_id=NULLIF($5,'')::bigint,updated_by=$6,updated_at=now() WHERE id=$1 AND status='pending' RETURNING *`,
    [
      req.params.id,
      b.expenseId,
      b.price,
      String(b.quantity ?? ""),
      String(b.unitId || ""),
      req.user.id,
    ],
  );
  if (!r.rowCount) {
    return res.status(409).json({ error: "Item is no longer pending or does not exist" });
  }
  res.json(r.rows[0]);
}

export async function markPurchasedBulk(req, res) {
  const b = req.body || {};
  const ids = [
    ...new Set(
      (Array.isArray(b.itemIds) ? b.itemIds : [])
        .map((id) => String(id))
        .filter((id) => /^\d+$/.test(id)),
    ),
  ];
  if (!ids.length || !b.expenseId) {
    return res.status(400).json({ error: "Item IDs and expense ID are required" });
  }
  const result = await q(
    `UPDATE public.marketing_list_items
     SET status='purchased', expense_id=$2, expense_price=$3,
         purchased_quantity=quantity, purchased_unit_id=unit_id,
         updated_by=$4, updated_at=now()
     WHERE id = ANY($1::bigint[]) AND status='pending'
       AND (SELECT COUNT(*) FROM public.marketing_list_items WHERE id = ANY($1::bigint[]) AND status='pending') = cardinality($1::bigint[])
     RETURNING id`,
    [ids, b.expenseId, Number(b.price || 0), req.user.id],
  );
  if (result.rowCount !== ids.length) {
    return res.status(409).json({
      error: "One or more selected items are no longer pending. Refresh the Marketing List and try again.",
    });
  }
  res.json({
    ok: true,
    purchasedCount: result.rowCount,
    itemIds: result.rows.map((row) => row.id),
  });
}

export async function listLocations(req, res) {
  await ensureLocationGpsSchema();
  const callerCoords = parseValidCoordinates(
    req.query?.lat ?? req.query?.latitude,
    req.query?.lng ?? req.query?.longitude,
  );
  const userId = req.user?.id || null;

  const r = await q(
    `SELECT l.id,
            l.name,
            l.address,
            COALESCE(l.latitude, gps_stats.avg_lat) AS latitude,
            COALESCE(l.longitude, gps_stats.avg_lng) AS longitude,
            (
              COALESCE(item_stats.total_items, 0) +
              COALESCE(chart_stats.total_charts, 0) +
              COALESCE(gps_stats.total_logs, 0)
            )::int AS usage_count,
            (
              COALESCE(item_stats.user_items, 0) +
              COALESCE(chart_stats.user_charts, 0) +
              COALESCE(gps_stats.user_logs, 0)
            )::int AS user_usage_count
       FROM public.marketing_locations l
       LEFT JOIN (
         SELECT location_id,
                COUNT(*)::int AS total_items,
                COUNT(*) FILTER (WHERE created_by = $1)::int AS user_items
           FROM public.marketing_list_items
          WHERE location_id IS NOT NULL
          GROUP BY location_id
       ) item_stats ON item_stats.location_id = l.id
       LEFT JOIN (
         SELECT location_id,
                COUNT(*)::int AS total_charts,
                COUNT(*) FILTER (WHERE user_id = $1)::int AS user_charts
           FROM public.food_chart_entries
          WHERE location_id IS NOT NULL
          GROUP BY location_id
       ) chart_stats ON chart_stats.location_id = l.id
       LEFT JOIN (
         SELECT location_id,
                COUNT(*)::int AS total_logs,
                COUNT(*) FILTER (WHERE user_id = $1)::int AS user_logs,
                AVG(latitude) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL) AS avg_lat,
                AVG(longitude) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL) AS avg_lng
           FROM public.marketing_location_gps_logs
          GROUP BY location_id
       ) gps_stats ON gps_stats.location_id = l.id
      ORDER BY l.name`,
    [userId],
  );

  let nearbyCountsByLocation = new Map();
  if (callerCoords) {
    // Count historical GPS selections within ~1.5 km of the caller's current GPS position
    const recentGpsLogs = await q(
      `SELECT location_id, latitude, longitude
         FROM public.marketing_location_gps_logs
        WHERE latitude IS NOT NULL
          AND longitude IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 500`,
    );
    for (const log of recentGpsLogs.rows) {
      const distKm = haversineDistanceKm(
        callerCoords.lat,
        callerCoords.lng,
        Number(log.latitude),
        Number(log.longitude),
      );
      if (Number.isFinite(distKm) && distKm <= 1.5) {
        const key = String(log.location_id);
        nearbyCountsByLocation.set(key, (nearbyCountsByLocation.get(key) || 0) + 1);
      }
    }
  }

  const enriched = r.rows.map((row) => {
    const locCoords = parseValidCoordinates(row.latitude, row.longitude);
    const distanceKm =
      callerCoords && locCoords
        ? Number(
            haversineDistanceKm(
              callerCoords.lat,
              callerCoords.lng,
              locCoords.lat,
              locCoords.lng,
            ).toFixed(3),
          )
        : null;
    const nearbyUsageCount = nearbyCountsByLocation.get(String(row.id)) || 0;
    return {
      ...row,
      latitude: locCoords ? Number(locCoords.lat.toFixed(6)) : null,
      longitude: locCoords ? Number(locCoords.lng.toFixed(6)) : null,
      usage_count: Number(row.usage_count || 0),
      user_usage_count: Number(row.user_usage_count || 0),
      nearby_usage_count: nearbyUsageCount,
      distance_km: distanceKm,
    };
  });

  // Determine nearest location and most frequent location
  let nearestId = null;
  let minDistanceKm = Infinity;
  let mostFrequentId = null;
  let maxUsageScore = -1;

  for (const loc of enriched) {
    if (loc.distance_km !== null && loc.distance_km < minDistanceKm) {
      minDistanceKm = loc.distance_km;
      nearestId = loc.id;
    }
    const usageScore = loc.user_usage_count * 2 + loc.usage_count;
    if (usageScore > maxUsageScore) {
      maxUsageScore = usageScore;
      mostFrequentId = loc.id;
    }
  }

  // Score each location combining:
  // 1) Selections made near current GPS (within 1.5 km)
  // 2) Proximity to current GPS (nearest GPS location)
  // 3) Overall selection frequency (user + global usage count)
  let bestLocationId = null;
  let bestScore = -Infinity;

  for (const loc of enriched) {
    let score = loc.user_usage_count * 3 + loc.usage_count;
    if (callerCoords) {
      if (loc.nearby_usage_count > 0) {
        score += 1000 + loc.nearby_usage_count * 50;
      }
      if (loc.distance_km !== null) {
        if (loc.distance_km <= 0.5) {
          score += 900 - loc.distance_km * 200;
        } else if (loc.distance_km <= 2.0) {
          score += 600 - loc.distance_km * 150;
        } else if (loc.distance_km <= 10.0) {
          score += Math.max(50, 300 - loc.distance_km * 25);
        } else {
          score += Math.max(0, 50 - loc.distance_km);
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestLocationId = loc.id;
    }
  }

  const finalRows = enriched.map((loc) => ({
    ...loc,
    is_nearest: nearestId !== null && String(loc.id) === String(nearestId),
    is_most_frequent:
      maxUsageScore > 0 && mostFrequentId !== null && String(loc.id) === String(mostFrequentId),
    auto_recommended: bestLocationId !== null && String(loc.id) === String(bestLocationId),
  }));

  res.json(finalRows);
}

export async function createLocation(req, res) {
  await ensureLocationGpsSchema();
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Location name is required" });
  const coords = parseValidCoordinates(
    req.body?.latitude ?? req.body?.lat,
    req.body?.longitude ?? req.body?.lng,
  );
  const r = await q(
    "INSERT INTO public.marketing_locations(name,address,latitude,longitude,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [
      name,
      String(req.body?.address || "").trim() || null,
      coords ? coords.lat : null,
      coords ? coords.lng : null,
      req.user.id,
    ],
  );
  if (coords && r.rows[0]?.id) {
    void recordLocationGpsSelection({
      locationId: r.rows[0].id,
      userId: req.user?.id,
      latitude: coords.lat,
      longitude: coords.lng,
      source: "location-create",
      pinLocationCoordinates: true,
    }).catch(() => {});
  }
  res.status(201).json(r.rows[0]);
}

export async function updateLocation(req, res) {
  await ensureLocationGpsSchema();
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Location name is required" });
  const coords = parseValidCoordinates(
    req.body?.latitude ?? req.body?.lat,
    req.body?.longitude ?? req.body?.lng,
  );
  const clearCoordinates = req.body?.clearCoordinates === true;

  const r = await q(
    `UPDATE public.marketing_locations
        SET name = $2,
            address = $3,
            latitude = CASE WHEN $6::boolean THEN NULL ELSE COALESCE($4::double precision, latitude) END,
            longitude = CASE WHEN $6::boolean THEN NULL ELSE COALESCE($5::double precision, longitude) END,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      req.params.id,
      name,
      String(req.body?.address || "").trim() || null,
      coords ? coords.lat : null,
      coords ? coords.lng : null,
      clearCoordinates,
    ],
  );
  if (!r.rowCount) return res.status(404).json({ error: "Location not found" });

  if (coords) {
    void recordLocationGpsSelection({
      locationId: req.params.id,
      userId: req.user?.id,
      latitude: coords.lat,
      longitude: coords.lng,
      source: "location-update",
      pinLocationCoordinates: true,
    }).catch(() => {});
  }

  res.json(r.rows[0]);
}

export async function trackLocationSelection(req, res) {
  const b = req.body || {};
  const locationId = Number(b.locationId);
  if (!Number.isInteger(locationId) || locationId <= 0) {
    return res.status(400).json({ error: "Valid locationId is required" });
  }
  await recordLocationGpsSelection({
    locationId,
    userId: req.user?.id,
    latitude: b.latitude ?? b.lat,
    longitude: b.longitude ?? b.lng,
    source: b.source || "selection",
    pinLocationCoordinates: Boolean(b.pinLocationCoordinates),
  });
  res.json({ ok: true, locationId });
}

export async function deleteLocation(req, res) {
  const r = await q("DELETE FROM public.marketing_locations WHERE id=$1", [req.params.id]);
  res.json({ ok: true, deleted: r.rowCount });
}

export async function sendMarketingListForDate(purchaseDate = nextDayIST()) {
  await ensureMarketingItemCostSchema();
  const items = (
    await q(
      `${itemSelect} WHERE m.status='pending' AND m.purchase_date=$1::date ORDER BY c.name,m.item_name`,
      [purchaseDate],
    )
  ).rows;

  if (!items.length) {
    return {
      skipped: true,
      reason: "No items scheduled for this date",
      date: purchaseDate,
      rows: 0,
      recipients: 0,
    };
  }

  const recipients = (
    await q(
      `SELECT email
         FROM public.users u
         JOIN public.roles r ON r.id=u.role_id
        WHERE r.name IN ('manager','admin')
          AND u.is_disabled=false
        ORDER BY CASE WHEN r.name='manager' THEN 1 ELSE 2 END, u.email`,
    )
  ).rows;

  for (const recipient of recipients) {
    await sendMarketingListEmail(recipient.email, purchaseDate, items);
  }

  return {
    skipped: false,
    reason: `recipients=${recipients.length}; items=${items.length}; date=${purchaseDate}`,
    date: purchaseDate,
    rows: items.length,
    recipients: recipients.length,
  };
}

export async function sendScheduledEmail(req, res) {
  const expected = String(env.marketingListCronSecret || "");
  const supplied = String(req.headers["x-marketing-cron-secret"] || "");
  if (
    !expected ||
    !supplied ||
    expected.length !== supplied.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  ) {
    return res.status(401).json({ error: "Invalid cron secret" });
  }

  const purchaseDate = String(req.body?.date || nextDayIST());
  const key = `marketing-list-email:${purchaseDate}`;
  const started = Date.now();

  const claim = await q(
    `INSERT INTO public.scheduler_job_executions(job_name,scheduled_key,status,started_at)
     VALUES('marketing-list-email',$1,'running',now())
     ON CONFLICT (job_name,scheduled_key) WHERE scheduled_key IS NOT NULL
     DO UPDATE SET status='running',started_at=now(),completed_at=NULL,duration_ms=NULL,error_message=NULL
     WHERE public.scheduler_job_executions.status='failed'
        OR (public.scheduler_job_executions.status='running' AND public.scheduler_job_executions.started_at < now() - INTERVAL '5 minutes')
     RETURNING id`,
    [key],
  );

  if (!claim.rowCount) return res.json({ ok: true, duplicate: true, date: purchaseDate });

  try {
    const result = await sendMarketingListForDate(purchaseDate);
    if (result.skipped) {
      await q(
        "UPDATE public.scheduler_job_executions SET status='skipped',completed_at=now(),duration_ms=$2,error_message=$3 WHERE id=$1",
        [claim.rows[0].id, Date.now() - started, result.reason],
      );
      return res.json({
        ok: true,
        status: "skipped",
        reason: "no-items",
        date: purchaseDate,
        itemCount: 0,
        recipientCount: 0,
      });
    }

    await q(
      "UPDATE public.scheduler_job_executions SET status='completed',completed_at=now(),duration_ms=$2,error_message=$3 WHERE id=$1",
      [claim.rows[0].id, Date.now() - started, result.reason],
    );
    res.json({
      ok: true,
      status: "completed",
      date: purchaseDate,
      itemCount: result.rows,
      recipientCount: result.recipients,
    });
  } catch (error) {
    await q(
      "UPDATE public.scheduler_job_executions SET status='failed',completed_at=now(),duration_ms=$2,error_message=$3 WHERE id=$1",
      [claim.rows[0].id, Date.now() - started, String(error?.message || error).slice(0, 2000)],
    );
    throw error;
  }
}