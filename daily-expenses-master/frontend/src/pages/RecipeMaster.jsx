import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const MEAL_OPTIONS = ["Breakfast", "Lunch", "Evening Snacks", "Dinner"];

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
  const key = String(recipeId || "");
  if (!key) return readLocalRecipeUsage();
  const current = readLocalRecipeUsage();
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
  const prepMinutes = Number(recipe.prepMinutes) || 0;
  const cookMinutes = Number(recipe.cookMinutes) || 0;

  return (
    <div className="diet-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="diet-modal">
        <header>
          <div>
            <h2>{recipe.name}</h2>
            <p className="diet-muted">
              {recipe.category} · {recipe.region} · Prep {prepMinutes} min · Cook {cookMinutes} min · Serves {recipe.servings || 2}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {onAddToFoodChart && (
              <button
                type="button"
                className="diet-secondary"
                onClick={() => onAddToFoodChart(recipe)}
                title={`Add ${recipe.name} to food chart`}
              >
                <CalendarClock size={16} /> Add to Food Chart
              </button>
            )}
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>

        <div>
          <h3>Ingredients</h3>
          <div className="diet-ingredients">
            {(recipe.ingredients || []).map((ingredient, index) => (
              <div className="diet-view-ingredient" key={`${ingredient.name}-${index}`}>
                <span>{ingredient.name}</span>
                <strong>{[ingredient.quantity, ingredient.unit].filter(Boolean).join(" ") || "As needed"}</strong>
                <button
                  type="button"
                  className="icon-button diet-add-marketing-item"
                  title={`Add ${ingredient.name} to marketing list`}
                  aria-label={`Add ${ingredient.name} to marketing list`}
                  onClick={() => onAddIngredient(ingredient, recipe)}
                >
                  <ShoppingBasket size={17} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3>Preparation Steps</h3>
          <ol className="diet-steps">
            {(recipe.steps || []).map((step, index) => (
              <li key={index}>
                <strong>{step.section || `Step ${index + 1}`}</strong>
                {step.minutes ? <span className="diet-time">({step.minutes} min)</span> : null}
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>

        {recipe.notes ? (
          <div>
            <h3>Chef Notes</h3>
            <p className="diet-muted">{recipe.notes}</p>
          </div>
        ) : null}

        <footer>
          <button type="button" className="diet-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

function AddIngredientToMarketing({ ingredient, categories, locations, units, onClose, onSubmit, saving }) {
  const [form, setForm] = useState({
    itemName: "",
    quantity: "",
    unitId: "",
    categoryId: "",
    locationId: "",
    purchaseDate: todayKolkata(),
  });
  const [autoLocationReason, setAutoLocationReason] = useState("");

  useEffect(() => {
    if (!ingredient) return;
    const rawQty = String(ingredient.quantity || "").trim();
    const numericMatch = rawQty.match(/^\d+(\.\d+)?$/);
    const defaultQty = numericMatch ? rawQty : "";

    const rawUnit = String(ingredient.unit || "").trim().toLowerCase();
    const matchedUnit = (units || []).find(
      (u) => String(u.name || "").trim().toLowerCase() === rawUnit || String(u.symbol || "").trim().toLowerCase() === rawUnit
    );

    const bestLoc =
      (locations || []).find((l) => l.auto_recommended) ||
      (locations || []).find((l) => l.is_nearest) ||
      (locations || []).find((l) => l.is_most_frequent) ||
      (locations || [])[0];

    const defaultCategory = (categories || [])[0];

    setForm({
      itemName: String(ingredient.name || "").trim(),
      quantity: defaultQty,
      unitId: matchedUnit ? String(matchedUnit.id) : "",
      categoryId: defaultCategory ? String(defaultCategory.id) : "",
      locationId: bestLoc ? String(bestLoc.id) : "",
      purchaseDate: todayKolkata(),
    });
    setAutoLocationReason(bestLoc ? describeAutoMatchReason(bestLoc) : "");
  }, [ingredient, categories, locations, units]);

  if (!ingredient) return null;

  const submit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <div className="diet-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="diet-modal diet-marketing-modal" onSubmit={submit}>
        <header>
          <div>
            <h2>Add to Marketing List</h2>
            <p className="diet-muted">Schedule this ingredient for purchase.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <label>
          <span>Ingredient name</span>
          <input
            required
            value={form.itemName}
            onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))}
          />
        </label>

        <div className="diet-form-grid">
          <label>
            <span>
              <CalendarDays size={15} /> Purchase Date
            </span>
            <input
              type="date"
              required
              value={form.purchaseDate}
              onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))}
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
                setForm((f) => ({ ...f, locationId: e.target.value }));
                setAutoLocationReason("");
              }}
            >
              <option value="">Select location</option>
              {(locations || []).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {formatLocationOptionLabel(loc)}
                </option>
              ))}
            </select>
            {autoLocationReason ? <small className="diet-auto-location-hint">{autoLocationReason}</small> : null}
          </label>
        </div>

        <label>
          <span>Category</span>
          <select
            required
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
          >
            <option value="">Select category</option>
            {(categories || []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <div className="diet-form-grid">
          <label>
            <span>Quantity (optional)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              placeholder={ingredient.quantity ? `Recipe uses ${ingredient.quantity}` : "Optional"}
            />
          </label>

          <label>
            <span>Unit (optional)</span>
            <select
              value={form.unitId}
              onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}
            >
              <option value="">Select unit</option>
              {(units || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <footer>
          <button type="button" className="diet-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="diet-primary" disabled={saving}>
            <Plus size={16} /> {saving ? "Adding…" : "Add to Marketing List"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function AddToFoodChartModal({ recipe, locations, onClose, onSubmit, saving, error }) {
  const [form, setForm] = useState({
    date: todayKolkata(),
    locationId: "",
    meal: "Lunch",
    servings: 2,
  });
  const [autoLocationReason, setAutoLocationReason] = useState("");
  const [scheduledMeals, setScheduledMeals] = useState([]);
  const [checkingSchedule, setCheckingSchedule] = useState(false);

  useEffect(() => {
    if (!recipe) return;
    const bestLoc =
      (locations || []).find((l) => l.auto_recommended) ||
      (locations || []).find((l) => l.is_nearest) ||
      (locations || []).find((l) => l.is_most_frequent) ||
      (locations || [])[0];

    setForm({
      date: todayKolkata(),
      locationId: bestLoc ? String(bestLoc.id) : "",
      meal: "Lunch",
      servings: Number(recipe.servings) || 2,
    });
    setAutoLocationReason(bestLoc ? describeAutoMatchReason(bestLoc) : "");
  }, [recipe, locations]);

  useEffect(() => {
    if (!recipe || !form.date) {
      setScheduledMeals([]);
      return undefined;
    }
    let active = true;
    setCheckingSchedule(true);
    const dateQuery = encodeURIComponent(String(form.date).slice(0, 10));
    const locQuery = form.locationId ? `&locationId=${encodeURIComponent(form.locationId)}&strictLocation=true` : "";

    api(`/food-chart?date=${dateQuery}${locQuery}`, { silent: true })
      .then((entries) => {
        if (!active) return;
        const list = Array.isArray(entries) ? entries : [];
        const targetId = String(recipe.id || "").trim();
        const targetName = String(recipe.name || "").trim().toLowerCase();

        const taken = list
          .filter((entry) => {
            const entryId = String(entry.recipeId ?? entry.recipe_id ?? entry.recipe?.id ?? "").trim();
            const entryName = String(entry.recipe?.name || "").trim().toLowerCase();
            return (targetId && entryId === targetId) || (targetName && entryName === targetName);
          })
          .map((entry) => entry.meal);

        const uniqueTaken = Array.from(new Set(taken));
        setScheduledMeals(uniqueTaken);

        setForm((curr) => {
          if (uniqueTaken.includes(curr.meal)) {
            const firstAvailable = MEAL_OPTIONS.find((m) => !uniqueTaken.includes(m));
            return { ...curr, meal: firstAvailable || curr.meal };
          }
          return curr;
        });
      })
      .catch(() => {
        if (active) setScheduledMeals([]);
      })
      .finally(() => {
        if (active) setCheckingSchedule(false);
      });

    return () => {
      active = false;
    };
  }, [recipe, form.date, form.locationId]);

  if (!recipe) return null;

  const allMealsTaken = MEAL_OPTIONS.every((m) => scheduledMeals.includes(m));

  const submit = (e) => {
    e.preventDefault();
    if (allMealsTaken || scheduledMeals.includes(form.meal)) return;
    onSubmit(form);
  };

  return (
    <div className="diet-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="diet-modal diet-add-chart-modal" onSubmit={submit}>
        <header>
          <div>
            <h2>Add to Food Chart</h2>
            <p className="diet-muted">{recipe.name}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {error ? <div className="diet-error">{error}</div> : null}

        <div className="diet-form-grid">
          <label>
            <span>
              <CalendarDays size={15} /> Date
            </span>
            <input
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </label>

          <label>
            <span>
              <MapPin size={15} /> Location (GPS enabled)
            </span>
            <select
              required
              value={form.locationId}
              onChange={(e) => {
                setForm((f) => ({ ...f, locationId: e.target.value }));
                setAutoLocationReason("");
              }}
            >
              <option value="">Select location</option>
              {(locations || []).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {formatLocationOptionLabel(loc)}
                </option>
              ))}
            </select>
            {autoLocationReason ? <small className="diet-auto-location-hint">{autoLocationReason}</small> : null}
          </label>
        </div>

        <div className="diet-form-grid">
          <label>
            <span>
              <Clock3 size={15} /> Food taking time
            </span>
            <select
              required
              value={form.meal}
              onChange={(e) => setForm((f) => ({ ...f, meal: e.target.value }))}
              disabled={checkingSchedule || allMealsTaken}
            >
              {MEAL_OPTIONS.map((mealOption) => {
                const isTaken = scheduledMeals.includes(mealOption);
                return (
                  <option key={mealOption} value={mealOption} disabled={isTaken}>
                    {mealOption}
                    {isTaken ? " — Already scheduled" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          <label>
            <span>Servings</span>
            <input
              type="number"
              min="0.25"
              step="0.25"
              required
              value={form.servings}
              onChange={(e) => setForm((f) => ({ ...f, servings: e.target.value }))}
            />
          </label>
        </div>

        {scheduledMeals.length > 0 && (
          <small className="diet-muted">
            Already scheduled on this date & location for: <strong>{scheduledMeals.join(", ")}</strong>
          </small>
        )}

        <footer>
          <button type="button" className="diet-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            className="diet-primary"
            disabled={saving || checkingSchedule || allMealsTaken || scheduledMeals.includes(form.meal)}
          >
            <Plus size={16} /> {saving ? "Adding…" : "Submit"}
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
  const [sortColumn, setSortColumn] = useState("usageCount");
  const [sortDirection, setSortDirection] = useState("desc");
  const [visibleCount, setVisibleCount] = useState(30);
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
  const sentinelRef = useRef(null);

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
      sortColumn,
      sortDirection,
      getUsageCount: getRecipeUsageCount,
    });
  }, [indexedRecipes, query, category, sortColumn, sortDirection, getRecipeUsageCount]);

  const visibleRecipes = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );

  const hasMore = visibleCount < filtered.length;

  useEffect(() => {
    if (!hasMore || loading) return undefined;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + 30, filtered.length));
        }
      },
      { root: null, rootMargin: "320px 0px", threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, filtered.length, visibleCount]);

  const handleQueryChange = (val) => {
    setQuery(val);
    setVisibleCount(30);
  };

  const handleCategoryChange = (cat) => {
    setCategory(cat);
    setVisibleCount(30);
  };

  const handleClearFilters = () => {
    setQuery("");
    setCategory("All");
    setVisibleCount(30);
  };

  const sortOptions = [
    { value: "usageCount", label: "Most Used in Food Chart" },
    { value: "name", label: "Recipe Name (A–Z)" },
    { value: "totalTime", label: "Cook + Prep Time" },
    { value: "ingredientCount", label: "Ingredient Count" },
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
        <div className="diet-search-meta">
          <span>
            Showing <strong>{visibleRecipes.length}</strong> of <strong>{filtered.length}</strong> {filtered.length === 1 ? "recipe" : "recipes"}
            {category !== "All" ? ` in ${category}` : ""}
            {query ? ` matching "${query}"` : ""}
          </span>
          <div className="diet-sort-bar">
            {(query || category !== "All") && (
              <button type="button" className="diet-clear-filters-btn" onClick={handleClearFilters}>
                Clear filters
              </button>
            )}
            <label className="diet-sort-label">
              <span>Sort:</span>
              <select
                value={sortColumn}
                onChange={(e) => {
                  const col = e.target.value;
                  setSortColumn(col);
                  setSortDirection(col === "usageCount" ? "desc" : "asc");
                  setVisibleCount(30);
                }}
              >
                {sortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="diet-secondary diet-sort-dir-btn"
              title={sortDirection === "asc" ? "Ascending order" : "Descending order"}
              onClick={() => {
                setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
                setVisibleCount(30);
              }}
            >
              {sortDirection === "asc" ? "↑ Asc" : "↓ Desc"}
            </button>
          </div>
        </div>
      </div>
      {loading ? (
        <p>Loading recipes…</p>
      ) : (
        <>
          <div className="diet-recipe-list">
            {visibleRecipes.map((recipe) => {
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
          {hasMore && (
            <div ref={sentinelRef} className="diet-scroll-sentinel">
              <span className="diet-scroll-loader">
                Loading more recipes ({visibleRecipes.length} of {filtered.length})…
              </span>
              <button
                type="button"
                className="diet-secondary"
                onClick={() => setVisibleCount((prev) => Math.min(prev + 30, filtered.length))}
              >
                Load more ({filtered.length - visibleRecipes.length} remaining)
              </button>
            </div>
          )}
          {!hasMore && filtered.length > 30 && (
            <div className="diet-scroll-end">
              All {filtered.length} recipes loaded
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
