import { readFileSync } from "node:fs";
import { q } from "../db/index.js";
import { recordLocationGpsSelection } from "./marketingController.js";

// The recipe catalogue is version-controlled project data. Update recipes.json and redeploy to change it.
const staticRecipes = JSON.parse(
  readFileSync(new URL("../data/recipes.json", import.meta.url), "utf8"),
);
const staticRecipesById = new Map(staticRecipes.map((r) => [String(r.id), r]));
const staticRecipesLowerNames = staticRecipes.map((r) =>
  String(r.name || "")
    .trim()
    .toLowerCase(),
);
const staticRecipesByName = new Map(
  staticRecipes.map((r, idx) => [staticRecipesLowerNames[idx], r]),
);
const STATIC_RECIPES_VERSION = `${staticRecipes.length}-${staticRecipes[staticRecipes.length - 1]?.id || "0"}`;

function normalizeRecipeSnapshot(snapshot, recipeId = null) {
  let parsed = snapshot;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  if (parsed && typeof parsed === "object" && parsed.name) {
    const fallback =
      (parsed.id && staticRecipesById.get(String(parsed.id))) ||
      staticRecipesByName.get(
        String(parsed.name || "")
          .trim()
          .toLowerCase(),
      ) ||
      null;
    if (fallback) {
      return {
        ...fallback,
        ...parsed,
        ingredients:
          Array.isArray(parsed.ingredients) && parsed.ingredients.length
            ? parsed.ingredients
            : fallback.ingredients || [],
        steps:
          Array.isArray(parsed.steps) && parsed.steps.length ? parsed.steps : fallback.steps || [],
      };
    }
    return parsed;
  }
  if (recipeId && staticRecipesById.has(String(recipeId))) {
    return staticRecipesById.get(String(recipeId));
  }
  return (
    parsed || { name: "Recipe", category: "Other", region: "Indian", ingredients: [], steps: [] }
  );
}

export async function listRecipes(req, res) {
  res.set("Cache-Control", "private, no-cache");
  try {
    const userId = req.user?.id || null;
    const usageResult = await q(
      `SELECT COALESCE(recipe_snapshot->>'id', '') AS recipe_id,
              LOWER(COALESCE(recipe_snapshot->>'name', '')) AS recipe_name,
              COUNT(*)::int AS total_count,
              COUNT(*) FILTER (WHERE user_id = $1)::int AS user_count
         FROM public.food_chart_entries
        GROUP BY COALESCE(recipe_snapshot->>'id', ''), LOWER(COALESCE(recipe_snapshot->>'name', ''))`,
      [userId],
    );

    let signatureHash = 0;
    const byId = new Map();
    const byName = new Map();

    for (const row of usageResult.rows) {
      const total = Number(row.total_count || 0);
      const userCount = Number(row.user_count || 0);
      const sig = `${row.recipe_id}|${row.recipe_name}|${total}|${userCount}`;
      for (let i = 0; i < sig.length; i += 1) {
        signatureHash = ((signatureHash << 5) - signatureHash + sig.charCodeAt(i)) | 0;
      }
      if (row.recipe_id) {
        const prev = byId.get(row.recipe_id) || { total: 0, user: 0 };
        byId.set(row.recipe_id, { total: prev.total + total, user: prev.user + userCount });
      }
      if (row.recipe_name) {
        const prev = byName.get(row.recipe_name) || { total: 0, user: 0 };
        byName.set(row.recipe_name, { total: prev.total + total, user: prev.user + userCount });
      }
    }

    const etag = `W/"recipes-${STATIC_RECIPES_VERSION}-${userId || "anon"}-${usageResult.rows.length}-${signatureHash >>> 0}"`;
    res.set("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    const used = [];
    const unused = [];

    for (let i = 0; i < staticRecipes.length; i += 1) {
      const recipe = staticRecipes[i];
      const idStats = byId.get(String(recipe.id)) || { total: 0, user: 0 };
      const nameStats = byName.get(staticRecipesLowerNames[i]) || { total: 0, user: 0 };
      const usageCount = Math.max(idStats.total, nameStats.total);
      const userUsageCount = Math.max(idStats.user, nameStats.user);
      const item = {
        ...recipe,
        usageCount,
        userUsageCount,
      };
      if (usageCount > 0 || userUsageCount > 0) {
        used.push(item);
      } else {
        unused.push(item);
      }
    }

    if (used.length > 1) {
      used.sort((a, b) => {
        if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
        if (b.userUsageCount !== a.userUsageCount) return b.userUsageCount - a.userUsageCount;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
    }

    return res.json(used.length ? [...used, ...unused] : unused);
  } catch {
    return res.json(staticRecipes);
  }
}

const readOnlyRecipeResponse = (_req, res) =>
  res.status(405).json({
    error:
      "The recipe catalogue is read-only. Update backend/src/data/recipes.json and redeploy to change recipes.",
  });
export const createRecipe = readOnlyRecipeResponse;
export const updateRecipe = readOnlyRecipeResponse;
export const deleteRecipe = readOnlyRecipeResponse;

export async function listFoodChart(req, res) {
  res.set("Cache-Control", "private, no-cache");
  const date = String(req.query.date || "").slice(0, 10);
  const locationId = String(req.query.locationId || "").trim();
  const strictLocation = String(req.query.strictLocation || "") === "true";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "A valid chart date is required" });
  }

  const orderClause = `ORDER BY CASE meal
                 WHEN 'Breakfast' THEN 1
                 WHEN 'Lunch' THEN 2
                 WHEN 'Evening Snacks' THEN 3
                 ELSE 4
               END,
               sort_order,
               id`;

  let result = await q(
    `SELECT id,
            chart_date::text AS date,
            meal,
            location_id AS "locationId",
            recipe_id AS "recipeId",
            recipe_snapshot AS recipe,
            servings,
            sort_order AS "sortOrder"
       FROM public.food_chart_entries
      WHERE chart_date = $1::date
        AND ($2 = '' OR location_id = NULLIF($2, '')::bigint OR location_id IS NULL)
      ${orderClause}`,
    [date, locationId],
  );

  // If the client auto-selected a different default location on Android vs Web
  // and that location has no entries for this date, fall back to showing all
  // planned entries for the date unless strictLocation=true was explicitly passed.
  if (!result.rows.length && locationId && !strictLocation) {
    result = await q(
      `SELECT id,
              chart_date::text AS date,
              meal,
              location_id AS "locationId",
              recipe_id AS "recipeId",
              recipe_snapshot AS recipe,
              servings,
              sort_order AS "sortOrder"
         FROM public.food_chart_entries
        WHERE chart_date = $1::date
        ${orderClause}`,
      [date],
    );
  }

  const rows = result.rows.map((row) => ({
    ...row,
    recipe: normalizeRecipeSnapshot(row.recipe, row.recipeId),
  }));

  res.json(rows);
}

