import React, { useEffect, useMemo, useRef, useState } from "react";
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

function RecipeViewer({ entry, onClose, onAddIngredient }) {
  const recipe = entry?.recipe;
  if (!recipe) return null;
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
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
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

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [master, locBundle] = await Promise.all([
          api("/recipes"),
          fetchLocationsWithGps({ silent: true, fastInitial: true }),
        ]);
        if (!active) return;
        setRecipes(Array.isArray(master) ? master : []);
        const locList = Array.isArray(locBundle?.locations) ? locBundle.locations : [];
        setLocations(locList);
        if (isValidCoordinates(locBundle?.coords)) {
          setCurrentCoords(locBundle.coords);
        }
        if (!locationId && locBundle?.bestLocation) {
          setLocationId(String(locBundle.bestLocation.id));
          setAutoLocationHint(describeAutoMatchReason(locBundle.bestLocation));
        }
        setError("");

        // Refine location with live GPS in background
        getCurrentGpsPosition({ timeout: 6000 }).then(async (liveCoords) => {
          if (!active || !isValidCoordinates(liveCoords)) return;
          setCurrentCoords(liveCoords);
          try {
            const refreshed = await fetchLocationsWithGps({ coords: liveCoords, silent: true });
            if (!active) return;
            if (Array.isArray(refreshed?.locations) && refreshed.locations.length) {
              setLocations(refreshed.locations);
              if (!userChoseLocationRef.current && refreshed.bestLocation) {
                setLocationId(String(refreshed.bestLocation.id));
                setAutoLocationHint(describeAutoMatchReason(refreshed.bestLocation));
              }
            }
          } catch {
            const localRefined = pickBestLocation(locList, liveCoords);
            if (!active) return;
            setLocations(localRefined.locations);
            if (!userChoseLocationRef.current && localRefined.bestLocation) {
              setLocationId(String(localRefined.bestLocation.id));
              setAutoLocationHint(describeAutoMatchReason(localRefined.bestLocation));
            }
          }
        });
      } catch (e) {
        if (active) setError(e.message || "Unable to load food chart");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!locationId) {
      setEntries([]);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    api(`/food-chart?date=${encodeURIComponent(date)}&locationId=${encodeURIComponent(locationId)}`)
      .then((chart) => {
        if (active) {
          setEntries(Array.isArray(chart) ? chart : []);
          setError("");
        }
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

  const filteredRecipes = useMemo(
    () =>
      recipes.filter((r) =>
        [r.name, r.category, r.region, ...(r.ingredients || []).map((i) => i.name)]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [recipes, query]
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
      const result = await api("/food-chart", {
        method: "POST",
        body: JSON.stringify({
          date,
          locationId,
          meal,
          recipeId: recipe.id,
          servings: recipe.servings || 2,
          latitude: coords ? coords.latitude : null,
          longitude: coords ? coords.longitude : null,
        }),
      });
      void recordLocationSelection(locationId, { coords, source: "food_chart_add" });
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
    if (
      !window.confirm(
        `Remove ${entry.recipe?.name || "this recipe"} from ${mealFor(entry)} on ${date}? It will remain in Recipe Master.`
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
        {locationId && (
          <button
            className="diet-primary"
            onClick={() => {
              setMeal("Breakfast");
              setAdding(true);
            }}
          >
            <Plus size={17} /> Add Recipe
          </button>
        )}
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
            setEntries([]);
            setAdding(false);
            if (val) {
              void recordLocationSelection(val, { coords: currentCoords, source: "food_chart_select" });
            }
          }}
        >
          <option value="">Select location</option>
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
      {!locationId ? (
        <p className="diet-empty">Select a location to view or plan meals for this date.</p>
      ) : loading ? (
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
                      setAdding(true);
                      setQuery("");
                    }}
                  >
                    <Plus size={15} /> Add
                  </button>
                </header>
                {list.length ? (
                  <div className="diet-meal-entries">
                    {list.map((entry) => (
                      <article className="diet-recipe-row" key={entry.id}>
                        <div className="diet-recipe-main">
                          <strong>{entry.recipe?.name || "Recipe"}</strong>
                          <span>
                            {entry.recipe?.category || "Recipe"} · Serves {entry.servings}
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
                    ))}
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
                  {date} · {locations.find((x) => String(x.id) === String(locationId))?.name || "Selected location"} · Choose the meal and recipe to add.
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
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search recipe, ingredient, category or region…"
              />
            </label>
            <div className="diet-picker-list">
              {filteredRecipes.map((r) => (
                <div className="diet-picker-item" key={r.id}>
                  <div>
                    <strong>{r.name}</strong>
                    <span>
                      {r.category} · {r.region} · {r.ingredients?.length || 0} ingredients
                    </span>
                  </div>
                  <button className="diet-primary" disabled={saving} onClick={() => add(r)}>
                    {saving ? "Adding…" : "Add"}
                  </button>
                </div>
              ))}
              {!filteredRecipes.length && (
                <p className="diet-empty">No matching recipes. Add one in Recipe Master first.</p>
              )}
            </div>
          </section>
        </div>
      )}
      <RecipeViewer entry={viewer} onClose={() => setViewer(null)} onAddIngredient={openAddIngredient} />
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
