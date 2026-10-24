import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, MapPin, Plus, Search, ShoppingBasket, X } from "lucide-react";
import { api, showToast } from "../lib/api";
import {
  describeAutoMatchReason,
  fetchLocationsWithGps,
  formatLocationOptionLabel,
  getCurrentGpsPosition,
  isValidCoordinates,
  recordLocationSelection,
} from "../lib/locationTracker";
import { todayKolkata } from "../utils/dates.js";
import "./dietChart.css";

const LOCAL_RECIPE_USAGE_KEY = "recipe-master-usage-counts-v1";

function readLocalRecipeUsage() {
  try {
    const raw = localStorage.getItem(LOCAL_RECIPE_USAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function incrementLocalRecipeUsage(recipeId) {
  if (!recipeId) return {};
  const current = readLocalRecipeUsage();
  const key = String(recipeId);
  const next = {
    ...current,
    [key]: Number(current[key] || 0) + 1,
  };
  try {
    localStorage.setItem(LOCAL_RECIPE_USAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

function RecipeDetails({ recipe, onClose, onAddIngredient }) {
  if (!recipe) return null;
  return (
    <div className="diet-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="diet-modal">
        <header>
          <h2>{recipe.name}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <p className="diet-muted">
          {recipe.category} · {recipe.region} · Prep {recipe.prepMinutes || 0} min · Cook {recipe.cookMinutes || 0} min · Serves {recipe.servings || 2}
        </p>
        <h3>Ingredients</h3>
        <div className="diet-ingredients">
          {(recipe.ingredients || []).map((ingredient, i) => (
            <div className="diet-view-ingredient" key={i}>
              <span>{ingredient.name}</span>
              <strong>{[ingredient.quantity, ingredient.unit].filter(Boolean).join(" ") || "As needed"}</strong>
              <button
                type="button"
                className="icon-button diet-add-marketing-item"
                title={`Add ${ingredient.name} to marketing list`}
                aria-label={`Add ${ingredient.name} to marketing list`}
                onClick={() => onAddIngredient(ingredient, recipe)}
              >
                <Plus size={17} />
              </button>
            </div>
          ))}
        </div>
        <h3>Preparation</h3>
        <ol className="diet-steps">
          {(recipe.steps || []).map((step, i) => (
            <li key={i}>
              <strong>{step.section || `Step ${i + 1}`}</strong>
              <span className="diet-time">{step.minutes || 0} min</span>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
        {recipe.notes && (
          <>
            <h3>Notes</h3>
            <p>{recipe.notes}</p>
          </>
        )}
      </section>
    </div>
  );
}

function AddIngredientToMarketing({ ingredient, categories, locations, units, onClose, onSubmit, saving }) {
  const [form, setForm] = useState({
    purchaseDate: todayKolkata(),
    locationId: "",
    categoryId: "",
    itemName: ingredient?.name || "",
    quantity: ingredient?.quantity || "",
    unitId: "",
  });
  const [autoHint, setAutoHint] = useState("");

  useEffect(() => {
    const ingredientUnit = String(ingredient?.unit || "").trim().toLowerCase();
    const matchedUnit = units.find(
      (unit) => String(unit.name || "").trim().toLowerCase() === ingredientUnit
    );
    const recommendedLoc =
      locations.find((loc) => loc.auto_recommended) || locations[0] || null;
    if (recommendedLoc && !form.locationId) {
      setAutoHint(describeAutoMatchReason(recommendedLoc));
    }
    setForm((current) => ({
      ...current,
      locationId: current.locationId || (recommendedLoc ? String(recommendedLoc.id) : ""),
      itemName: ingredient?.name || "",
      quantity: ingredient?.quantity || "",
      unitId: matchedUnit ? String(matchedUnit.id) : "",
    }));
  }, [ingredient, units, locations]);

  if (!ingredient) return null;

  return (
    <div
      className="diet-modal-backdrop diet-marketing-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="diet-modal diet-marketing-modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
      >
        <header>
          <div>
            <h2>Add ingredient to marketing list</h2>
            <p className="diet-muted">Choose the shopping date, location and category.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <label>
          <span>
            <CalendarDays size={15} /> Marketing date
          </span>
          <input
            required
            type="date"
            value={form.purchaseDate}
            onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))}
          />
        </label>
        <label>
          <span>
            <MapPin size={15} /> Marketing location
          </span>
          <select
            required
            value={form.locationId}
            onChange={(e) => {
              setAutoHint("");
              setForm((f) => ({ ...f, locationId: e.target.value }));
            }}
          >
            <option value="">Choose location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {formatLocationOptionLabel(location)}
              </option>
            ))}
          </select>
          {autoHint && <small className="diet-auto-location-hint">{autoHint}</small>}
        </label>
        <label>
          Item category
          <select
            required
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
          >
            <option value="">Choose category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Selected ingredient
          <input
            required
            maxLength={200}
            value={form.itemName}
            onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))}
          />
        </label>
        <div className="diet-form-grid">
          <label>
            Quantity
            <input
              type="number"
              min="0"
              step="any"
              placeholder="e.g. 2"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            />
          </label>
          <label>
            Unit
            <select
              value={form.unitId}
              onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}
            >
              <option value="">Choose unit (optional)</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <footer>
          <button type="button" className="diet-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="diet-primary" disabled={saving}>
            <ShoppingBasket size={16} />
            {saving ? "Adding…" : "Add to marketing list"}
          </button>
        </footer>
      </form>
    </div>
  );
}