export async function addFoodChartEntry(req, res) {
  const b = req.body || {};
  const date = String(b.date || "").slice(0, 10);
  const meal = String(b.meal || "");
  const locationId = /^\d+$/.test(String(b.locationId || "").trim())
    ? String(b.locationId).trim()
    : "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !["Breakfast", "Lunch", "Evening Snacks", "Dinner"].includes(meal) ||
    !b.recipeId
  ) {
    return res.status(400).json({ error: "Date, meal and recipe are required" });
  }
  const snapshot = staticRecipes.find((recipe) => String(recipe.id) === String(b.recipeId));
  if (!snapshot) {
    return res.status(404).json({ error: "Recipe not found in the static catalogue" });
  }

  // Validate that no duplicate recipe is entered for the same date, meal timing, and location
  const numericRecipeId = /^\d+$/.test(String(b.recipeId || "").trim())
    ? String(b.recipeId).trim()
    : null;
  const duplicateCheck = await q(
    `SELECT id, recipe_snapshot->>'name' AS name
       FROM public.food_chart_entries
      WHERE chart_date = $1::date
        AND meal = $2
        AND location_id IS NOT DISTINCT FROM NULLIF($3, '')::bigint
        AND (
          recipe_snapshot->>'id' = $4
          OR LOWER(TRIM(recipe_snapshot->>'name')) = LOWER(TRIM($5))
          OR ($6::bigint IS NOT NULL AND recipe_id = $6::bigint)
        )
      LIMIT 1`,
    [date, meal, locationId, String(snapshot.id), String(snapshot.name), numericRecipeId],
  );

  if (duplicateCheck.rowCount > 0) {
    return res.status(409).json({
      error: `"${snapshot.name}" is already scheduled for ${meal} on this date and location. Duplicate recipes are not allowed for the same timing.`,
    });
  }

  const servings = Math.max(0.25, Number(b.servings) || Number(snapshot.servings) || 2);
  const order = await q(
    "SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM public.food_chart_entries WHERE chart_date=$1::date AND meal=$2",
    [date, meal],
  );
  const result = await q(
    `INSERT INTO public.food_chart_entries(user_id,chart_date,meal,location_id,recipe_id,recipe_snapshot,servings,sort_order)
     VALUES($1,$2::date,$3,NULLIF($4,'')::bigint,NULL,$5::jsonb,$6,$7)
     RETURNING id,chart_date::text AS date,meal,location_id AS "locationId",recipe_id AS "recipeId",recipe_snapshot AS recipe,servings,sort_order AS "sortOrder"`,
    [req.user.id, date, meal, locationId, JSON.stringify(snapshot), servings, order.rows[0].n],
  );

  if (locationId) {
    void recordLocationGpsSelection({
      locationId,
      userId: req.user?.id,
      latitude: b.latitude ?? b.lat,
      longitude: b.longitude ?? b.lng,
      source: "food-chart-add",
    }).catch(() => {});
  }

  const row = result.rows[0];
  res.status(201).json({
    ...row,
    recipe: normalizeRecipeSnapshot(row.recipe, row.recipeId),
  });
}

