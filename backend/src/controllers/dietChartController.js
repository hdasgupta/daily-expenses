import { readFileSync } from "node:fs";
import { q } from "../db/index.js";

// The recipe catalogue is version-controlled project data. Update recipes.json and redeploy to change it.
const staticRecipes = JSON.parse(readFileSync(new URL("../data/recipes.json", import.meta.url), "utf8"));

export async function listRecipes(_req, res) {
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
  res.json(staticRecipes);
}

const readOnlyRecipeResponse = (_req, res) => res.status(405).json({
  error: "The recipe catalogue is read-only. Update backend/src/data/recipes.json and redeploy to change recipes.",
});
export const createRecipe = readOnlyRecipeResponse;
export const updateRecipe = readOnlyRecipeResponse;
export const deleteRecipe = readOnlyRecipeResponse;

export async function listFoodChart(req, res) {
  const date = String(req.query.date || "").slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "A valid chart date is required" });
  const result = await q(`SELECT id,chart_date AS date,meal,recipe_id AS "recipeId",recipe_snapshot AS recipe,servings,sort_order AS "sortOrder" FROM public.food_chart_entries WHERE user_id=$1 AND chart_date=$2::date ORDER BY CASE meal WHEN 'Breakfast' THEN 1 WHEN 'Lunch' THEN 2 WHEN 'Evening Snacks' THEN 3 ELSE 4 END,sort_order,id`, [req.user.id,date]);
  res.json(result.rows);
}
export async function addFoodChartEntry(req, res) {
  const b=req.body||{}; const date=String(b.date||"").slice(0,10); const meal=String(b.meal||"");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["Breakfast","Lunch","Evening Snacks","Dinner"].includes(meal) || !b.recipeId) return res.status(400).json({error:"Date, meal and recipe are required"});
  const snapshot=staticRecipes.find((recipe) => String(recipe.id) === String(b.recipeId));
  if(!snapshot) return res.status(404).json({error:"Recipe not found in the static catalogue"});
  const servings=Math.max(0.25,Number(b.servings)||Number(snapshot.servings)||2);
  const order=await q("SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM public.food_chart_entries WHERE user_id=$1 AND chart_date=$2::date AND meal=$3",[req.user.id,date,meal]);
  const result=await q(`INSERT INTO public.food_chart_entries(user_id,chart_date,meal,recipe_id,recipe_snapshot,servings,sort_order) VALUES($1,$2::date,$3,NULL,$4::jsonb,$5,$6) RETURNING id,chart_date AS date,meal,recipe_id AS "recipeId",recipe_snapshot AS recipe,servings,sort_order AS "sortOrder"`,[req.user.id,date,meal,JSON.stringify(snapshot),servings,order.rows[0].n]);
  res.status(201).json(result.rows[0]);
}
export async function updateFoodChartEntry(req,res) {
  const servings=Math.max(0.25,Number(req.body?.servings)||0);
  if(!servings) return res.status(400).json({error:"A valid serving quantity is required"});
  const result=await q(`UPDATE public.food_chart_entries SET servings=$3 WHERE id=$1 AND user_id=$2 RETURNING id,chart_date AS date,meal,recipe_id AS "recipeId",recipe_snapshot AS recipe,servings,sort_order AS "sortOrder"`,[req.params.id,req.user.id,servings]);
  if(!result.rowCount) return res.status(404).json({error:"Food chart entry not found"}); res.json(result.rows[0]);
}
export async function removeFoodChartEntry(req,res) {
  const result=await q("DELETE FROM public.food_chart_entries WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,req.user.id]);
  if(!result.rowCount) return res.status(404).json({error:"Food chart entry not found"}); res.json({ok:true,id:result.rows[0].id});
}
