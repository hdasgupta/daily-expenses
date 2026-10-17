import { q } from "../db/index.js";
import { sendDailyPlannedRecipeEmail } from "./mailService.js";

const MEALS = ["Breakfast", "Lunch", "Evening Snacks", "Dinner"];

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

  let recipients = 0;
  let recipeCount = 0;
  for (const admin of admins.rows) {
    const result = await q(
      `SELECT f.meal,
              f.servings,
              f.sort_order AS "sortOrder",
              f.recipe_snapshot AS recipe,
              COALESCE(l.name, 'Unspecified location') AS "locationName"
         FROM public.food_chart_entries f
         LEFT JOIN public.marketing_locations l ON l.id = f.location_id
        WHERE f.user_id = $1 AND f.chart_date = $2::date
        ORDER BY CASE f.meal
                   WHEN 'Breakfast' THEN 1
                   WHEN 'Lunch' THEN 2
                   WHEN 'Evening Snacks' THEN 3
                   WHEN 'Dinner' THEN 4
                   ELSE 5
                 END,
                 l.name NULLS LAST, f.sort_order, f.id`,
      [admin.id, planDate],
    );

    if (!result.rows.length) continue;

    const sections = MEALS.map((meal) => ({
      meal,
      recipes: result.rows
        .filter((row) => row.meal === meal)
        .map((row) => ({
          name: row.recipe?.name || row.recipe?.title || "Recipe",
          category: row.recipe?.category || "",
          location: row.locationName,
          servings: Number(row.servings || 0),
        })),
    }));

    await sendDailyPlannedRecipeEmail(admin.email, dateLabel(planDate), sections);
    recipients += 1;
    recipeCount += result.rows.length;
  }

  if (!recipients) {
    return {
      skipped: true,
      reason: "No planned recipes found for the day; no email sent",
      recipients: 0,
      rows: 0,
      planDate,
    };
  }

  return { recipients, rows: recipeCount, planDate };
}
