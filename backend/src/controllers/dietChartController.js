import { q } from "../db/index.js";

const cleanRecipe = (body = {}) => ({
  name: String(body.name || "").trim(),
  category: String(body.category || "Other").trim() || "Other",
  region: String(body.region || "Indian").trim() || "Indian",
  ingredients: Array.isArray(body.ingredients) ? body.ingredients.filter((x) => x && String(x.name || "").trim()).map((x) => ({ name: String(x.name).trim(), quantity: String(x.quantity ?? "").trim(), unit: String(x.unit ?? "").trim() })) : [],
  steps: Array.isArray(body.steps) ? body.steps.filter((x) => x && String(x.text || "").trim()).map((x, i) => ({ section: String(x.section || `Step ${i + 1}`).trim(), text: String(x.text).trim(), minutes: Math.max(0, Number.parseInt(x.minutes, 10) || 0) })) : [],
  prepMinutes: Math.max(0, Number.parseInt(body.prepMinutes, 10) || 0),
  cookMinutes: Math.max(0, Number.parseInt(body.cookMinutes, 10) || 0),
  servings: Math.max(0.25, Number(body.servings) || 2),
  notes: String(body.notes || "").trim(),
});
const selectRecipe = `SELECT id, name, category, region, ingredients, steps, prep_minutes AS "prepMinutes", cook_minutes AS "cookMinutes", servings, notes, created_at, updated_at FROM public.recipe_master`;

