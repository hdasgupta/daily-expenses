import { readFileSync } from "node:fs";
import { q } from "../db/index.js";
import { recordLocationGpsSelection } from "./marketingController.js";

// The recipe catalogue is version-controlled project data. Update recipes.json and redeploy to change it.
const staticRecipes = JSON.parse(readFileSync(new URL("../data/recipes.json", import.meta.url), "utf8"));

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

    const byId = new Map();
    const byName = new Map();

    for (const row of usageResult.rows) {
      const total = Number(row.total_count || 0);
      const userCount = Number(row.user_count || 0);
      if (row.recipe_id) {
        const prev = byId.get(row.recipe_id) || { total: 0, user: 0 };
        byId.set(row.recipe_id, { total: prev.total + total, user: prev.user + userCount });
      }
      if (row.recipe_name) {
        const prev = byName.get(row.recipe_name) || { total: 0, user: 0 };
        byName.set(row.recipe_name, { total: prev.total + total, user: prev.user + userCount });
      }
    }

    const enriched = staticRecipes.map((recipe) => {
      const idStats = byId.get(String(recipe.id)) || { total: 0, user: 0 };
      const nameStats = byName.get(String(recipe.name || "").trim().toLowerCase()) || { total: 0, user: 0 };
      const usageCount = Math.max(idStats.total, nameStats.total);
      const userUsageCount = Math.max(idStats.user, nameStats.user);
      return {
        ...recipe,
        usageCount,
        userUsageCount,
      };
    });

    enriched.sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      if (b.userUsageCount !== a.userUsageCount) return b.userUsageCount - a.userUsageCount;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    return res.json(enriched);
  } catch {
    return res.json(staticRecipes);
  }
}

const readOnlyRecipeResponse = (_req, res) => res.status(405).json({
  error: "The recipe catalogue is read-only. Update backend/src/data/recipes.json and redeploy to change recipes.",
});
export const createRecipe = readOnlyRecipeResponse;
export const updateRecipe = readOnlyRecipeResponse;
export const deleteRecipe = readOnlyRecipeResponse;

export async function listFoodChart(req, res) {
  const date = String(req.query.date || "").slice(0, 10);
  const locationId = String(req.query.locationId || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "A valid chart date is required" });
  }
  const result = await q(
    `SELECT id,
            chart_date AS date,
            meal,
            location_id AS "locationId",
            recipe_id AS "recipeId",
            recipe_snapshot AS recipe,
            servings,
            sort_order AS "sortOrder"
       FROM public.food_chart_entries
      WHERE user_id = $1
        AND chart_date = $2::date
        AND ($3 = '' OR location_id = NULLIF($3, '')::bigint OR location_id IS NULL)
      ORDER BY CASE meal
                 WHEN 'Breakfast' THEN 1
                 WHEN 'Lunch' THEN 2
                 WHEN 'Evening Snacks' THEN 3
                 ELSE 4
               END,
               sort_order,
               id`,
    [req.user.id, date, locationId],
  );
  res.json(result.rows);
}

export async function addFoodChartEntry(req, res) {
  const b = req.body || {};
  const date = String(b.date || "").slice(0, 10);
  const meal = String(b.meal || "");
  const locationId = String(b.locationId || "").trim();
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
  const servings = Math.max(0.25, Number(b.servings) || Number(snapshot.servings) || 2);
  const order = await q(
    "SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM public.food_chart_entries WHERE user_id=$1 AND chart_date=$2::date AND meal=$3",
    [req.user.id, date, meal],
  );
  const result = await q(
    `INSERT INTO public.food_chart_entries(user_id,chart_date,meal,location_id,recipe_id,recipe_snapshot,servings,sort_order)
     VALUES($1,$2::date,$3,NULLIF($4,'')::bigint,NULL,$5::jsonb,$6,$7)
     RETURNING id,chart_date AS date,meal,location_id AS "locationId",recipe_id AS "recipeId",recipe_snapshot AS recipe,servings,sort_order AS "sortOrder"`,
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

  res.status(201).json(result.rows[0]);
}

export async function updateFoodChartEntry(req, res) {
  const servings = Math.max(0.25, Number(req.body?.servings) || 0);
  if (!servings) return res.status(400).json({ error: "A valid serving quantity is required" });
  const result = await q(
    `UPDATE public.food_chart_entries
        SET servings = $3
      WHERE id = $1 AND user_id = $2
      RETURNING id,chart_date AS date,meal,location_id AS "locationId",recipe_id AS "recipeId",recipe_snapshot AS recipe,servings,sort_order AS "sortOrder"`,
    [req.params.id, req.user.id, servings],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Food chart entry not found" });
  res.json(result.rows[0]);
}

export async function removeFoodChartEntry(req, res) {
  const result = await q(
    "DELETE FROM public.food_chart_entries WHERE id=$1 AND user_id=$2 RETURNING id",
    [req.params.id, req.user.id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Food chart entry not found" });
  res.json({ ok: true, id: result.rows[0].id });
}