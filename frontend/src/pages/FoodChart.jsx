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
  if (!recipeId) return readLocalRecipeUsage();
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

function readCachedRecipes() {
  try {
    const raw = sessionStorage.getItem(RECIPES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedRecipes(list) {
  try {
    if (Array.isArray(list) && list.length) {
      sessionStorage.setItem(RECIPES_CACHE_KEY, JSON.stringify(list));
    }
  } catch {
    // Ignore sessionStorage quota errors
  }
}

function resolveEntryRecipe(entry, recipesMap) {
  let r = entry?.recipe ?? entry?.recipe_snapshot ?? null;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      r = null;
    }
  }
  const fallbackId = entry?.recipeId ?? entry?.recipe_id ?? r?.id;
  const fallback = fallbackId != null ? recipesMap.get(String(fallbackId)) : null;
  if (r && typeof r === "object" && (r.name || r.title)) {
    return {
      ...(fallback || {}),
      ...r,
      name: r.name || r.title || fallback?.name || "Recipe",
      category: r.category || fallback?.category || "Recipe",
      region: r.region || fallback?.region || "Indian",
      ingredients:
        Array.isArray(r.ingredients) && r.ingredients.length
          ? r.ingredients
          : fallback?.ingredients || [],
      steps:
        Array.isArray(r.steps) && r.steps.length
          ? r.steps
          : fallback?.steps || [],
    };
  }
  if (fallback) return fallback;
  return {
    name: entry?.recipeName || entry?.name || "Recipe",
    category: "Recipe",
    region: "Indian",
    ingredients: [],
    steps: [],
  };
}

function RecipeViewer({ entry, recipe, onClose, onAddIngredient }) {
  if (!entry || !recipe) return null;
  const ratio = Number(entry.servings || recipe.servings || 2) / Number(recipe.servings || 2);
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
          {recipe.category} · {recipe.region} · Prep {recipe.prepMinutes || 0} min · Cook {recipe.cookMinutes || 0} min · Planned servings {entry.servings}
        </p>
        <h3>Ingredients</h3>
        <div className="diet-ingredients">
          {(recipe.ingredients || []).map((x, i) => (
            <div className="diet-view-ingredient" key={i}>
              <span>{x.name}</span>
              <strong>
                {[x.quantity, x.unit].filter(Boolean).join(" ") || "As needed"}
                {x.quantity && Number.isFinite(Number(x.quantity)) ? ` × ${ratio.toFixed(2)}` : ""}
              </strong>
              <button
                type="button"
                className="icon-button diet-add-marketing-item"
                title={`Add ${x.name} to marketing list`}
                aria-label={`Add ${x.name} to marketing list`}
                onClick={() =>
                  onAddIngredient({
                    ...x,
                    quantity:
                      x.quantity && Number.isFinite(Number(x.quantity))
                        ? String(Number(x.quantity) * ratio)
                        : x.quantity,
                  })
                }
              >
                <Plus size={17} />
              </button>
            </div>
          ))}
        </div>
        <h3>Preparation</h3>
        <ol className="diet-steps">
          {(recipe.steps || []).map((x, i) => (
            <li key={i}>
              <strong>{x.section || `Step ${i + 1}`}</strong>
              <span className="diet-time">{x.minutes || 0} min</span>
              <p>{x.text}</p>
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

function AddIngredientToMarketing({
  ingredient,
  categories,
  locations,
  defaultLocationId,
  units,
  onClose,
  onSubmit,
  saving,
}) {
  const [form, setForm] = useState({
    purchaseDate: todayKolkata(),
    locationId: "",
    categoryId: "",
    itemName: ingredient?.name || "",
    quantity: ingredient?.quantity || "",
    unitId: "",
  });

  useEffect(() => {
    const ingredientUnit = String(ingredient?.unit || "").trim().toLowerCase();
    const matchedUnit = units.find(
      (unit) => String(unit.name || "").trim().toLowerCase() === ingredientUnit
    );
    const recommendedLoc =
      locations.find((loc) => String(loc.id) === String(defaultLocationId)) ||
      locations.find((loc) => loc.auto_recommended) ||
      locations[0];

    setForm((current) => ({
      ...current,
      locationId: current.locationId || (recommendedLoc ? String(recommendedLoc.id) : ""),
      itemName: ingredient?.name || "",
      quantity: ingredient?.quantity || "",
      unitId: matchedUnit ? String(matchedUnit.id) : "",
    }));
  }, [ingredient, units, locations, defaultLocationId]);

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
            onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
          >
            <option value="">Choose location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {formatLocationOptionLabel(location)}
              </option>
            ))}
          </select>
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

  // Load recipe catalogue and locations independently so neither blocks the other on Android WebView
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
        if (!userChoseLocationRef.current && locBundle?.bestLocation) {
          setLocationId((prev) => prev || String(locBundle.bestLocation.id));
          setAutoLocationHint(describeAutoMatchReason(locBundle.bestLocation));
        }

        // Refine location with live GPS in background ONLY if the user has not chosen a location
        // and the currently displayed date does not already have planned recipes.
        getCurrentGpsPosition({ timeout: 6000 }).then(async (liveCoords) => {
          if (!active || !isValidCoordinates(liveCoords)) return;
          setCurrentCoords(liveCoords);
          try {
            const refreshed = await fetchLocationsWithGps({ coords: liveCoords, silent: true });
            if (!active) return;
            if (Array.isArray(refreshed?.locations) && refreshed.locations.length) {
              setLocations(refreshed.locations);
              if (
                !userChoseLocationRef.current &&
                !hasEntriesForDateRef.current &&
                refreshed.bestLocation
              ) {
                setLocationId(String(refreshed.bestLocation.id));
                setAutoLocationHint(describeAutoMatchReason(refreshed.bestLocation));
              }
            }
          } catch {
            const localRefined = pickBestLocation(locList, liveCoords);
            if (!active) return;
            setLocations(localRefined.locations);
            if (
              !userChoseLocationRef.current &&
              !hasEntriesForDateRef.current &&
              localRefined.bestLocation
            ) {
              setLocationId(String(localRefined.bestLocation.id));
              setAutoLocationHint(describeAutoMatchReason(localRefined.bestLocation));
            }
          }
        });
      } catch {
        // Non-fatal: food chart entries still load by date even if locations fail
      }
    })();

    return () => {
      active = false;
    };
  }, [loadRecipesCatalogue]);

  // If the Add Recipe modal is opened and recipes haven't loaded yet, fetch them immediately
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
        // If auto-location had no entries for this date and the server returned entries planned
        // under another location on this date, sync the location dropdown to match.
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
      const coords = await getCurrentGpsPosition({
        timeout: 8000,
        maximumAge: 0,
        enableHighAccuracy: true,
      });
      setCurrentCoords(coords);
      const refreshed = await fetchLocationsWithGps({ coords, silent: true });
      const locList = Array.isArray(refreshed?.locations) ? refreshed.locations : locations;
      setLocations(locList);
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

  const getRecipeUsageCount = useCallback(
    (recipe) => {
      const serverUsage = Number(recipe?.usageCount ?? recipe?.usage_count ?? 0);
      const clientUsage = Number(localUsage[String(recipe?.id)] || 0);
      return serverUsage + clientUsage;
    },
    [localUsage]
  );

  const filteredRecipes = useMemo(() => {
    const qText = query.trim().toLowerCase();
    const matching = qText
      ? recipes.filter((r) =>
          [r.name, r.category, r.region, ...(r.ingredients || []).map((i) => i.name)]
            .join(" ")
            .toLowerCase()
            .includes(qText)
        )
      : recipes;

    return [...matching].sort((a, b) => {
      const usageDiff = getRecipeUsageCount(b) - getRecipeUsageCount(a);
      if (usageDiff !== 0) return usageDiff;
      const userDiff = Number(b.userUsageCount || 0) - Number(a.userUsageCount || 0);
      if (userDiff !== 0) return userDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }, [recipes, query, getRecipeUsageCount]);

  const visiblePickerRecipes = useMemo(
    () => filteredRecipes.slice(0, pickerLimit),
    [filteredRecipes, pickerLimit]
  );

  const add = async (recipe) => {
    setSaving(true);
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
      setError("");
    } catch (e) {
      setError(e.message || "Unable to update recipe");
    }
  };

  const remove = async (entry) => {
    const resolved = resolveEntryRecipe(entry, recipesMap);
    if (
      !window.confirm(
        `Remove ${resolved.name || "this recipe"} from ${mealFor(entry)} on ${date}? It will remain in Recipe Master.`
      )
    )
      return;
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
      setMarketingLocations(Array.isArray(locBundle?.locations) ? locBundle.locations : locations);
      setMarketingUnits(Array.isArray(unitsResult) ? unitsResult : []);
    } catch (e) {
      showToast("error", e.message || "Unable to load marketing categories, locations and units.");
    }
  };

  const addIngredientToMarketing = async (formValues) => {
    const itemName = String(formValues.itemName || "").trim();
    if (!itemName || !formValues.purchaseDate || !formValues.locationId || !formValues.categoryId) {
      showToast("warning", "Choose a date, location and category, and enter an ingredient. Quantity and unit are optional.");
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
          categoryId: formValues.categoryId,
          itemId: "",
          itemName,
          quantity: formValues.quantity === "" ? "" : String(formValues.quantity),
          unitId: String(formValues.unitId || ""),
          purchaseDate: formValues.purchaseDate,
          locationId: formValues.locationId,
          latitude: coords ? coords.latitude : null,
          longitude: coords ? coords.longitude : null,
        }),
        silentToast: true,
      });
      void recordLocationSelection(formValues.locationId, { coords, source: "food_chart_ingredient" });
      showToast("success", `${itemName} added to the marketing list.`);
      setAddIngredient(null);
    } catch (e) {
      showToast("error", e.message || `Unable to add ${itemName} to the marketing list.`);
    } finally {
      setAddingToMarketing(false);
    }
  };

  const mealFor = (entry) => entry.meal;

  return (
    <main className="diet-page">
      <div className="diet-page-heading">
        <div>
          <h1>Food Chart</h1>
          <p>Plan meals independently for each date using your reusable recipe library.</p>
        </div>
        <button
          className="diet-primary"
          onClick={() => {
            setMeal("Breakfast");
            setPickerLimit(INITIAL_PICKER_LIMIT);
            setAdding(true);
          }}
        >
          <Plus size={17} /> Add Recipe
        </button>
      </div>
      <div className="diet-date-bar">
        <CalendarDays size={18} />
        <label htmlFor="food-chart-date">Selected date</label>
        <input id="food-chart-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <span>
          {new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>
      <div className="diet-date-bar">
        <MapPin size={18} />
        <label htmlFor="food-chart-location">Location</label>
        <select
          id="food-chart-location"
          value={locationId}
          onChange={(e) => {
            const val = e.target.value;
            userChoseLocationRef.current = Boolean(val);
            setAutoLocationHint("");
            setLocationId(val);
            setAdding(false);
            if (val) {
              void recordLocationSelection(val, { coords: currentCoords, source: "food_chart_select" });
            }
          }}
        >
          <option value="">All locations</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {formatLocationOptionLabel(location)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="diet-secondary diet-gps-btn"
          onClick={handleAutoDetectLocation}
          disabled={detectingGps || !locations.length}
          title="Auto-select nearest & most frequent location from current GPS"
        >
          <LocateFixed size={15} />
          <span>{detectingGps ? "Locating…" : "Auto GPS"}</span>
        </button>
        {autoLocationHint && <span className="diet-auto-location-hint">{autoLocationHint}</span>}
      </div>
      {error && <div className="diet-error">{error}</div>}
      {loading ? (
        <p>Loading food chart…</p>
      ) : (
        <div className="diet-meals">
          {meals.map((m) => {
            const list = entries
              .filter((x) => x.meal === m)
              .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            return (
              <section className="diet-meal-card" key={m}>
                <header>
                  <h2>{m}</h2>
                  <span>
                    {list.length} {list.length === 1 ? "recipe" : "recipes"}
                  </span>
                  <button
                    className="diet-secondary diet-add-meal"
                    onClick={() => {
                      setMeal(m);
                      setPickerLimit(INITIAL_PICKER_LIMIT);
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
                            <strong>{resolved.name}</strong>
                            <span>
                              {resolved.category} · Serves {entry.servings}
                            </span>
                          </div>
                          <div className="diet-actions">
                            <button
                              className="icon-button"
                              title="Edit servings"
                              aria-label="Edit servings"
                              onClick={() => edit(entry)}
                            >
                              <Pencil size={18} />
                            </button>
                            <button
                              className="icon-button"
                              title="View recipe"
                              aria-label="View recipe"
                              onClick={() => setViewer(entry)}
                            >
                              <BookOpen size={18} />
                            </button>
                            <button
                              className="icon-button danger"
                              title="Remove from this day's chart"
                              aria-label="Remove recipe"
                              onClick={() => remove(entry)}
                            >
                              <Trash2 size={18} />
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
            </label>
            <div className="diet-picker-list">
              {recipesLoading && !recipes.length ? (
                <p className="diet-empty">Loading recipes…</p>
              ) : (
                <>
                  {visiblePickerRecipes.map((r) => {
                    const usageCount = getRecipeUsageCount(r);
                    return (
                      <div className="diet-picker-item" key={r.id}>
                        <div>
                          <strong>{r.name}</strong>
                          <span>
                            {r.category} · {r.region} · {r.ingredients?.length || 0} ingredients
                            {usageCount > 0 ? ` · Used ${usageCount}x` : ""}
                          </span>
                        </div>
                        <button className="diet-primary" disabled={saving} onClick={() => add(r)}>
                          {saving ? "Adding…" : "Add"}
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
        entry={viewer}
        recipe={viewer ? resolveEntryRecipe(viewer, recipesMap) : null}
        onClose={() => setViewer(null)}
        onAddIngredient={openAddIngredient}
      />
      <AddIngredientToMarketing
        ingredient={addIngredient}
        categories={marketingCategories}
        locations={marketingLocations}
        defaultLocationId={locationId}
        units={marketingUnits}
        onClose={() => setAddIngredient(null)}
        onSubmit={addIngredientToMarketing}
        saving={addingToMarketing}
      />
    </main>
  );
}
