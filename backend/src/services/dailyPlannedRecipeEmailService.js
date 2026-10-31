import { readFileSync } from "node:fs";
import { q } from "../db/index.js";
import { sendDailyPlannedRecipeEmail } from "./mailService.js";

const MEALS = ["Breakfast", "Lunch", "Evening Snacks", "Dinner"];

const staticRecipes = JSON.parse(
  readFileSync(new URL("../data/recipes.json", import.meta.url), "utf8"),
);
const staticRecipesById = new Map(staticRecipes.map((r) => [String(r.id), r]));
const staticRecipesByName = new Map(
  staticRecipes.map((r) => [String(r.name || "").trim().toLowerCase(), r]),
);

function normalizeRecipeSnapshot(snapshot, recipeId = null) {
  let parsed = snapshot;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  if (parsed && typeof parsed === "object" && (parsed.name || parsed.title)) {
    const fallback =
      (parsed.id && staticRecipesById.get(String(parsed.id))) ||
      staticRecipesByName.get(String(parsed.name || parsed.title || "").trim().toLowerCase()) ||
      null;
    if (fallback) {
      return {
        ...fallback,
        ...parsed,
      };
    }
    return parsed;
  }
  if (recipeId && staticRecipesById.has(String(recipeId))) {
    return staticRecipesById.get(String(recipeId));
  }
  return parsed || { name: "Recipe", category: "" };
}

function dateLabel(value) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function sendDailyPlannedRecipeEmailToAdmins(planDate) {
  const admins = await q(
    `SELECT u.id, u.full_name, u.email
       FROM public.users u
       JOIN public.roles r ON r.id = u.role_id
      WHERE lower(r.name) = 'admin' AND u.is_disabled = FALSE
      ORDER BY u.id`,
  );

  if (!admins.rows.length) {
    throw new Error("No active administrator account was found for the daily planned recipe email");
  }

  const result = await q(
    `SELECT f.id,
            f.meal,
            f.servings,
            f.sort_order AS "sortOrder",
            f.recipe_id AS "recipeId",
            f.recipe_snapshot AS recipe,
            COALESCE(l.name, 'Unspecified location') AS "locationName"
       FROM public.food_chart_entries f
       LEFT JOIN public.marketing_locations l ON l.id = f.location_id
      WHERE f.chart_date = $1::date
      ORDER BY CASE f.meal
                 WHEN 'Breakfast' THEN 1
                 WHEN 'Lunch' THEN 2
                 WHEN 'Evening Snacks' THEN 3
                 WHEN 'Dinner' THEN 4
                 ELSE 5
               END,
               f.sort_order,
               f.id`,
    [planDate],
  );

  if (!result.rows.length) {
    return {
      skipped: true,
      reason: "No planned recipes found for the day; no email sent",
      recipients: 0,
      rows: 0,
      planDate,
    };
  }

  const sections = MEALS.map((meal) => ({
    meal,
    recipes: result.rows
      .filter((row) => String(row.meal || "").trim().toLowerCase() === meal.toLowerCase())
      .map((row) => {
        const resolved = normalizeRecipeSnapshot(row.recipe, row.recipeId);
        return {
          name: resolved?.name || resolved?.title || "Recipe",
          category: resolved?.category || "",
          location: row.locationName,
          servings: Number(row.servings || resolved?.servings || 2),
        };
      }),
  }));

  let recipients = 0;
  let recipeCount = 0;
  for (const admin of admins.rows) {
    await sendDailyPlannedRecipeEmail(admin.email, dateLabel(planDate), sections);
    recipients += 1;
    recipeCount += result.rows.length;
  }

  return { recipients, rows: recipeCount, planDate };
}
