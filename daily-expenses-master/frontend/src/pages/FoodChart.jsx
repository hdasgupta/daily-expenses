import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CalendarDays, LocateFixed, MapPin, Pencil, Plus, Search, ShoppingBasket, Trash2, X } from "lucide-react";
import { api, showToast } from "../lib/api";
import {
  describeAutoMatchReason,
  fetchLocationsWithGps,
  formatLocationOptionLabel,
  getCurrentGpsPosition,
  isValidCoordinates,
  pickBestLocation,
  recordLocationSelection,
} from "../lib/locationTracker";
import { todayKolkata } from "../utils/dates.js";
import { indexRecipes, extractCategories, searchAndRankRecipes } from "../lib/recipeSearch";
import "./dietChart.css";

const meals = ["Breakfast", "Lunch", "Evening Snacks", "Dinner"];
const LOCAL_RECIPE_USAGE_KEY = "recipe-master-usage-counts-v1";
const RECIPES_CACHE_KEY = "de_recipes_catalogue_cache_v1";
const INITIAL_PICKER_LIMIT = 120;

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
    // Ignore storage errors
  }
  return next;
}

function readCachedRecipes() {
  try {
    const raw = localStorage.getItem(RECIPES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedRecipes(list) {
  try {
    if (Array.isArray(list) && list.length) {
      localStorage.setItem(RECIPES_CACHE_KEY, JSON.stringify(list));
    }
  } catch {
    // Ignore quota errors
  }
}

function resolveEntryRecipe(entry, recipesMap) {
  if (!entry) return null;
  const snapshot = entry.recipe || entry.recipe_snapshot || null;
  const id = String(entry.recipeId ?? entry.recipe_id ?? snapshot?.id ?? "");
  if (id && recipesMap?.has(id)) {
    const master = recipesMap.get(id);
    return {
      ...master,
      ...(snapshot || {}),
      ingredients: snapshot?.ingredients?.length ? snapshot.ingredients : master.ingredients || [],
      steps: snapshot?.steps?.length ? snapshot.steps : master.steps || [],
    };
  }
  return snapshot;
}

function scaleQuantity(rawQuantity, factor) {
  const text = String(rawQuantity || "").trim();
  if (!text) return "";
  const num = Number(text);
  if (Number.isFinite(num)) {
    const scaled = Math.round(num * factor * 100) / 100;
    return String(scaled);
  }
  return text;
}

function RecipeViewer({ entry, recipe, onClose, onAddIngredient }) {
  if (!entry || !recipe) return null;
  const baseServings = Number(recipe.servings) || 2;
  const plannedServings = Number(entry.servings) || baseServings;
  const factor = plannedServings / baseServings;

  return (
    <div className="diet-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="diet-modal">
        <header>
          <div>
            <h2>{recipe.name}</h2>
            <p className="diet-muted">
              {recipe.category} · {recipe.region} · Planned for {entry.meal} ({plannedServings} servings)
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div>
          <h3>Ingredients (for {plannedServings} servings)</h3>
          <div className="diet-ingredients">
            {(recipe.ingredients || []).map((x, idx) => {
              const scaledQty = scaleQuantity(x.quantity, factor);
              return (
                <div className="diet-view-ingredient" key={`${x.name}-${idx}`}>
                  <span>{x.name}</span>
                  <strong>{[scaledQty, x.unit].filter(Boolean).join(" ") || "As needed"}</strong>
                  <button
                    type="button"
                    className="icon-button diet-add-marketing-item"
                    title={`Add ${x.name} to marketing list`}
                    aria-label={`Add ${x.name} to marketing list`}
                    onClick={() => onAddIngredient({ ...x, quantity: scaledQty })}
                  >
                    <ShoppingBasket size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h3>Preparation Steps</h3>
          <ol className="diet-steps">
            {(recipe.steps || []).map((s, idx) => (
              <li key={idx}>
                <strong>{s.section || `Step ${idx + 1}`}</strong>
                {s.minutes ? <span className="diet-time">({s.minutes} min)</span> : null}
                <p>{s.text}</p>
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

function AddIngredientToMarketing({ ingredient, defaultDate, defaultLocationId, categories, locations, units, onClose, onSubmit, saving }) {
  const [form, setForm] = useState({
    itemName: "",
    quantity: "",
    unitId: "",
    categoryId: "",
    locationId: "",
    purchaseDate: defaultDate || todayKolkata(),
  });

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
      (locations || []).find((l) => String(l.id) === String(defaultLocationId)) ||
      (locations || []).find((l) => l.auto_recommended) ||
      (locations || [])[0];

    const defaultCategory = (categories || [])[0];

    setForm({
      itemName: String(ingredient.name || "").trim(),
      quantity: defaultQty,
      unitId: matchedUnit ? String(matchedUnit.id) : "",
      categoryId: defaultCategory ? String(defaultCategory.id) : "",
      locationId: bestLoc ? String(bestLoc.id) : "",
      purchaseDate: defaultDate || todayKolkata(),
    });
  }, [ingredient, defaultDate, defaultLocationId, categories, locations, units]);

  if (!ingredient) return null;

  return (
    <div className="diet-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="diet-modal diet-marketing-modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
      >
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
              onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
            >
              <option value="">Select location</option>
              {(locations || []).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {formatLocationOptionLabel(loc)}
                </option>
              ))}
            </select>
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

export default function FoodChart() {
  const [date, setDate] = useState(todayKolkata());
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState([]);
  const [currentCoords, setCurrentCoords] = useState(null);
  const [autoLocationHint, setAutoLocationHint] = useState("");
  const [detectingGps, setDetectingGps] = useState(false);

  const [entries, setEntries] = useState([]);
  const [recipes, setRecipes] = useState(readCachedRecipes);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [localUsage, setLocalUsage] = useState(readLocalRecipeUsage);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [pickerLimit, setPickerLimit] = useState(INITIAL_PICKER_LIMIT);
  const [meal, setMeal] = useState("Breakfast");
  const [query, setQuery] = useState("");
  const [pickerCategory, setPickerCategory] = useState("All");
  const [viewer, setViewer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [marketingCategories, setMarketingCategories] = useState([]);
  const [marketingLocations, setMarketingLocations] = useState([]);
  const [marketingUnits, setMarketingUnits] = useState([]);
  const [addIngredient, setAddIngredient] = useState(null);
  const [addingToMarketing, setAddingToMarketing] = useState(false);
  const userChoseLocationRef = useRef(false);
  const hasEntriesForDateRef = useRef(false);

  const loadRecipesCatalogue = useCallback(async (silent = false) => {
    setRecipesLoading(true);
    try {
      const master = await api("/recipes", { silent });
      if (Array.isArray(master) && master.length) {
        setRecipes(master);
        writeCachedRecipes(master);
      }
    } catch (e) {
      if (!silent) {
        setError(e.message || "Unable to load recipes");
      }
    } finally {
      setRecipesLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadRecipesCatalogue(true);

    (async () => {
      try {
        const locBundle = await fetchLocationsWithGps({ silent: true, fastInitial: true });
        if (!active) return;
        const locList = Array.isArray(locBundle?.locations) ? locBundle.locations : [];
        setLocations(locList);
        if (isValidCoordinates(locBundle?.coords)) {
          setCurrentCoords(locBundle.coords);
        }
        if (locBundle?.bestLocation && !userChoseLocationRef.current) {
          setLocationId(String(locBundle.bestLocation.id));
          setAutoLocationHint(describeAutoMatchReason(locBundle.bestLocation));
        }

        if (!isValidCoordinates(locBundle?.coords)) {
          const freshCoords = await getCurrentGpsPosition({ timeout: 3500 });
          if (!active || !isValidCoordinates(freshCoords)) return;
          setCurrentCoords(freshCoords);
          const refreshed = await fetchLocationsWithGps({ coords: freshCoords, silent: true });
          if (!active || !Array.isArray(refreshed?.locations)) return;
          setLocations(refreshed.locations);
          if (refreshed.bestLocation && !userChoseLocationRef.current && !hasEntriesForDateRef.current) {
            setLocationId(String(refreshed.bestLocation.id));
            setAutoLocationHint(describeAutoMatchReason(refreshed.bestLocation));
          }
        }
      } catch {
        // Ignore location auto-fetch errors
      }
    })();

    return () => {
      active = false;
    };
  }, [loadRecipesCatalogue]);

  useEffect(() => {
    if (adding && recipes.length === 0 && !recipesLoading) {
      void loadRecipesCatalogue(false);
    }
  }, [adding, recipes.length, recipesLoading, loadRecipesCatalogue]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const strictFlag = userChoseLocationRef.current ? "&strictLocation=true" : "";
    api(
      `/food-chart?date=${encodeURIComponent(date)}&locationId=${encodeURIComponent(
        locationId || ""
      )}${strictFlag}`
    )
      .then((chart) => {
        if (!active) return;
        const list = Array.isArray(chart) ? chart : [];
        hasEntriesForDateRef.current = list.length > 0;
        setEntries(list);
        if (!userChoseLocationRef.current && list.length > 0) {
          const entryLoc = list.find((item) => item?.locationId != null)?.locationId;
          if (entryLoc != null && String(entryLoc) !== String(locationId)) {
            setLocationId(String(entryLoc));
          }
        }
        setError("");
      })
      .catch((e) => {
        if (active) setError(e.message || "Unable to load food chart");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [date, locationId]);

  const handleAutoDetectLocation = async () => {
    setDetectingGps(true);
    try {
      const coords = await getCurrentGpsPosition({ timeout: 5000, forceFresh: true });
      if (isValidCoordinates(coords)) {
        setCurrentCoords(coords);
      }
      const refreshed = await fetchLocationsWithGps({ coords, silent: true });
      if (Array.isArray(refreshed?.locations)) {
        setLocations(refreshed.locations);
      }
      if (refreshed?.bestLocation) {
        userChoseLocationRef.current = false;
        setLocationId(String(refreshed.bestLocation.id));
        const reason = describeAutoMatchReason(refreshed.bestLocation);
        setAutoLocationHint(reason);
        showToast("success", `${refreshed.bestLocation.name} selected (${reason}).`);
      }
    } catch (e) {
      showToast("warning", e.message || "Unable to auto-detect location.");
    } finally {
      setDetectingGps(false);
    }
  };

  const recipesMap = useMemo(
    () => new Map(recipes.map((r) => [String(r.id), r])),
    [recipes]
  );

  const isRecipeAlreadyInMeal = useCallback(
    (recipe, targetMeal = meal) => {
      if (!recipe) return false;
      const targetId = String(recipe.id || "").trim();
      const targetName = String(recipe.name || "").trim().toLowerCase();
      const effectiveLoc = locationId ? String(locationId).trim() : "";
      return entries.some((entry) => {
        if (entry.meal !== targetMeal) return false;
        if (effectiveLoc) {
          const entryLoc = entry.locationId != null ? String(entry.locationId).trim() : "";
          if (entryLoc && entryLoc !== effectiveLoc) return false;
        }
        const resolved = resolveEntryRecipe(entry, recipesMap);
        const entryId = String(entry.recipeId ?? entry.recipe_id ?? resolved?.id ?? entry.recipe?.id ?? "").trim();
        const entryName = String(resolved?.name || entry.recipe?.name || "").trim().toLowerCase();
        if (targetId && entryId && targetId === entryId) return true;
        if (targetName && entryName && targetName === entryName) return true;
        return false;
      });
    },
    [entries, meal, locationId, recipesMap]
  );

  const getRecipeUsageCount = useCallback(
    (recipe) => {
      const serverUsage = Number(recipe?.usageCount ?? recipe?.usage_count ?? 0);
      const clientUsage = Number(localUsage[String(recipe?.id)] || 0);
      return serverUsage + clientUsage;
    },
    [localUsage]
  );

  const indexedRecipes = useMemo(() => indexRecipes(recipes), [recipes]);
  const pickerCategories = useMemo(() => extractCategories(recipes), [recipes]);

  const filteredRecipes = useMemo(() => {
    return searchAndRankRecipes(indexedRecipes, {
      query,
      category: pickerCategory,
      sortColumn: "usageCount",
      sortDirection: "desc",
      getUsageCount: getRecipeUsageCount,
    });
  }, [indexedRecipes, query, pickerCategory, getRecipeUsageCount]);

  const visiblePickerRecipes = useMemo(
    () => filteredRecipes.slice(0, pickerLimit),
    [filteredRecipes, pickerLimit]
  );

  const add = async (recipe) => {
    if (isRecipeAlreadyInMeal(recipe, meal)) {
      const msg = `"${recipe.name}" is already planned for ${meal} on this date and location. Duplicate entries are not allowed for the same timing.`;
      setError(msg);
      showToast("warning", msg);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const coords = isValidCoordinates(currentCoords)
        ? currentCoords
        : await getCurrentGpsPosition({ timeout: 2500 });
      if (isValidCoordinates(coords)) {
        setCurrentCoords(coords);
      }
      const effectiveLocationId =
        locationId || (locations[0]?.id != null ? String(locations[0].id) : "");
      const result = await api("/food-chart", {
        method: "POST",
        body: JSON.stringify({
          date,
          locationId: effectiveLocationId,
          meal,
          recipeId: recipe.id,
          servings: recipe.servings || 2,
          latitude: coords ? coords.latitude : null,
          longitude: coords ? coords.longitude : null,
        }),
      });
      if (recipe?.id) {
        setLocalUsage(incrementLocalRecipeUsage(recipe.id));
      }
      if (effectiveLocationId) {
        void recordLocationSelection(effectiveLocationId, { coords, source: "food_chart_add" });
      }
      hasEntriesForDateRef.current = true;
      setEntries((old) => [...old, result]);
      setAdding(false);
      setQuery("");
      setError("");
    } catch (e) {
      setError(e.message || "Unable to add recipe");
    } finally {
      setSaving(false);
    }
  };

  const edit = async (entry) => {
    const value = window.prompt("How many servings should this recipe make?", String(entry.servings || 2));
    if (value === null) return;
    const servings = Number(value);
    if (!Number.isFinite(servings) || servings <= 0) {
      setError("Enter a serving quantity greater than zero.");
      return;
    }
    try {
      const updated = await api(`/food-chart/${entry.id}`, {
        method: "PUT",
        body: JSON.stringify({ servings }),
      });
      setEntries((old) => old.map((x) => (String(x.id) === String(entry.id) ? updated : x)));
    } catch (e) {
      setError(e.message || "Unable to update servings");
    }
  };

  const remove = async (entry) => {
    try {
      await api(`/food-chart/${entry.id}`, { method: "DELETE" });
      setEntries((old) => old.filter((x) => String(x.id) !== String(entry.id)));
    } catch (e) {
      setError(e.message || "Unable to remove recipe");
    }
  };

  const openAddIngredient = async (ingredient) => {
    setAddIngredient({ ...ingredient, name: String(ingredient?.name || "").trim() });
    try {
      const [categoriesResult, locBundle, unitsResult] = await Promise.all([
        api("/meta/categories"),
        fetchLocationsWithGps({ coords: currentCoords, silent: true }),
        api("/meta/units"),
      ]);
      setMarketingCategories(Array.isArray(categoriesResult) ? categoriesResult : []);
      setMarketingLocations(Array.isArray(locBundle?.locations) ? locBundle.locations : []);
      setMarketingUnits(Array.isArray(unitsResult) ? unitsResult : []);
    } catch (e) {
      showToast("error", e.message || "Unable to load marketing metadata.");
    }
  };

  const addIngredientToMarketing = async (values) => {
    const itemName = String(values.itemName || "").trim();
    if (!itemName || !values.purchaseDate || !values.locationId || !values.categoryId) {
      showToast("warning", "Choose a date, location and category, and enter an ingredient.");
      return;
    }
    setAddingToMarketing(true);
    try {
      const coords = isValidCoordinates(currentCoords)
        ? currentCoords
        : await getCurrentGpsPosition({ timeout: 2500 });
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
      void recordLocationSelection(values.locationId, { coords, source: "food_chart_ingredient" });
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
          <h1>Food Chart</h1>
          <p>Plan daily meals by location and scale ingredients automatically.</p>
        </div>
        <button
          className="diet-primary"
          onClick={() => {
            setMeal("Breakfast");
            setPickerLimit(INITIAL_PICKER_LIMIT);
            setPickerCategory("All");
            setAdding(true);
          }}
        >
          <Plus size={17} /> Add Recipe
        </button>
      </div>

      {error && <div className="diet-error">{error}</div>}

      <div className="diet-date-bar">
        <CalendarDays size={18} />
        <label htmlFor="diet-date">Date</label>
        <input
          id="diet-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        <MapPin size={18} style={{ marginLeft: 8 }} />
        <label htmlFor="diet-location">Location</label>
        <select
          id="diet-location"
          value={locationId}
          onChange={(e) => {
            userChoseLocationRef.current = true;
            setLocationId(e.target.value);
            setAutoLocationHint("Manually selected");
          }}
        >
          <option value="">All locations</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {formatLocationOptionLabel(loc)}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="diet-secondary diet-gps-btn"
          onClick={handleAutoDetectLocation}
          disabled={detectingGps}
          title="Auto-select location using GPS and usage frequency"
        >
          <LocateFixed size={15} /> {detectingGps ? "Detecting…" : "Auto GPS"}
        </button>

        {autoLocationHint ? <span className="diet-auto-location-hint">{autoLocationHint}</span> : null}
        <span>{entries.length} planned recipes</span>
      </div>

      {loading ? (
        <p>Loading food chart…</p>
      ) : (
        <div className="diet-meals">
          {meals.map((m) => {
            const list = entries.filter((x) => x.meal === m);
            return (
              <section className="diet-meal-card" key={m}>
                <header>
                  <h2>{m}</h2>
                  <span>{list.length} items</span>
                  <button
                    className="diet-secondary diet-add-meal"
                    onClick={() => {
                      setMeal(m);
                      setPickerLimit(INITIAL_PICKER_LIMIT);
                      setPickerCategory("All");
                      setAdding(true);
                      setQuery("");
                    }}
                  >
                    <Plus size={15} /> Add
                  </button>
                </header>
                {list.length ? (
                  <div className="diet-meal-entries">
                    {list.map((entry) => {
                      const resolved = resolveEntryRecipe(entry, recipesMap);
                      return (
                        <article className="diet-recipe-row" key={entry.id}>
                          <div className="diet-recipe-main">
                            <strong>{resolved?.name || "Recipe"}</strong>
                            <span>
                              {entry.servings} servings · {resolved?.category || "Dish"}
                            </span>
                          </div>
                          <div className="diet-actions">
                            <button
                              className="icon-button"
                              title="View recipe"
                              onClick={() => setViewer({ entry, recipe: resolved })}
                            >
                              <BookOpen size={17} />
                            </button>
                            <button
                              className="icon-button"
                              title="Edit servings"
                              onClick={() => edit(entry)}
                            >
                              <Pencil size={17} />
                            </button>
                            <button
                              className="icon-button danger"
                              title="Remove from meal"
                              onClick={() => remove(entry)}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="diet-empty">No recipes planned for {m.toLowerCase()}.</p>
                )}
              </section>
            );
          })}
        </div>
      )}
      {adding && (
        <div className="diet-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAdding(false)}>
          <section className="diet-modal diet-picker">
            <header>
              <div>
                <h2>Add Recipe</h2>
                <p className="diet-muted">
                  {date} · {locations.find((x) => String(x.id) === String(locationId))?.name || "All locations"} · Choose the meal and recipe to add.
                </p>
              </div>
              <button className="icon-button" onClick={() => setAdding(false)} aria-label="Close">
                <X size={18} />
              </button>
            </header>
            <label>
              Meal section
              <select value={meal} onChange={(e) => setMeal(e.target.value)}>
                {meals.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="diet-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPickerLimit(INITIAL_PICKER_LIMIT);
                }}
                placeholder="Search recipe, ingredient, category or region…"
              />
              {query && (
                <button
                  type="button"
                  className="diet-search-clear"
                  onClick={() => {
                    setQuery("");
                    setPickerLimit(INITIAL_PICKER_LIMIT);
                  }}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X size={15} />
                </button>
              )}
              <span className="diet-search-badge">
                {filteredRecipes.length} {filteredRecipes.length === 1 ? "match" : "matches"}
              </span>
            </label>
            <div className="diet-category-chips diet-picker-chips">
              {pickerCategories.map((cat) => (
                <button
                  type="button"
                  key={cat}
                  className={`diet-category-chip${pickerCategory === cat ? " active" : ""}`}
                  onClick={() => {
                    setPickerCategory(cat);
                    setPickerLimit(INITIAL_PICKER_LIMIT);
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
            {(query || pickerCategory !== "All") && (
              <div className="diet-search-meta" style={{ margin: "-2px 0 10px" }}>
                <span>
                  Showing {filteredRecipes.length} {filteredRecipes.length === 1 ? "match" : "matches"}
                  {pickerCategory !== "All" ? ` in ${pickerCategory}` : ""}
                  {query ? ` for "${query}"` : ""}
                </span>
                <button
                  type="button"
                  className="diet-clear-filters-btn"
                  onClick={() => {
                    setQuery("");
                    setPickerCategory("All");
                    setPickerLimit(INITIAL_PICKER_LIMIT);
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
            <div className="diet-picker-list">
              {recipesLoading && !recipes.length ? (
                <p className="diet-empty">Loading recipes…</p>
              ) : (
                <>
                  {visiblePickerRecipes.map((r) => {
                    const usageCount = getRecipeUsageCount(r);
                    const isDuplicate = isRecipeAlreadyInMeal(r, meal);
                    return (
                      <div
                        className={`diet-picker-item${isDuplicate ? " is-duplicate-item" : ""}`}
                        key={r.id}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <strong>{r.name}</strong>
                            {isDuplicate && (
                              <span className="diet-duplicate-badge">
                                Already planned for {meal}
                              </span>
                            )}
                          </div>
                          <span>
                            {r.category} · {r.region} · {r.ingredients?.length || 0} ingredients
                            {usageCount > 0 && (
                              <span className="diet-usage-badge" style={{ marginLeft: 6 }}>
                                Used {usageCount}x
                              </span>
                            )}
                          </span>
                        </div>
                        <button
                          className={isDuplicate ? "diet-secondary" : "diet-primary"}
                          disabled={saving || isDuplicate}
                          title={
                            isDuplicate
                              ? `"${r.name}" is already planned for ${meal} on this date and location`
                              : `Add ${r.name} to ${meal}`
                          }
                          onClick={() => add(r)}
                        >
                          {saving ? "Adding…" : isDuplicate ? "Added" : "Add"}
                        </button>
                      </div>
                    );
                  })}
                  {filteredRecipes.length > visiblePickerRecipes.length && (
                    <div className="diet-picker-more">
                      <button
                        type="button"
                        className="diet-secondary"
                        onClick={() => setPickerLimit((n) => n + INITIAL_PICKER_LIMIT)}
                      >
                        Show more recipes ({filteredRecipes.length - visiblePickerRecipes.length} more)
                      </button>
                    </div>
                  )}
                  {!filteredRecipes.length && (
                    <div className="diet-empty">
                      <p style={{ margin: "0 0 8px" }}>
                        {query ? "No matching recipes found." : "Unable to load recipes."}
                      </p>
                      {!query && (
                        <button
                          type="button"
                          className="diet-secondary"
                          onClick={() => void loadRecipesCatalogue(false)}
                        >
                          Retry loading recipes
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}

      <RecipeViewer
        entry={viewer?.entry}
        recipe={viewer?.recipe}
        onClose={() => setViewer(null)}
        onAddIngredient={openAddIngredient}
      />

      <AddIngredientToMarketing
        ingredient={addIngredient}
        defaultDate={date}
        defaultLocationId={locationId}
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
