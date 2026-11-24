import React, { useEffect, useState } from "react";
import { CalendarDays, MapPin, ShoppingBasket, X } from "lucide-react";
import { describeAutoMatchReason, formatLocationOptionLabel } from "../lib/locationTracker";
import {
  calculateApproximateCostFromHistory,
  inferHistoryDefaultsForItem,
} from "../lib/marketingHistory";
import { todayKolkata } from "../utils/dates.js";

export default function AddIngredientToMarketingModal({
  ingredient,
  categories,
  locations,
  defaultLocationId = "",
  units,
  marketingRows = [],
  onClose,
  onSubmit,
  saving,
}) {
  const [form, setForm] = useState({
    purchaseDate: todayKolkata(),
    locationId: "",
    categoryId: "",
    itemId: "",
    itemName: ingredient?.name || "",
    quantity: "",
    unitId: "",
    approximateCost: "",
  });
  const [autoHint, setAutoHint] = useState("");
  const [categoryHint, setCategoryHint] = useState("");
  const [approxCostHint, setApproxCostHint] = useState("");
  const [costTouched, setCostTouched] = useState(false);

  // Reset touched flags whenever a new ingredient is opened
  useEffect(() => {
    setCostTouched(false);
    setCategoryHint("");
    setApproxCostHint("");
  }, [ingredient]);

  // Populate location, category, quantity, unit from history / smart defaults
  useEffect(() => {
    if (!ingredient) return;

    const recommendedLoc =
      (defaultLocationId &&
        locations.find((loc) => String(loc.id) === String(defaultLocationId))) ||
      locations.find((loc) => loc.auto_recommended) ||
      locations[0] ||
      null;

    if (recommendedLoc && !form.locationId) {
      setAutoHint(describeAutoMatchReason(recommendedLoc));
    }

    const itemName = ingredient?.name || "";
    const inferred = inferHistoryDefaultsForItem(
      itemName,
      marketingRows,
      categories,
      units,
      ingredient,
    );

    if (inferred.categoryId) {
      setCategoryHint(
        inferred.categoryFromHistory
          ? "Auto-detected from purchase history"
          : "Auto-detected from ingredient name",
      );
    } else {
      setCategoryHint("");
    }

    setForm((current) => ({
      ...current,
      locationId: current.locationId || (recommendedLoc ? String(recommendedLoc.id) : ""),
      categoryId: current.categoryId || inferred.categoryId,
      itemId: inferred.itemId || current.itemId,
      itemName,
      quantity: current.quantity !== "" ? current.quantity : inferred.quantity,
      unitId: current.unitId || inferred.unitId,
    }));
  }, [ingredient, units, locations, categories, marketingRows, defaultLocationId]);

  // Auto-calculate approximate cost when itemName, quantity, unitId, or marketingRows change
  useEffect(() => {
    if (!ingredient || costTouched) return;
    const result = calculateApproximateCostFromHistory(
      {
        itemId: form.itemId,
        itemName: form.itemName,
        quantity: form.quantity,
        unitId: form.unitId,
      },
      marketingRows,
      units,
    );
    setApproxCostHint(result.hint);
    setForm((current) =>
      current.approximateCost === result.value
        ? current
        : { ...current, approximateCost: result.value },
    );
  }, [ingredient, form.itemId, form.itemName, form.quantity, form.unitId, marketingRows, units, costTouched]);

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
            <p className="diet-muted">
              Category, quantity, unit and approx. price are auto-filled from history when available.
            </p>
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
            onChange={(e) => {
              setCategoryHint("");
              setForm((f) => ({ ...f, categoryId: e.target.value }));
            }}
          >
            <option value="">Choose category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {categoryHint && <small className="diet-auto-location-hint">{categoryHint}</small>}
        </label>
        <label>
          Selected ingredient
          <input
            required
            maxLength={200}
            value={form.itemName}
            onChange={(e) => {
              const nextName = e.target.value;
              const inferred = inferHistoryDefaultsForItem(
                nextName,
                marketingRows,
                categories,
                units,
                ingredient,
              );
              setCostTouched(false);
              setForm((f) => ({
                ...f,
                itemName: nextName,
                itemId: inferred.itemId || "",
                categoryId: inferred.categoryId || f.categoryId,
                unitId: inferred.unitId || f.unitId,
                quantity: inferred.quantity || f.quantity,
              }));
            }}
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
              onChange={(e) => {
                setCostTouched(false);
                setForm((f) => ({ ...f, quantity: e.target.value }));
              }}
            />
          </label>
          <label>
            Unit
            <select
              value={form.unitId}
              onChange={(e) => {
                setCostTouched(false);
                setForm((f) => ({ ...f, unitId: e.target.value }));
              }}
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
        <label>
          Approx. price (₹)
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Auto-calculated from history or enter manually"
            value={form.approximateCost}
            onChange={(e) => {
              setCostTouched(true);
              setApproxCostHint("");
              setForm((f) => ({ ...f, approximateCost: e.target.value }));
            }}
          />
          {approxCostHint && <small className="diet-auto-location-hint">{approxCostHint}</small>}
        </label>
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
