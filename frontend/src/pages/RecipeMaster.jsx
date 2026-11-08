import React, { useCallback, useEffect, useMemo, useState } from "react";
import Pagination from "../components/Pagination";
import { usePagination } from "../hooks/usePagination";
import { indexRecipes, extractCategories, searchAndRankRecipes } from "../lib/recipeSearch";
import { BookOpen, CalendarClock, CalendarDays, Clock3, MapPin, Plus, Search, ShoppingBasket, X } from "lucide-react";
import { api, showToast } from "../lib/api";
import {
  describeAutoMatchReason,
  fetchLocationsWithGps,
  formatLocationOptionLabel,
  getCurrentGpsPosition,
  isValidCoordinates,
  recordLocationSelection,
} from "../lib/locationTracker";
import { formatDateKolkata, todayKolkata } from "../utils/dates.js";
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

function RecipeDetails({ recipe, onClose, onAddIngredient, onAddToFoodChart }) {
  if (!recipe) return null;
  return (
    <div className="diet-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="diet-modal">
        <header>
          <h2>{recipe.name}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onAddToFoodChart && (
              <button
                type="button"
                className="diet-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: "13px" }}
                title={`Add ${recipe.name} to food chart`}
                aria-label={`Add ${recipe.name} to food chart`}
                onClick={() => {
                  onClose();
                  onAddToFoodChart(recipe);
                }}
              >
                <CalendarClock size={15} /> Add to Food Chart
              </button>
            )}
            <button className="icon-button" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
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

const MEAL_OPTIONS = [
  { value: "Breakfast", label: "Breakfast (Morning)" },
  { value: "Lunch", label: "Lunch (Noon)" },
  { value: "Evening Snacks", label: "Evening Snacks (Afternoon / Evening)" },
  { value: "Dinner", label: "Dinner (Night)" },
];

function AddToFoodChartModal({ recipe, locations, onClose, onSubmit, saving, error }) {
  const [form, setForm] = useState({
    date: todayKolkata(),
    locationId: "",
    meal: "Breakfast",
    servings: recipe?.servings || 2,
  });
  const [autoHint, setAutoHint] = useState("");
  const [scheduledMeals, setScheduledMeals] = useState(new Set());
  const [checkingMeals, setCheckingMeals] = useState(false);

  useEffect(() => {
    if (!recipe) return;
    const recommendedLoc =
      locations.find((loc) => loc.auto_recommended) ||
      locations.find((loc) => loc.is_nearest) ||
      locations.find((loc) => loc.is_most_frequent) ||
      locations[0] ||
      null;

    let defaultMeal = "Breakfast";
    const currentHour = new Date().getHours();
    if (currentHour >= 5 && currentHour < 11) {
      defaultMeal = "Breakfast";
    } else if (currentHour >= 11 && currentHour < 15) {
      defaultMeal = "Lunch";
    } else if (currentHour >= 15 && currentHour < 18) {
      defaultMeal = "Evening Snacks";
    } else if (currentHour >= 18) {
      defaultMeal = "Dinner";
    }

    if (recommendedLoc) {
      setAutoHint(describeAutoMatchReason(recommendedLoc));
    } else {
      setAutoHint("");
    }

    setForm({
      date: todayKolkata(),
      locationId: recommendedLoc ? String(recommendedLoc.id) : "",
      meal: defaultMeal,
      servings: Number(recipe.servings) || 2,
    });
  }, [recipe, locations]);

  // Check food times where this recipe is already scheduled for the selected date & location
  useEffect(() => {
    if (!recipe || !form.date) return;
    let active = true;
    setCheckingMeals(true);
    const dateQuery = encodeURIComponent(String(form.date).slice(0, 10));
    const locQuery = form.locationId ? `&locationId=${encodeURIComponent(form.locationId)}&strictLocation=true` : "";
    api(`/food-chart?date=${dateQuery}${locQuery}`, { silent: true })
      .then((rows) => {
        if (!active) return;
        const busy = new Set();
        const targetId = String(recipe.id || "").trim();
        const targetName = String(recipe.name || "").trim().toLowerCase();
        for (const row of Array.isArray(rows) ? rows : []) {
          const rowRecipe = row.recipe || row.recipe_snapshot || {};
          const rowRecipeId = String(row.recipeId || rowRecipe.id || "").trim();
          const rowRecipeName = String(rowRecipe.name || "").trim().toLowerCase();
          if (
            (targetId && rowRecipeId && targetId === rowRecipeId) ||
            (targetName && rowRecipeName && targetName === rowRecipeName)
          ) {
            if (row.meal) busy.add(row.meal);
          }
        }
        setScheduledMeals(busy);

        // If currently selected meal is already scheduled, automatically switch to first available
        setForm((current) => {
          if (busy.has(current.meal)) {
            const firstAvailable = MEAL_OPTIONS.find((opt) => !busy.has(opt.value));
            if (firstAvailable) {
              return { ...current, meal: firstAvailable.value };
            }
          }
          return current;
        });
      })
      .catch(() => {
        if (active) setScheduledMeals(new Set());
      })
      .finally(() => {
        if (active) setCheckingMeals(false);
      });

    return () => {
      active = false;
    };
  }, [recipe, form.date, form.locationId]);

  if (!recipe) return null;

  return (
    <div
      className="diet-modal-backdrop diet-add-chart-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <form
        className="diet-modal diet-add-chart-modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
      >
        <header>
          <div>
            <h2>Add recipe to Food Chart</h2>
            <p className="diet-muted">
              Add <strong>{recipe.name}</strong> to the food chart for the selected date, location, and meal time.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        {error && <div className="diet-error" style={{ margin: "0 0 10px" }}>{error}</div>}

        <label>
          <span>
            <CalendarDays size={15} /> Date
          </span>
          <input
            required
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            disabled={saving}
          />
        </label>

        <label>
          <span>
            <MapPin size={15} /> Location
          </span>
          <select
            required
            value={form.locationId}
            onChange={(e) => {
              setAutoHint("");
              setForm((f) => ({ ...f, locationId: e.target.value }));
            }}
            disabled={saving}
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
          <span>
            <Clock3 size={15} /> Food taking time
            {checkingMeals && <small className="diet-muted"> (checking availability…)</small>}
          </span>
          <select
            required
            value={form.meal}
            onChange={(e) => setForm((f) => ({ ...f, meal: e.target.value }))}
            disabled={saving || scheduledMeals.size >= MEAL_OPTIONS.length}
          >
            {MEAL_OPTIONS.map((opt) => {
              const isScheduled = scheduledMeals.has(opt.value);
              return (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={isScheduled}
                >
                  {opt.label}{isScheduled ? " — Already scheduled" : ""}
                </option>
              );
            })}
          </select>
          {scheduledMeals.size >= MEAL_OPTIONS.length && (
            <small className="diet-auto-location-hint" style={{ color: "var(--danger, #dc2626)" }}>
              {recipe.name} is already scheduled for all meal times on {form.date}. Choose another date.
            </small>
          )}
          {scheduledMeals.size > 0 && scheduledMeals.size < MEAL_OPTIONS.length && (
            <small className="diet-muted">
              Unavailable for: {[...scheduledMeals].join(", ")} (already scheduled).
            </small>
          )}
        </label>

        <label>
          <span>Servings</span>
          <input
            type="number"
            min="0.25"
            step="0.25"
            value={form.servings}
            onChange={(e) => setForm((f) => ({ ...f, servings: e.target.value }))}
            disabled={saving}
          />
        </label>

        <footer>
          <button
            type="button"
            className="diet-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="diet-primary"
            disabled={
              saving ||
              !form.date ||
              !form.locationId ||
              !form.meal ||
              scheduledMeals.has(form.meal) ||
              scheduledMeals.size >= MEAL_OPTIONS.length
            }
          >
            <CalendarClock size={16} />
            {saving ? "Adding to food chart…" : "Add to Food Chart"}
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
  const [category, setCategory] = useState("All");
  const [page, setPage] = useState(1);
  const [viewer, setViewer] = useState(null);
  const [currentCoords, setCurrentCoords] = useState(null);
  const [marketingCategories, setMarketingCategories] = useState([]);
  const [marketingLocations, setMarketingLocations] = useState([]);
  const [marketingUnits, setMarketingUnits] = useState([]);
  const [addIngredient, setAddIngredient] = useState(null);
  const [addingToMarketing, setAddingToMarketing] = useState(false);
  const [chartRecipe, setChartRecipe] = useState(null);
  const [addingToChart, setAddingToChart] = useState(false);
  const [chartError, setChartError] = useState("");
  const [locations, setLocations] = useState([]);

  const pagination = usePagination("recipe-master", "usageCount", "desc");

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

    fetchLocationsWithGps({ silent: true })
      .then((locBundle) => {
        if (!active) return;
        if (isValidCoordinates(locBundle?.coords)) {
          setCurrentCoords(locBundle.coords);
        }
        if (Array.isArray(locBundle?.locations)) {
          setLocations(locBundle.locations);
          setMarketingLocations(locBundle.locations);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const indexedRecipes = useMemo(() => indexRecipes(recipes), [recipes]);
  const categoryList = useMemo(() => extractCategories(recipes), [recipes]);

  const getRecipeUsageCount = useCallback(
    (recipe) => {
      const serverUsage = Number(recipe?.usageCount ?? recipe?.usage_count ?? 0);
      const clientUsage = Number(localUsage[String(recipe?.id)] || 0);
      return serverUsage + clientUsage;
    },
    [localUsage]
  );

  const filtered = useMemo(() => {
    return searchAndRankRecipes(indexedRecipes, {
      query,
      category,
      sortColumn: pagination.sortColumn,
      sortDirection: pagination.sortDirection,
      getUsageCount: getRecipeUsageCount,
    });
  }, [indexedRecipes, query, category, pagination.sortColumn, pagination.sortDirection, getRecipeUsageCount]);

  const pageSize = Number(pagination.pageSize) || 20;
  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const handleQueryChange = (val) => {
    setQuery(val);
    setPage(1);
  };

  const handleCategoryChange = (cat) => {
    setCategory(cat);
    setPage(1);
  };

  const handleClearFilters = () => {
    setQuery("");
    setCategory("All");
    setPage(1);
  };

  const sortOptions = [
    { value: "name", label: "Recipe Name" },
    { value: "totalTime", label: "Cook + Prep Time" },
    { value: "ingredientCount", label: "Ingredient Count" },
    { value: "usageCount", label: "Most Frequently Used" },
  ];

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

  const openAddToFoodChart = async (recipe) => {
    if (recipe?.id) {
      setLocalUsage(incrementLocalRecipeUsage(recipe.id));
    }
    setChartError("");
    setChartRecipe(recipe);
    if (!locations.length) {
      try {
        const locBundle = await fetchLocationsWithGps({ coords: currentCoords, silent: true });
        if (isValidCoordinates(locBundle?.coords)) {
          setCurrentCoords(locBundle.coords);
        }
        if (Array.isArray(locBundle?.locations)) {
          setLocations(locBundle.locations);
          setMarketingLocations(locBundle.locations);
        }
      } catch {
        // Continue with available state
      }
    }
  };

  const addRecipeToFoodChart = async (values) => {
    if (!chartRecipe?.id) return;
    const date = String(values.date || "").slice(0, 10);
    const locationId = String(values.locationId || "").trim();
    const meal = String(values.meal || "").trim();
    if (!date || !locationId || !meal) {
      showToast("warning", "Please choose a date, location and food taking time.");
      return;
    }
    setAddingToChart(true);
    setChartError("");
    try {
      const coords = isValidCoordinates(currentCoords)
        ? currentCoords
        : await getCurrentGpsPosition({ timeout: 2500 });
      if (isValidCoordinates(coords)) {
        setCurrentCoords(coords);
      }
      await api("/food-chart", {
        method: "POST",
        body: JSON.stringify({
          date,
          locationId,
          meal,
          recipeId: chartRecipe.id,
          servings: Math.max(0.25, Number(values.servings) || Number(chartRecipe.servings) || 2),
          latitude: coords ? coords.latitude : null,
          longitude: coords ? coords.longitude : null,
        }),
      });
      void recordLocationSelection(locationId, { coords, source: "recipe_master_chart_add" });
      showToast("success", `${chartRecipe.name} added to ${meal} on ${formatDateKolkata(date)}.`);
      setChartError("");
      setChartRecipe(null);
    } catch (e) {
      const msg = e.message || `Unable to add ${chartRecipe.name} to the food chart.`;
      setChartError(msg);
      showToast("error", msg);
    } finally {
      setAddingToChart(false);
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
      <div className="diet-search-container">
        <label className="diet-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search recipe, ingredient, category or region…"
          />
          {query && (
            <button
              type="button"
              className="diet-search-clear"
              onClick={() => handleQueryChange("")}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={16} />
            </button>
          )}
          <span className="diet-search-badge">
            {filtered.length} {filtered.length === 1 ? "recipe" : "recipes"}
          </span>
        </label>
        <div className="diet-category-chips">
          {categoryList.map((cat) => (
            <button
              type="button"
              key={cat}
              className={`diet-category-chip${category === cat ? " active" : ""}`}
              onClick={() => handleCategoryChange(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
        {(query || category !== "All") && (
          <div className="diet-search-meta">
            <span>
              Showing {filtered.length} matching {filtered.length === 1 ? "recipe" : "recipes"}
              {category !== "All" ? ` in ${category}` : ""}
              {query ? ` for "${query}"` : ""}
            </span>
            <button type="button" className="diet-clear-filters-btn" onClick={handleClearFilters}>
              Clear filters
            </button>
          </div>
        )}
      </div>
      {loading ? (
        <p>Loading recipes…</p>
      ) : (
        <>
          <div className="diet-recipe-list">
            {paginated.map((recipe) => {
            const usageCount = getRecipeUsageCount(recipe);
            return (
              <article className="diet-recipe-row" key={recipe.id}>
                <div className="diet-recipe-main">
                  <strong>{recipe.name}</strong>
                  <span>
                    {recipe.category} · {recipe.region} · {recipe.ingredients?.length || 0} ingredients · {Number(recipe.prepMinutes || 0) + Number(recipe.cookMinutes || 0)} min
                    {usageCount > 0 && (
                      <span className="diet-usage-badge" style={{ marginLeft: 6 }}>
                        Used {usageCount}x
                      </span>
                    )}
                  </span>
                </div>
                <div className="diet-actions">
                  <button
                    type="button"
                    className="icon-button diet-add-chart-btn"
                    title={`Add ${recipe.name} to food chart`}
                    aria-label={`Add ${recipe.name} to food chart`}
                    onClick={() => openAddToFoodChart(recipe)}
                  >
                    <CalendarClock size={18} />
                  </button>
                  <button
                    type="button"
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
                {query || category !== "All" ? "No recipes match your search criteria." : "No recipes found in the static catalogue."}
              </div>
            )}
          </div>
          {filtered.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Pagination
                page={page}
                setPage={setPage}
                total={filtered.length}
                {...pagination}
                sortOptions={sortOptions}
              />
            </div>
          )}
        </>
      )}
      <RecipeDetails
        recipe={viewer}
        onClose={() => setViewer(null)}
        onAddIngredient={openAddIngredient}
        onAddToFoodChart={openAddToFoodChart}
      />
      <AddIngredientToMarketing
        ingredient={addIngredient}
        categories={marketingCategories}
        locations={marketingLocations}
        units={marketingUnits}
        onClose={() => setAddIngredient(null)}
        onSubmit={addIngredientToMarketing}
        saving={addingToMarketing}
      />
      <AddToFoodChartModal
        recipe={chartRecipe}
        locations={locations.length ? locations : marketingLocations}
        onClose={() => {
          setChartRecipe(null);
          setChartError("");
        }}
        onSubmit={addRecipeToFoodChart}
        saving={addingToChart}
        error={chartError}
      />
    </main>
  );
}