const starterRecipes = [
  { name:"Aloo Posto",category:"Vegetable",region:"Bengali",prepMinutes:10,cookMinutes:20,servings:2,ingredients:[{name:"Potato",quantity:"300",unit:"g"},{name:"Poppy seeds",quantity:"3",unit:"tbsp"},{name:"Green chilli",quantity:"2",unit:"pcs"},{name:"Mustard oil",quantity:"2",unit:"tbsp"},{name:"Salt",quantity:"to taste",unit:""}],steps:[{section:"Prepare posto paste",text:"Soak poppy seeds briefly and grind with green chilli and a little water to a smooth paste.",minutes:5},{section:"Cook potatoes",text:"Heat mustard oil, add diced potatoes and salt, and cook until lightly golden.",minutes:10},{section:"Finish",text:"Add the posto paste and a splash of water. Cover and cook until potatoes are tender and the paste is fragrant.",minutes:5}]},
  { name:"Beguni",category:"Fritters",region:"Bengali",prepMinutes:10,cookMinutes:15,servings:3,ingredients:[{name:"Eggplant",quantity:"1",unit:"medium"},{name:"Besan",quantity:"100",unit:"g"},{name:"Rice flour",quantity:"1",unit:"tbsp"},{name:"Turmeric",quantity:"1/4",unit:"tsp"},{name:"Red chilli powder",quantity:"1/2",unit:"tsp"},{name:"Oil",quantity:"for frying",unit:""}],steps:[{section:"Prepare batter",text:"Mix besan, rice flour, turmeric, chilli powder, salt and water to make a coating batter.",minutes:5},{section:"Slice eggplant",text:"Cut eggplant into thin lengthwise slices and lightly salt them.",minutes:5},{section:"Fry",text:"Dip slices in batter and fry in hot oil until crisp and golden on both sides.",minutes:5}]},
  { name:"Piyaji",category:"Fritters",region:"Bengali",prepMinutes:15,cookMinutes:15,servings:3,ingredients:[{name:"Onion",quantity:"300",unit:"g"},{name:"Besan",quantity:"3",unit:"tbsp"},{name:"Green chilli",quantity:"2",unit:"pcs"},{name:"Turmeric",quantity:"1/4",unit:"tsp"},{name:"Salt",quantity:"to taste",unit:""},{name:"Oil",quantity:"for frying",unit:""}],steps:[{section:"Mix",text:"Thinly slice onions. Mix with chopped chilli, salt, turmeric and besan; add only a little water if needed.",minutes:10},{section:"Fry",text:"Drop small portions into medium-hot oil and fry, turning once, until crisp and deep golden.",minutes:15}]},
  { name:"Baingan Bharta",category:"Vegetable",region:"North Indian",prepMinutes:10,cookMinutes:25,servings:2,ingredients:[{name:"Eggplant",quantity:"1",unit:"large"},{name:"Onion",quantity:"1",unit:"medium"},{name:"Tomato",quantity:"2",unit:"medium"},{name:"Garlic",quantity:"4",unit:"cloves"},{name:"Oil",quantity:"2",unit:"tbsp"}],steps:[{section:"Roast eggplant",text:"Roast eggplant over a flame or in an oven until the skin chars and the flesh is soft. Cool, peel and mash.",minutes:15},{section:"Make masala",text:"Sauté onion and garlic in oil, add chopped tomatoes and cook until soft.",minutes:7},{section:"Finish",text:"Mix in mashed eggplant, salt and spices; cook together until well combined.",minutes:3}]},
  { name:"Chingri Malai Curry",category:"Prawns",region:"Bengali",prepMinutes:15,cookMinutes:20,servings:3,ingredients:[{name:"Prawns",quantity:"500",unit:"g"},{name:"Coconut milk",quantity:"250",unit:"ml"},{name:"Onion paste",quantity:"3",unit:"tbsp"},{name:"Ginger paste",quantity:"1",unit:"tsp"},{name:"Mustard oil",quantity:"2",unit:"tbsp"}],steps:[{section:"Season prawns",text:"Clean prawns and lightly season with salt and turmeric.",minutes:5},{section:"Sauté masala",text:"Lightly fry prawns, remove, then cook onion and ginger paste with spices.",minutes:8},{section:"Simmer curry",text:"Add coconut milk and a little water. Return prawns and simmer gently until just cooked.",minutes:7}]},
  { name:"Macher Jhol",category:"Fish",region:"Bengali",prepMinutes:15,cookMinutes:25,servings:3,ingredients:[{name:"Rohu or katla fish",quantity:"500",unit:"g"},{name:"Potato",quantity:"2",unit:"medium"},{name:"Tomato",quantity:"1",unit:"medium"},{name:"Mustard oil",quantity:"3",unit:"tbsp"},{name:"Turmeric",quantity:"1/2",unit:"tsp"}],steps:[{section:"Fry fish",text:"Season fish with salt and turmeric, then lightly fry on both sides and set aside.",minutes:8},{section:"Cook vegetables",text:"Fry potato wedges; add tomato, cumin and turmeric and sauté until fragrant.",minutes:7},{section:"Simmer",text:"Add water and salt, cook potatoes until nearly tender, then add fish and simmer gently.",minutes:10}]},
  { name:"Egg Curry",category:"Egg",region:"North Indian",prepMinutes:10,cookMinutes:20,servings:2,ingredients:[{name:"Eggs",quantity:"4",unit:"pcs"},{name:"Onion",quantity:"2",unit:"medium"},{name:"Tomato",quantity:"2",unit:"medium"},{name:"Ginger-garlic paste",quantity:"1",unit:"tbsp"},{name:"Oil",quantity:"2",unit:"tbsp"}],steps:[{section:"Boil eggs",text:"Boil eggs, cool, peel and make shallow slits in them.",minutes:8},{section:"Prepare gravy",text:"Sauté onion until golden. Add ginger-garlic paste, tomato and spices; cook until oil separates.",minutes:8},{section:"Simmer",text:"Add water and eggs, then simmer until the gravy reaches the desired consistency.",minutes:4}]},
  { name:"Steamed Rice",category:"Rice",region:"Indian",prepMinutes:5,cookMinutes:20,servings:2,ingredients:[{name:"Rice",quantity:"1",unit:"cup"},{name:"Water",quantity:"2",unit:"cups"},{name:"Salt",quantity:"optional",unit:""}],steps:[{section:"Wash rice",text:"Rinse rice until the water runs mostly clear.",minutes:5},{section:"Cook rice",text:"Add rice and water to a covered pot. Simmer until tender and water is absorbed; rest before fluffing.",minutes:15}]},
  { name:"Vegetable Pulao",category:"Rice",region:"Indian",prepMinutes:15,cookMinutes:25,servings:3,ingredients:[{name:"Basmati rice",quantity:"1.5",unit:"cups"},{name:"Mixed vegetables",quantity:"250",unit:"g"},{name:"Onion",quantity:"1",unit:"medium"},{name:"Whole spices",quantity:"1",unit:"tbsp"},{name:"Ghee or oil",quantity:"2",unit:"tbsp"}],steps:[{section:"Prepare ingredients",text:"Wash and soak rice. Chop vegetables and slice onion.",minutes:10},{section:"Sauté",text:"Heat ghee, bloom whole spices, sauté onion and vegetables, then stir in drained rice.",minutes:5},{section:"Cook pulao",text:"Add measured water and salt, cover and cook on low until rice is fluffy.",minutes:20}]},
  { name:"Luchi",category:"Bread",region:"Bengali",prepMinutes:20,cookMinutes:15,servings:3,ingredients:[{name:"Maida",quantity:"250",unit:"g"},{name:"Oil or ghee",quantity:"1",unit:"tbsp"},{name:"Water",quantity:"as needed",unit:""},{name:"Oil",quantity:"for frying",unit:""}],steps:[{section:"Knead dough",text:"Rub oil into flour, add water gradually and knead into a smooth firm dough. Rest covered.",minutes:15},{section:"Roll luchi",text:"Divide into small balls and roll each into a small round disc.",minutes:5},{section:"Fry",text:"Deep-fry one at a time in hot oil, gently pressing so each luchi puffs.",minutes:15}]},
  { name:"Potol Bhaja",category:"Vegetable",region:"Bengali",prepMinutes:10,cookMinutes:15,servings:2,ingredients:[{name:"Pointed gourd (potol)",quantity:"300",unit:"g"},{name:"Turmeric",quantity:"1/4",unit:"tsp"},{name:"Salt",quantity:"to taste",unit:""},{name:"Mustard oil",quantity:"2",unit:"tbsp"}],steps:[{section:"Prepare potol",text:"Scrape the skin lightly, trim ends and slice lengthwise. Toss with salt and turmeric.",minutes:10},{section:"Fry",text:"Pan-fry in mustard oil, turning occasionally, until tender and browned.",minutes:15}]},
  { name:"Mochar Ghonto",category:"Vegetable",region:"Bengali",prepMinutes:25,cookMinutes:30,servings:3,ingredients:[{name:"Banana blossom",quantity:"1",unit:"medium"},{name:"Potato",quantity:"1",unit:"medium"},{name:"Grated coconut",quantity:"3",unit:"tbsp"},{name:"Ginger paste",quantity:"1",unit:"tsp"},{name:"Ghee",quantity:"1",unit:"tsp"}],steps:[{section:"Clean banana blossom",text:"Remove florets and hard stems, chop finely and boil with a pinch of turmeric. Drain well.",minutes:20},{section:"Cook ghonto",text:"Sauté spices and potato, add chopped blossom, ginger and salt; cook covered until tender.",minutes:20},{section:"Finish",text:"Stir in grated coconut and a little ghee, then cook briefly.",minutes:5}]},
  { name:"Fish Roe Fry",category:"Fish Roe",region:"Bengali",prepMinutes:10,cookMinutes:15,servings:2,ingredients:[{name:"Fish roe",quantity:"250",unit:"g"},{name:"Onion",quantity:"1",unit:"medium"},{name:"Green chilli",quantity:"2",unit:"pcs"},{name:"Turmeric",quantity:"1/4",unit:"tsp"},{name:"Mustard oil",quantity:"2",unit:"tbsp"}],steps:[{section:"Season roe",text:"Gently clean fish roe and season with salt and turmeric.",minutes:5},{section:"Cook",text:"Heat oil, sauté onion and chilli, add roe carefully and cook through while breaking it into small pieces.",minutes:10}]}
];