export async function updateFoodChartEntry(req, res) {
  const servings = Math.max(0.25, Number(req.body?.servings) || 0);
  if (!servings) return res.status(400).json({ error: "A valid serving quantity is required" });
  const result = await q(
    `UPDATE public.food_chart_entries
        SET servings = $2
      WHERE id = $1
      RETURNING id,chart_date::text AS date,meal,location_id AS "locationId",recipe_id AS "recipeId",recipe_snapshot AS recipe,servings,sort_order AS "sortOrder"`,
    [req.params.id, servings],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Food chart entry not found" });
  const row = result.rows[0];
  res.json({
    ...row,
    recipe: normalizeRecipeSnapshot(row.recipe, row.recipeId),
  });
}

export async function removeFoodChartEntry(req, res) {
  const result = await q("DELETE FROM public.food_chart_entries WHERE id=$1 RETURNING id", [
    req.params.id,
  ]);
  if (!result.rowCount) return res.status(404).json({ error: "Food chart entry not found" });
  res.json({ ok: true, id: result.rows[0].id });
}

export async function resetFoodChartEntries(req, res) {
  const date = String(req.query?.date ?? req.body?.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "A valid date (YYYY-MM-DD) is required" });
  }
  const rawLocationId = String(req.query?.locationId ?? req.body?.locationId ?? "").trim();
  const locationId = /^\d+$/.test(rawLocationId) ? rawLocationId : "";
  const meals = ["Breakfast", "Lunch", "Evening Snacks", "Dinner"];

  const result = locationId
    ? await q(
        `DELETE FROM public.food_chart_entries
          WHERE chart_date = $1::date
            AND meal = ANY($2::text[])
            AND (location_id = $3::bigint OR location_id IS NULL)
          RETURNING id`,
        [date, meals, locationId],
      )
    : await q(
        `DELETE FROM public.food_chart_entries
          WHERE chart_date = $1::date
            AND meal = ANY($2::text[])
          RETURNING id`,
        [date, meals],
      );

  res.json({ ok: true, deletedCount: result.rowCount });
}

