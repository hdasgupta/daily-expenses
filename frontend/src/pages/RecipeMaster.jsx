import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, MapPin, Plus, Search, ShoppingBasket, X } from "lucide-react";
import { api, showToast } from "../lib/api";
import { todayKolkata } from "../utils/dates.js";
import "./dietChart.css";

function RecipeDetails({ recipe, onClose, onAddIngredient }) {
  if (!recipe) return null;
  return <div className="diet-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="diet-modal"><header><h2>{recipe.name}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header><p className="diet-muted">{recipe.category} · {recipe.region} · Prep {recipe.prepMinutes || 0} min · Cook {recipe.cookMinutes || 0} min · Serves {recipe.servings || 2}</p><h3>Ingredients</h3><div className="diet-ingredients">{(recipe.ingredients || []).map((ingredient, i) => <div className="diet-view-ingredient" key={i}><span>{ingredient.name}</span><strong>{[ingredient.quantity, ingredient.unit].filter(Boolean).join(" ") || "As needed"}</strong><button type="button" className="icon-button diet-add-marketing-item" title={`Add ${ingredient.name} to marketing list`} aria-label={`Add ${ingredient.name} to marketing list`} onClick={() => onAddIngredient(ingredient)}><Plus size={17} /></button></div>)}</div><h3>Preparation</h3><ol className="diet-steps">{(recipe.steps || []).map((step, i) => <li key={i}><strong>{step.section || `Step ${i + 1}`}</strong><span className="diet-time">{step.minutes || 0} min</span><p>{step.text}</p></li>)}</ol>{recipe.notes && <><h3>Notes</h3><p>{recipe.notes}</p></>}</section></div>;
}

function AddIngredientToMarketing({ ingredient, categories, locations, units, onClose, onSubmit, saving }) {
  const [form, setForm] = useState({ purchaseDate: todayKolkata(), locationId: "", categoryId: "", itemName: ingredient?.name || "", quantity: ingredient?.quantity || "", unitId: "" });
  useEffect(() => {
    const ingredientUnit = String(ingredient?.unit || "").trim().toLowerCase();
    const matchedUnit = units.find((unit) => String(unit.name || "").trim().toLowerCase() === ingredientUnit);
    setForm((current) => ({ ...current, itemName: ingredient?.name || "", quantity: ingredient?.quantity || "", unitId: matchedUnit ? String(matchedUnit.id) : "" }));
  }, [ingredient, units]);
  if (!ingredient) return null;
  return <div className="diet-modal-backdrop diet-marketing-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><form className="diet-modal diet-marketing-modal" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}><header><div><h2>Add ingredient to marketing list</h2><p className="diet-muted">Choose the shopping date, location and category.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header><label><span><CalendarDays size={15} /> Marketing date</span><input required type="date" value={form.purchaseDate} onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))} /></label><label><span><MapPin size={15} /> Marketing location</span><select required value={form.locationId} onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}><option value="">Choose location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Item category<select required value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Selected ingredient<input required maxLength={200} value={form.itemName} onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))} /></label><div className="diet-form-grid"><label>Quantity<input type="number" min="0" step="any" placeholder="e.g. 2" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} /></label><label>Unit<select value={form.unitId} onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}><option value="">Choose unit (optional)</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label></div><footer><button type="button" className="diet-secondary" onClick={onClose}>Cancel</button><button type="submit" className="diet-primary" disabled={saving}><ShoppingBasket size={16} />{saving ? "Adding…" : "Add to marketing list"}</button></footer></form></div>;
}

export default function RecipeMaster() {
  const [recipes, setRecipes] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [query, setQuery] = useState(""), [viewer, setViewer] = useState(null);
  const [marketingCategories, setMarketingCategories] = useState([]), [marketingLocations, setMarketingLocations] = useState([]), [marketingUnits, setMarketingUnits] = useState([]), [addIngredient, setAddIngredient] = useState(null), [addingToMarketing, setAddingToMarketing] = useState(false);
  useEffect(() => { let active = true; api("/recipes").then((result) => { if (active) setRecipes(Array.isArray(result) ? result : []); }).catch((e) => { if (active) setError(e.message || "Unable to load recipes"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const filtered = useMemo(() => recipes.filter((recipe) => [recipe.name, recipe.category, recipe.region, ...(recipe.ingredients || []).map((ingredient) => ingredient.name)].join(" ").toLowerCase().includes(query.toLowerCase())), [recipes, query]);
  const openAddIngredient = async (ingredient) => {
    setAddIngredient({ ...ingredient, name: String(ingredient?.name || "").trim() });
    try {
      const [categoriesResult, locationsResult, unitsResult] = await Promise.all([api("/meta/categories"), api("/marketing-locations"), api("/meta/units")]);
      setMarketingCategories(Array.isArray(categoriesResult) ? categoriesResult : []);
      setMarketingLocations(Array.isArray(locationsResult) ? locationsResult : []);
      setMarketingUnits(Array.isArray(unitsResult) ? unitsResult : []);
    } catch (e) { showToast("error", e.message || "Unable to load marketing categories, locations and units."); }
  };
  const addIngredientToMarketing = async (values) => {
    const itemName = String(values.itemName || "").trim();
    if (!itemName || !values.purchaseDate || !values.locationId || !values.categoryId) { showToast("warning", "Choose a date, location and category, and enter an ingredient. Quantity and unit are optional."); return; }
    setAddingToMarketing(true);
    try {
      await api("/marketing-list", { method: "POST", body: JSON.stringify({ categoryId: values.categoryId, itemId: "", itemName, quantity: values.quantity === "" ? "" : String(values.quantity), unitId: String(values.unitId || ""), purchaseDate: values.purchaseDate, locationId: values.locationId }), silentToast: true });
      showToast("success", `${itemName} added to the marketing list.`);
      setAddIngredient(null);
    } catch (e) { showToast("error", e.message || `Unable to add ${itemName} to the marketing list.`); }
    finally { setAddingToMarketing(false); }
  };
  return <main className="diet-page"><div className="diet-page-heading"><div><h1>Recipe Master</h1><p>Browse the built-in recipe catalogue. To change recipes, update <code>backend/src/data/recipes.json</code> and redeploy the project.</p></div></div>{error && <div className="diet-error">{error}</div>}<label className="diet-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search recipe, ingredient, category or region…" /></label>
    {loading ? <p>Loading recipes…</p> : <div className="diet-recipe-list">{filtered.map((recipe) => <article className="diet-recipe-row" key={recipe.id}><div className="diet-recipe-main"><strong>{recipe.name}</strong><span>{recipe.category} · {recipe.region} · {recipe.ingredients?.length || 0} ingredients · {Number(recipe.prepMinutes || 0) + Number(recipe.cookMinutes || 0)} min</span></div><div className="diet-actions"><button className="icon-button" title="View recipe" aria-label={`View ${recipe.name}`} onClick={() => setViewer(recipe)}><BookOpen size={18} /></button></div></article>)}{!filtered.length && <div className="diet-empty">{query ? "No recipes match your search." : "No recipes found in the static catalogue."}</div>}</div>}
    <RecipeDetails recipe={viewer} onClose={() => setViewer(null)} onAddIngredient={openAddIngredient} /><AddIngredientToMarketing ingredient={addIngredient} categories={marketingCategories} locations={marketingLocations} units={marketingUnits} onClose={() => setAddIngredient(null)} onSubmit={addIngredientToMarketing} saving={addingToMarketing} />
  </main>;
}