export async function listRecipes(req, res) {
  const existing = await q("SELECT id FROM public.recipe_master WHERE user_id=$1 LIMIT 1", [req.user.id]);
  if (!existing.rowCount) {
    for (const r of starterRecipes) {
      await q(`INSERT INTO public.recipe_master(user_id,name,category,region,ingredients,steps,prep_minutes,cook_minutes,servings) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) ON CONFLICT(user_id,name) DO NOTHING`, [req.user.id,r.name,r.category,r.region,JSON.stringify(r.ingredients),JSON.stringify(r.steps),r.prepMinutes,r.cookMinutes,r.servings]);
    }
  }
  const result = await q(`${selectRecipe} WHERE user_id=$1 ORDER BY name`, [req.user.id]);
  res.json(result.rows);
}
export async function createRecipe(req, res) {
  const r = cleanRecipe(req.body);
  if (!r.name) return res.status(400).json({ error: "Recipe name is required" });
  const result = await q(`INSERT INTO public.recipe_master(user_id,name,category,region,ingredients,steps,prep_minutes,cook_minutes,servings,notes)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10) RETURNING id,name,category,region,ingredients,steps,prep_minutes AS "prepMinutes",cook_minutes AS "cookMinutes",servings,notes,created_at,updated_at`,
    [req.user.id,r.name,r.category,r.region,JSON.stringify(r.ingredients),JSON.stringify(r.steps),r.prepMinutes,r.cookMinutes,r.servings,r.notes || null]);
  res.status(201).json(result.rows[0]);
}
export async function updateRecipe(req, res) {
  const r = cleanRecipe(req.body);
  if (!r.name) return res.status(400).json({ error: "Recipe name is required" });
  const result = await q(`UPDATE public.recipe_master SET name=$3,category=$4,region=$5,ingredients=$6::jsonb,steps=$7::jsonb,prep_minutes=$8,cook_minutes=$9,servings=$10,notes=$11,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id,name,category,region,ingredients,steps,prep_minutes AS "prepMinutes",cook_minutes AS "cookMinutes",servings,notes,created_at,updated_at`,
    [req.params.id,req.user.id,r.name,r.category,r.region,JSON.stringify(r.ingredients),JSON.stringify(r.steps),r.prepMinutes,r.cookMinutes,r.servings,r.notes || null]);
  if (!result.rowCount) return res.status(404).json({ error: "Recipe not found" });
  res.json(result.rows[0]);
}
export async function deleteRecipe(req, res) {
  const result = await q("DELETE FROM public.recipe_master WHERE id=$1 AND user_id=$2 RETURNING id", [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Recipe not found" });
  res.json({ ok: true, id: result.rows[0].id });
}
export async function listFoodChart(req, res) {
  const date = String(req.query.date || "").slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "A valid chart date is required" });
  const result = await q(`SELECT id,chart_date AS date,meal,recipe_id AS "recipeId",recipe_snapshot AS recipe,servings,sort_order AS "sortOrder" FROM public.food_chart_entries WHERE user_id=$1 AND chart_date=$2::date ORDER BY CASE meal WHEN 'Breakfast' THEN 1 WHEN 'Lunch' THEN 2 WHEN 'Evening Snacks' THEN 3 ELSE 4 END,sort_order,id`, [req.user.id,date]);
  res.json(result.rows);
}
export async function addFoodChartEntry(req, res) {
  const b=req.body||{}; const date=String(b.date||"").slice(0,10); const meal=String(b.meal||"");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["Breakfast","Lunch","Evening Snacks","Dinner"].includes(meal) || !b.recipeId) return res.status(400).json({error:"Date, meal and recipe are required"});
  const recipe=await q(`${selectRecipe} WHERE user_id=$1 AND id=$2`,[req.user.id,b.recipeId]);
  if(!recipe.rowCount) return res.status(404).json({error:"Recipe not found"});
  const snapshot=recipe.rows[0]; const servings=Math.max(0.25,Number(b.servings)||Number(snapshot.servings)||2);
  const order=await q("SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM public.food_chart_entries WHERE user_id=$1 AND chart_date=$2::date AND meal=$3",[req.user.id,date,meal]);
  const result=await q(`INSERT INTO public.food_chart_entries(user_id,chart_date,meal,recipe_id,recipe_snapshot,servings,sort_order) VALUES($1,$2::date,$3,$4,$5::jsonb,$6,$7) RETURNING id,chart_date AS date,meal,recipe_id AS "recipeId",recipe_snapshot AS recipe,servings,sort_order AS "sortOrder"`,[req.user.id,date,meal,snapshot.id,JSON.stringify(snapshot),servings,order.rows[0].n]);
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