export default function RecipeMaster() {
  const [recipes, setRecipes] = useState([]);
  const [localUsage, setLocalUsage] = useState(readLocalRecipeUsage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [viewer, setViewer] = useState(null);
  const [currentCoords, setCurrentCoords] = useState(null);
  const [marketingCategories, setMarketingCategories] = useState([]);
  const [marketingLocations, setMarketingLocations] = useState([]);
  const [marketingUnits, setMarketingUnits] = useState([]);
  const [addIngredient, setAddIngredient] = useState(null);
  const [addingToMarketing, setAddingToMarketing] = useState(false);

  useEffect(() => {
    let active = true;
    api("/recipes")
      .then((result) => {
        if (active) setRecipes(Array.isArray(result) ? result : []);
      })
      .catch((e) => {
        if (active) setError(e.message || "Unable to load recipes");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const getRecipeUsageCount = (recipe) => {
    const serverUsage = Number(recipe?.usageCount ?? recipe?.usage_count ?? 0);
    const clientUsage = Number(localUsage[String(recipe?.id)] || 0);
    return serverUsage + clientUsage;
  };

  const filtered = useMemo(() => {
    const matching = recipes.filter((recipe) =>
      [
        recipe.name,
        recipe.category,
        recipe.region,
        ...(recipe.ingredients || []).map((ingredient) => ingredient.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    );

    return [...matching].sort((a, b) => {
      const usageDiff = getRecipeUsageCount(b) - getRecipeUsageCount(a);
      if (usageDiff !== 0) return usageDiff;
      const userDiff = Number(b.userUsageCount || 0) - Number(a.userUsageCount || 0);
      if (userDiff !== 0) return userDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }, [recipes, query, localUsage]);

  const handleViewRecipe = (recipe) => {
    if (recipe?.id) {
      setLocalUsage(incrementLocalRecipeUsage(recipe.id));
    }
    setViewer(recipe);
  };

  const openAddIngredient = async (ingredient, sourceRecipe = viewer) => {
    if (sourceRecipe?.id) {
      setLocalUsage(incrementLocalRecipeUsage(sourceRecipe.id));
    }
    setAddIngredient({ ...ingredient, name: String(ingredient?.name || "").trim() });
    try {
      const [categoriesResult, locBundle, unitsResult] = await Promise.all([
        api("/meta/categories"),
        fetchLocationsWithGps({ coords: currentCoords, silent: true }),
        api("/meta/units"),
      ]);
      if (isValidCoordinates(locBundle?.coords)) {
        setCurrentCoords(locBundle.coords);
      }
      setMarketingCategories(Array.isArray(categoriesResult) ? categoriesResult : []);
      setMarketingLocations(Array.isArray(locBundle?.locations) ? locBundle.locations : []);
      setMarketingUnits(Array.isArray(unitsResult) ? unitsResult : []);
    } catch (e) {
      showToast("error", e.message || "Unable to load marketing categories, locations and units.");
    }
  };

  const addIngredientToMarketing = async (values) => {
    const itemName = String(values.itemName || "").trim();
    if (!itemName || !values.purchaseDate || !values.locationId || !values.categoryId) {
      showToast("warning", "Choose a date, location and category, and enter an ingredient. Quantity and unit are optional.");
      return;
    }
    setAddingToMarketing(true);
    try {
      const coords = isValidCoordinates(currentCoords)
        ? currentCoords
        : await getCurrentGpsPosition({ timeout: 2500 });
      if (isValidCoordinates(coords)) {
        setCurrentCoords(coords);
      }
      await api("/marketing-list", {
        method: "POST",
        body: JSON.stringify({
          categoryId: values.categoryId,
          itemId: "",
          itemName,
          quantity: values.quantity === "" ? "" : String(values.quantity),
          unitId: String(values.unitId || ""),
          purchaseDate: values.purchaseDate,
          locationId: values.locationId,
          latitude: coords ? coords.latitude : null,
          longitude: coords ? coords.longitude : null,
        }),
        silentToast: true,
      });
      void recordLocationSelection(values.locationId, { coords, source: "recipe_master_ingredient" });
      showToast("success", `${itemName} added to the marketing list.`);
      setAddIngredient(null);
    } catch (e) {
      showToast("error", e.message || `Unable to add ${itemName} to the marketing list.`);
    } finally {
      setAddingToMarketing(false);
    }
  };

  return (
    <main className="diet-page">
      <div className="diet-page-heading">
        <div>
          <h1>Recipe Master</h1>
        </div>
      </div>
      {error && <div className="diet-error">{error}</div>}
      <label className="diet-search">
        <Search size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipe, ingredient, category or region…"
        />
      </label>
      {loading ? (
        <p>Loading recipes…</p>
      ) : (
        <div className="diet-recipe-list">
          {filtered.map((recipe) => {
            const usageCount = getRecipeUsageCount(recipe);
            return (
              <article className="diet-recipe-row" key={recipe.id}>
                <div className="diet-recipe-main">
                  <strong>{recipe.name}</strong>
                  <span>
                    {recipe.category} · {recipe.region} · {recipe.ingredients?.length || 0} ingredients · {Number(recipe.prepMinutes || 0) + Number(recipe.cookMinutes || 0)} min
                    {usageCount > 0 ? ` · Used ${usageCount}x` : ""}
                  </span>
                </div>
                <div className="diet-actions">
                  <button
                    className="icon-button"
                    title="View recipe"
                    aria-label={`View ${recipe.name}`}
                    onClick={() => handleViewRecipe(recipe)}
                  >
                    <BookOpen size={18} />
                  </button>
                </div>
              </article>
            );
          })}
          {!filtered.length && (
            <div className="diet-empty">
              {query ? "No recipes match your search." : "No recipes found in the static catalogue."}
            </div>
          )}
        </div>
      )}
      <RecipeDetails recipe={viewer} onClose={() => setViewer(null)} onAddIngredient={openAddIngredient} />
      <AddIngredientToMarketing
        ingredient={addIngredient}
        categories={marketingCategories}
        locations={marketingLocations}
        units={marketingUnits}
        onClose={() => setAddIngredient(null)}
        onSubmit={addIngredientToMarketing}
        saving={addingToMarketing}
      />
    </main>
  );
}