export async function getRecipeMasterPreferences(req, res) {
  res.set("Cache-Control", "private, no-cache");
  const userId = req.user?.id;
  if (!userId) {
    return res.json({ searchText: "", selectedIngredients: [], category: "All" });
  }
  try {
    const result = await q(
      `SELECT search_text, selected_ingredients, category
         FROM public.recipe_master_user_preferences
        WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return res.json({
      searchText: String(row?.search_text || ""),
      selectedIngredients: Array.isArray(row?.selected_ingredients)
        ? row.selected_ingredients.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
      category: String(row?.category || "All") || "All",
    });
  } catch {
    return res.json({ searchText: "", selectedIngredients: [], category: "All" });
  }
}

export async function saveRecipeMasterPreferences(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const searchText = String(req.body?.searchText || "").slice(0, 200);
  const selectedIngredients = Array.isArray(req.body?.selectedIngredients)
    ? req.body.selectedIngredients
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];
  const category = String(req.body?.category || "All").trim().slice(0, 100) || "All";

  await q(
    `INSERT INTO public.recipe_master_user_preferences
       (user_id, search_text, selected_ingredients, category, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, now())
     ON CONFLICT (user_id) DO UPDATE
       SET search_text = EXCLUDED.search_text,
           selected_ingredients = EXCLUDED.selected_ingredients,
           category = EXCLUDED.category,
           updated_at = now()`,
    [userId, searchText, JSON.stringify(selectedIngredients), category],
  );

  return res.json({ searchText, selectedIngredients, category });
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MEAL_ORDER = ["Breakfast", "Lunch", "Evening Snacks", "Dinner"];

export async function autoAddFoodChartRecipes(req, res) {
  const b = req.body || {};
  const date = String(b.date || "").slice(0, 10);
  const locationId = /^\d+$/.test(String(b.locationId || "").trim())
    ? String(b.locationId).trim()
    : "";
  const minCount = Math.max(1, Number.parseInt(b.minCount, 10) || 5);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "A valid chart date is required" });
  }

  const parsedDate = new Date(`${date}T00:00:00Z`);
  const weekdayName = WEEKDAY_NAMES[parsedDate.getUTCDay()] || "this weekday";

  // Check which meals already have at least one recipe on this date & location
  const existingRes = await q(
    `SELECT DISTINCT meal
       FROM public.food_chart_entries
      WHERE chart_date = $1::date
        AND ($2 = '' OR location_id = NULLIF($2, '')::bigint OR location_id IS NULL)`,
    [date, locationId],
  );
  const existingMeals = new Set((existingRes.rows || []).map((r) => r.meal));

  const added = [];
  const skippedExisting = [];
  const noHistory = [];

  for (const meal of MEAL_ORDER) {
    if (existingMeals.has(meal)) {
      skippedExisting.push(meal);
      continue;
    }

    const histRes = await q(
      `SELECT COALESCE(recipe_snapshot->>'id', '') AS snap_id,
              LOWER(TRIM(COALESCE(recipe_snapshot->>'name', ''))) AS snap_name_lower,
              COUNT(*)::int AS total_count,
              COUNT(*) FILTER (
                WHERE $3 <> '' AND location_id = NULLIF($3, '')::bigint
              )::int AS loc_count,
              ROUND(AVG(servings)::numeric, 2) AS avg_servings,
              (ARRAY_AGG(recipe_snapshot ORDER BY chart_date DESC, id DESC))[1] AS latest_snapshot
         FROM public.food_chart_entries
        WHERE EXTRACT(DOW FROM chart_date::date) = EXTRACT(DOW FROM $1::date)
          AND meal = $2
          AND chart_date <> $1::date
          AND COALESCE(recipe_snapshot->>'name', '') <> ''
        GROUP BY COALESCE(recipe_snapshot->>'id', ''),
                 LOWER(TRIM(COALESCE(recipe_snapshot->>'name', '')))
       HAVING COUNT(*) >= $4
        ORDER BY
          CASE
            WHEN ($3 <> '' AND COUNT(*) FILTER (WHERE location_id = NULLIF($3, '')::bigint) >= $4)
              THEN 0
            ELSE 1
          END ASC,
          COUNT(*) FILTER (WHERE $3 <> '' AND location_id = NULLIF($3, '')::bigint) DESC,
          COUNT(*) DESC,
          MAX(chart_date) DESC
        LIMIT 1`,
      [date, meal, locationId, minCount],
    );

    const best = histRes.rows[0];
    if (!best) {
      noHistory.push(meal);
      continue;
    }

    const canonicalSnapshot =
      (best.snap_id && staticRecipesById.get(String(best.snap_id))) ||
      (best.snap_name_lower && staticRecipesByName.get(best.snap_name_lower)) ||
      normalizeRecipeSnapshot(best.latest_snapshot, null);

    if (!canonicalSnapshot || !canonicalSnapshot.name) {
      noHistory.push(meal);
      continue;
    }

    const servings = Math.max(
      0.25,
      Number(best.avg_servings) || Number(canonicalSnapshot.servings) || 2,
    );
    const orderRes = await q(
      "SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM public.food_chart_entries WHERE chart_date=$1::date AND meal=$2",
      [date, meal],
    );

    await q(
      `INSERT INTO public.food_chart_entries(user_id,chart_date,meal,location_id,recipe_id,recipe_snapshot,servings,sort_order)
       VALUES($1,$2::date,$3,NULLIF($4,'')::bigint,NULL,$5::jsonb,$6,$7)`,
      [
        req.user.id,
        date,
        meal,
        locationId,
        JSON.stringify(canonicalSnapshot),
        servings,
        orderRes.rows[0].n,
      ],
    );

    added.push({
      meal,
      recipeName: canonicalSnapshot.name,
      count: Number(best.loc_count >= minCount ? best.loc_count : best.total_count),
      totalCount: Number(best.total_count),
      servings,
    });
  }

  if (locationId) {
    void recordLocationGpsSelection({
      locationId,
      userId: req.user?.id,
      latitude: b.latitude ?? b.lat,
      longitude: b.longitude ?? b.lng,
      source: "food_chart_auto_add",
    });
  }

  return res.json({
    date,
    weekdayName,
    minCount,
    added,
    skippedExisting,
    noHistory,
  });
}
