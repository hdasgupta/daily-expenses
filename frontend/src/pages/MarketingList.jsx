import "./marketing.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, Eye, FileText, LocateFixed, Pencil, ShoppingBasket, Trash2, Wallet, X } from "lucide-react";
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
import Pagination from "../components/Pagination";
import ProofViewer from "../components/ProofViewer";
import { usePagination } from "../hooks/usePagination";
import { todayKolkata } from "../utils/dates.js";

const empty = () => ({
  categoryId: "",
  itemId: "",
  itemName: "",
  quantity: "",
  unitId: "",
  approximateCost: "",
  purchaseDate: todayKolkata(),
  locationId: "",
});

const sortOptions = [
  { value: "id", label: "Entry order" },
  { value: "purchase_date", label: "Purchase date" },
  { value: "category_name", label: "Category" },
  { value: "item_name", label: "Item" },
  { value: "approximate_cost", label: "Approximate cost" },
  { value: "location_name", label: "Location" },
  { value: "status", label: "Status" },
];

function displayDate(value) {
  if (!value) return "Date not set";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function displayDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeUnitFamily(unitName) {
  const raw = String(unitName || "").trim().toLowerCase().replace(/\./g, "");
  if (!raw) return null;
  if (["kg", "kgs", "kilogram", "kilograms", "kilo", "kilos"].includes(raw)) {
    return { family: "mass", factor: 1000 };
  }
  if (["g", "gm", "gms", "gram", "grams"].includes(raw)) {
    return { family: "mass", factor: 1 };
  }
  if (["mg", "milligram", "milligrams"].includes(raw)) {
    return { family: "mass", factor: 0.001 };
  }
  if (["l", "ltr", "ltrs", "litre", "litres", "liter", "liters"].includes(raw)) {
    return { family: "volume", factor: 1000 };
  }
  if (["ml", "millilitre", "millilitres", "milliliter", "milliliters"].includes(raw)) {
    return { family: "volume", factor: 1 };
  }
  if (["doz", "dozen", "dozens"].includes(raw)) {
    return { family: "count", factor: 12 };
  }
  if (["pc", "pcs", "piece", "pieces", "no", "nos", "number", "numbers", "unit", "units"].includes(raw)) {
    return { family: "count", factor: 1 };
  }
  return { family: `exact:${raw}`, factor: 1 };
}

function computeUnitConversionRatio(fromUnitId, fromUnitName, toUnitId, toUnitName) {
  if (fromUnitId && toUnitId && String(fromUnitId) === String(toUnitId)) {
    return 1;
  }
  const fromNorm = normalizeUnitFamily(fromUnitName);
  const toNorm = normalizeUnitFamily(toUnitName);
  if (fromNorm && toNorm && fromNorm.family === toNorm.family && fromNorm.factor > 0) {
    return toNorm.factor / fromNorm.factor;
  }
  return null;
}

function calculateApproximateCostFromHistory(draftForm, allRows, allUnits, editingId = null) {
  const qty = Number(draftForm.quantity);
  const unitId = String(draftForm.unitId || "").trim();
  const itemId = String(draftForm.itemId || "").trim();
  const itemName = String(draftForm.itemName || "").trim().toLowerCase();

  if (!Number.isFinite(qty) || qty <= 0 || !unitId || (!itemId && !itemName)) {
    return { value: "", hint: "" };
  }

  const targetUnit = (allUnits || []).find((u) => String(u.id) === unitId);
  const targetUnitName = targetUnit?.name || "";

  const candidates = [];
  for (const row of allRows || []) {
    if (editingId && String(row.id) === String(editingId)) continue;

    const rowItemId = String(row.item_id || "").trim();
    const rowItemName = String(row.item_name || "").trim().toLowerCase();
    const matchesItem =
      (itemId && rowItemId && itemId === rowItemId) ||
      (itemName && rowItemName && itemName === rowItemName);
    if (!matchesItem) continue;

    const approxCost = Number(row.approximate_cost);
    const singleExpenseCost =
      Number(row.expense_linked_item_count || 1) === 1 && Number(row.expense_price) > 0
        ? Number(row.expense_price)
        : 0;
    const refCost =
      Number.isFinite(approxCost) && approxCost > 0
        ? approxCost
        : singleExpenseCost > 0
        ? singleExpenseCost
        : 0;
    if (!(refCost > 0)) continue;

    const usePlanned = Number.isFinite(approxCost) && approxCost > 0 && Number(row.quantity) > 0 && row.unit_id;
    const refQty = usePlanned
      ? Number(row.quantity)
      : Number(row.purchased_quantity) > 0
      ? Number(row.purchased_quantity)
      : Number(row.quantity);
    const refUnitId = usePlanned
      ? String(row.unit_id || "")
      : String(row.purchased_unit_id || row.unit_id || "");
    const refUnitName = usePlanned
      ? row.unit_name || ""
      : row.purchased_unit_name || row.unit_name || "";

    if (!(refQty > 0) || !refUnitId) continue;

    const ratio = computeUnitConversionRatio(refUnitId, refUnitName, unitId, targetUnitName);
    if (ratio === null) continue;

    candidates.push({
      row,
      refCost,
      refQty,
      refUnitId,
      refUnitName,
      ratio,
      exactUnitMatch: refUnitId === unitId,
    });
  }

  if (!candidates.length) {
    return { value: "", hint: "" };
  }

  // Prefer the most recent entry with the exact same unit, otherwise the most recent convertible unit entry
  const chosen = candidates.find((c) => c.exactUnitMatch) || candidates[0];
  const estimated = (chosen.refCost / chosen.refQty) * (qty * chosen.ratio);
  if (!Number.isFinite(estimated) || estimated <= 0) {
    return { value: "", hint: "" };
  }

  const rounded = Number(estimated.toFixed(2));
  return {
    value: String(rounded),
    hint: `Calculated from last entry (${chosen.refQty} ${chosen.refUnitName} @ ₹${chosen.refCost.toFixed(2)})`,
  };
}

export default function MarketingList({ navigate }) {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [currentCoords, setCurrentCoords] = useState(null);
  const [autoLocationHint, setAutoLocationHint] = useState("");
  const [autoCostHint, setAutoCostHint] = useState("");
  const [detectingGps, setDetectingGps] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [detailExpense, setDetailExpense] = useState(null);
  const [loadingDetailExpense, setLoadingDetailExpense] = useState(false);
  const [proofViewerUrl, setProofViewerUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const userChoseLocationRef = useRef(false);
  const userEditedCostRef = useRef(false);
  const pagination = usePagination("marketing-list", "id");

  const applyBestLocationIfUnset = (locList, bestLoc, force = false) => {
    if (!bestLoc) return;
    setForm((current) => {
      if (!force && current.locationId && userChoseLocationRef.current) {
        return current;
      }
      if (!force && current.locationId && locList.some((l) => String(l.id) === String(current.locationId))) {
        return current;
      }
      setAutoLocationHint(describeAutoMatchReason(bestLoc));
      return {
        ...current,
        locationId: String(bestLoc.id),
      };
    });
  };

  const load = async () => {
    setLoading(true);
    try {
      const [r, c, u, locBundle] = await Promise.all([
        api("/marketing-list"),
        api("/meta/categories"),
        api("/meta/units"),
        fetchLocationsWithGps({ coords: currentCoords, silent: true, fastInitial: true }),
      ]);
      setRows(Array.isArray(r) ? r : []);
      setCategories(Array.isArray(c) ? c : []);
      setUnits(Array.isArray(u) ? u : []);
      const locList = Array.isArray(locBundle?.locations) ? locBundle.locations : [];
      setLocations(locList);
      if (isValidCoordinates(locBundle?.coords)) {
        setCurrentCoords(locBundle.coords);
      }
      applyBestLocationIfUnset(locList, locBundle?.bestLocation);
      setError("");

      // Refresh with live GPS coordinates in the background to refine nearest/most-frequent mapping
      getCurrentGpsPosition({ timeout: 6000 }).then(async (liveCoords) => {
        if (!isValidCoordinates(liveCoords)) return;
        setCurrentCoords(liveCoords);
        try {
          const refreshed = await fetchLocationsWithGps({ coords: liveCoords, silent: true });
          if (Array.isArray(refreshed?.locations) && refreshed.locations.length) {
            setLocations(refreshed.locations);
            if (!userChoseLocationRef.current && refreshed.bestLocation) {
              setForm((current) => ({
                ...current,
                locationId: String(refreshed.bestLocation.id),
              }));
              setAutoLocationHint(describeAutoMatchReason(refreshed.bestLocation));
            }
          }
        } catch {
          const localRefined = pickBestLocation(locList, liveCoords);
          setLocations(localRefined.locations);
          if (!userChoseLocationRef.current && localRefined.bestLocation) {
            setForm((current) => ({
              ...current,
              locationId: String(localRefined.bestLocation.id),
            }));
            setAutoLocationHint(describeAutoMatchReason(localRefined.bestLocation));
          }
        }
      });
    } catch (e) {
      setError(e.message || "Unable to load marketing list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!form.categoryId) { setItems([]); return; }
    api(`/meta/items/${form.categoryId}`).then((result) => setItems(Array.isArray(result) ? result : [])).catch(() => setItems([]));
  }, [form.categoryId]);

  const handleAutoDetectNearestLocation = async () => {
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
        setForm((current) => ({
          ...current,
          locationId: String(refreshed.bestLocation.id),
        }));
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

  const openExpenseDetails = async (row) => {
    setDetailItem(row);
    const hasEmbeddedExpense =
      row.expense_type !== undefined ||
      row.expense_comment !== undefined ||
      Array.isArray(row.expense_shares);

    if (hasEmbeddedExpense) {
      setDetailExpense({
        id: row.expense_id,
        expense_date: row.expense_date || row.purchase_date,
        total_cost: row.expense_total_cost ?? row.expense_price,
        expense_type: row.expense_type,
        comment: row.expense_comment,
        quantity: row.expense_quantity,
        unit: row.expense_unit_name,
        category: row.expense_category_name || row.category_name,
        item: row.expense_item_name || row.expense_other_item || null,
        proof_key: row.expense_proof_key,
        created_by_name: row.expense_created_by_name || row.purchased_by_name,
        created_at: row.expense_created_at || row.updated_at,
        shares: Array.isArray(row.expense_shares) ? row.expense_shares : [],
      });
    } else {
      setDetailExpense(null);
    }

    if (!row.expense_id) return;

    const searchDate = String(row.expense_date || row.purchase_date || "").slice(0, 10);
    if (!searchDate) return;

    setLoadingDetailExpense(true);
    try {
      const res = await api(
        `/expenses?date=${encodeURIComponent(searchDate)}&page=1&pageSize=50&sortColumn=expense_date&sortDirection=desc`,
        { silent: true, silentToast: true }
      );
      const list = Array.isArray(res?.rows) ? res.rows : [];
      const matched = list.find((exp) => String(exp.id) === String(row.expense_id));
      if (matched) {
        setDetailExpense((prev) => ({
          ...(prev || {}),
          ...matched,
          shares: Array.isArray(matched.shares)
            ? matched.shares
            : Array.isArray(prev?.shares)
            ? prev.shares
            : [],
        }));
      }
    } catch {
      // Keep any embedded or marketing-row fallback details if the secondary fetch fails
    } finally {
      setLoadingDetailExpense(false);
    }
  };

  const closeExpenseDetails = () => {
    setDetailItem(null);
    setDetailExpense(null);
    setLoadingDetailExpense(false);
  };

  const openExpenseProof = async (expenseId) => {
    if (!expenseId) return;
    try {
      const result = await api(`/expenses/${expenseId}/proof-url`, {
        loadingMessage: "Opening proof…",
      });
      if (result?.url) {
        setProofViewerUrl(result.url);
      }
    } catch (e) {
      showToast("error", e.message || "Unable to open expense proof.");
    }
  };

  const filteredRows = useMemo(() => {
    const term = String(pagination.search || "").trim().toLowerCase();
    const selectedDate = String(form.purchaseDate || "").slice(0, 10);
    const filtered = rows.filter((row) => {
      if (String(row.purchase_date || "").slice(0, 10) !== selectedDate) return false;
      if (form.locationId && String(row.location_id || "") !== String(form.locationId)) return false;
      if (form.categoryId && String(row.category_id || "") !== String(form.categoryId)) return false;
      const haystack = [
        row.item_name,
        row.category_name,
        row.location_name,
        row.unit_name,
        row.status,
        row.purchase_date,
        row.quantity,
        row.approximate_cost,
        row.expense_price,
      ]
        .map((value) => String(value ?? ""))
        .join(" ")
        .toLowerCase();
      return !term || haystack.includes(term);
    });
    if (pagination.sortColumn) {
      const column = pagination.sortColumn;
      filtered.sort((a, b) => {
        const result =
          column === "id" || column === "approximate_cost"
            ? Number(a[column] || 0) - Number(b[column] || 0)
            : String(a[column] ?? "")
                .toLowerCase()
                .localeCompare(String(b[column] ?? "").toLowerCase(), undefined, { numeric: true });
        return pagination.sortDirection === "desc" ? -result : result;
      });
    }
    return filtered;
  }, [rows, form.purchaseDate, form.locationId, form.categoryId, pagination.search, pagination.sortColumn, pagination.sortDirection]);

  const filteredCostSummary = useMemo(() => {
    let totalCost = 0;
    let costItemCount = 0;
    for (const row of filteredRows) {
      const approx = Number(row.approximate_cost);
      if (Number.isFinite(approx) && approx > 0) {
        totalCost += approx;
        costItemCount += 1;
      }
    }
    return {
      totalCost,
      costItemCount,
    };
  }, [filteredRows]);

  const pageSize = Number(pagination.pageSize) || 10;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pendingFilteredRows = filteredRows.filter((row) => row.status === "pending");
  const selectedPendingRows = pendingFilteredRows.filter((row) => selectedIds.includes(String(row.id)));
  const allFilteredSelected = pendingFilteredRows.length > 0 && pendingFilteredRows.every((row) => selectedIds.includes(String(row.id)));
  const selectedCategoryIds = [...new Set(selectedPendingRows.map((row) => String(row.category_id || "")))];
  const selectedCategoryCompatible = selectedPendingRows.length > 0 && selectedCategoryIds.length === 1 && Boolean(selectedCategoryIds[0]);
  const toggleAll = () => setSelectedIds((current) => allFilteredSelected
    ? current.filter((id) => !pendingFilteredRows.some((row) => String(row.id) === id))
    : [...new Set([...current, ...pendingFilteredRows.map((row) => String(row.id))])]);
  const toggleOne = (id) => setSelectedIds((current) => current.includes(String(id))
    ? current.filter((value) => value !== String(id))
    : [...current, String(id)]);
  useEffect(() => { setSelectedIds([]); }, [form.purchaseDate, form.locationId, form.categoryId, pagination.search]);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  const change = (key, value) => {
    if (key === "locationId") {
      userChoseLocationRef.current = Boolean(value);
      setAutoLocationHint("");
      if (value) {
        void recordLocationSelection(value, { coords: currentCoords, source: "marketing_list_select" });
      }
    }

    if (key === "approximateCost") {
      userEditedCostRef.current = true;
      setAutoCostHint("");
      setForm((current) => ({
        ...current,
        approximateCost: value,
      }));
      return;
    }

    if (key === "itemId" || key === "itemName") {
      userEditedCostRef.current = false;
    }

    setForm((current) => {
      const next = {
        ...current,
        [key]: value,
        ...(key === "itemId"
          ? { itemName: items.find((item) => String(item.id) === String(value))?.name || current.itemName }
          : {}),
      };

      if (["itemId", "itemName", "quantity", "unitId"].includes(key) && !userEditedCostRef.current) {
        const estimated = calculateApproximateCostFromHistory(next, rows, units, editing);
        next.approximateCost = estimated.value;
        setAutoCostHint(estimated.hint);
      }

      return next;
    });
  };

  const resetForm = ({ preserveSelection = true } = {}) => {
    const selection = preserveSelection ? { categoryId: form.categoryId, purchaseDate: form.purchaseDate, locationId: form.locationId } : {};
    setEditing(null);
    userEditedCostRef.current = false;
    setAutoCostHint("");
    setForm({ ...empty(), ...selection });
  };
  const save = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.locationId) {
      setError("Shopping location is required.");
      return;
    }
    try {
      const coords = isValidCoordinates(currentCoords)
        ? currentCoords
        : await getCurrentGpsPosition({ timeout: 2500 });
      if (isValidCoordinates(coords)) {
        setCurrentCoords(coords);
      }
      const approxNum = Number(form.approximateCost);
      const hasValidApprox = Number.isFinite(approxNum) && approxNum > 0;
      const payload = {
        ...form,
        itemName: form.itemName.trim(),
        approximateCost: hasValidApprox ? String(approxNum) : "",
        autoCalculateCost: !userEditedCostRef.current,
        latitude: coords ? coords.latitude : null,
        longitude: coords ? coords.longitude : null,
      };
      await api(editing ? `/marketing-list/${editing}` : "/marketing-list", {
        method: editing ? "PUT" : "POST", body: JSON.stringify(payload),
      });
      void recordLocationSelection(form.locationId, { coords, source: "marketing_list_save" });
      userEditedCostRef.current = false;
      setAutoCostHint("");
      if (editing) {
        resetForm();
      } else {
        // Keep the selected date, category, and location so multiple items can be added quickly.
        setEditing(null);
        setForm({ ...empty(), categoryId: form.categoryId, purchaseDate: form.purchaseDate, locationId: form.locationId });
      }
      setPage(1); await load();
    } catch (e) { setError(e.message || "Unable to save item"); }
  };

  const remove = async () => {
    const row = pendingRemoval;
    if (!row || row.status !== "pending" || removing) return;
    setRemoving(true);
    setError("");
    try {
      await api(`/marketing-list/${row.id}`, { method: "DELETE" });
      if (String(editing) === String(row.id)) resetForm();
      setSelectedIds((current) => current.filter((id) => id !== String(row.id)));
      setPendingRemoval(null);
      await load();
    } catch (e) {
      setError(e.message || "Unable to permanently delete marketing item");
    } finally {
      setRemoving(false);
    }
  };

  const edit = (row) => {
    if (row.status !== "pending") return;
    setEditing(row.id);
    userChoseLocationRef.current = true;
    const approxVal = Number(row.approximate_cost);
    const hasExistingCost = Number.isFinite(approxVal) && approxVal > 0;
    userEditedCostRef.current = hasExistingCost;

    const draft = {
      categoryId: String(row.category_id || ""),
      itemId: String(row.item_id || ""),
      itemName: row.item_name || "",
      quantity: row.quantity ?? "",
      unitId: String(row.unit_id || ""),
      approximateCost: hasExistingCost ? String(row.approximate_cost) : "",
      purchaseDate: String(row.purchase_date).slice(0, 10),
      locationId: String(row.location_id || ""),
    };

    if (!hasExistingCost) {
      const estimated = calculateApproximateCostFromHistory(draft, rows, units, row.id);
      draft.approximateCost = estimated.value;
      setAutoCostHint(estimated.hint);
    } else {
      setAutoCostHint("");
    }

    setForm(draft);
    setError(""); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const buySelected = () => {
    if (!selectedPendingRows.length) return;
    if (!selectedCategoryCompatible) {
      setError("Select items from one category at a time. Use the Category filter to narrow the list.");
      return;
    }
    const first = selectedPendingRows[0];
    const comment = selectedPendingRows.map((row) => {
      const quantity = row.quantity === null || row.quantity === undefined || row.quantity === "" ? "" : ` — ${row.quantity}${row.unit_name ? ` ${row.unit_name}` : ""}`;
      const approx = Number(row.approximate_cost);
      const approxText = Number.isFinite(approx) && approx > 0 ? ` (Approx. ₹${approx.toFixed(2)})` : "";
      return `• ${row.item_name}${quantity}${approxText}`;
    }).join("\n");
    localStorage.setItem("marketing-purchase-prefill", JSON.stringify({
      marketingItemIds: selectedPendingRows.map((row) => String(row.id)),
      categoryId: String(first.category_id || ""),
      expenseDate: String(form.purchaseDate || todayKolkata()).slice(0, 10),
      comment: `Marketing list items:\n${comment}`,
    }));
    navigate("/add-expense");
  };

  const canAddExpenseForSelectedDate = String(form.purchaseDate || "").slice(0, 10) <= todayKolkata();

  const canSelectMarketingItems = Boolean(form.categoryId && form.locationId);

  const canShowSelectionControls = canSelectMarketingItems && pendingFilteredRows.length > 0;

  const selectionControls = (position) => canShowSelectionControls ? (
    <div className={`marketing-bulk-toolbar marketing-bulk-toolbar-${position}`}>
      <label className="marketing-select-all">
        <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} disabled={!pendingFilteredRows.length} />
        <span>{allFilteredSelected ? "Deselect all" : "Select all pending items"}</span>
      </label>
      <div className="marketing-selection-count">{selectedPendingRows.length} selected</div>
      {canAddExpenseForSelectedDate ? (
        <div className="marketing-selection-action">
          <button type="button" className="primary" onClick={buySelected} disabled={!selectedPendingRows.length || !selectedCategoryCompatible}>
            <CheckCircle2 size={15} /> Purchased all / Add expense
          </button>
        </div>
      ) : (
        <div className="marketing-selection-hint" role="status">You can add to expense in future</div>
      )}
      {selectedPendingRows.length > 0 && !selectedCategoryCompatible && (
        <div className="marketing-selection-hint">Select items from one category at a time.</div>
      )}
    </div>
  ) : null;

  const siblingPurchasedItems = useMemo(() => {
    if (!detailItem?.expense_id) return [];
    return rows.filter((r) => String(r.expense_id || "") === String(detailItem.expense_id));
  }, [rows, detailItem]);

  return (
    <div className="marketing-page marketing-list-page">
      <div className="page-heading"><div><h1>Marketing List</h1><p>One shared shopping list for everyone. Purchased and removed items remain available for reference.</p></div></div>
      {error && <div className="marketing-error" role="alert">{error}</div>}

      <form className="card marketing-form-grid marketing-list-form" onSubmit={save}>
        <div className="marketing-form-title"><ShoppingBasket size={20} /><h2>{editing ? "Edit marketing item" : "Add an item to the list"}</h2></div>
        <label className="marketing-date-field">Date<input required type="date" value={form.purchaseDate} onChange={(event) => { change("purchaseDate", event.target.value); setPage(1); }} /></label>
        <label>
          <span className="location-label-row">
            <span>Shopping location</span>
            <button
              type="button"
              className="gps-auto-button"
              onClick={handleAutoDetectNearestLocation}
              disabled={detectingGps || !locations.length}
              title="Automatically select nearest & most frequent location from current GPS"
            >
              <LocateFixed size={13} />
              <span>{detectingGps ? "Locating…" : "Auto GPS"}</span>
            </button>
          </span>
          <select required value={form.locationId} onChange={(event) => { change("locationId", event.target.value); setPage(1); }}>
            <option value="">Choose location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {formatLocationOptionLabel(location)}
              </option>
            ))}
          </select>
          {autoLocationHint && (
            <small className="location-auto-hint">{autoLocationHint}</small>
          )}
        </label>
        <label>Category<select value={form.categoryId} onChange={(event) => { change("categoryId", event.target.value); setPage(1); }}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Known item<select value={form.itemId} onChange={(event) => change("itemId", event.target.value)}><option value="">Custom / type item name</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Item name<input required value={form.itemName} onChange={(event) => change("itemName", event.target.value)} placeholder="e.g. Potatoes" /></label>
        <label>Quantity<input type="number" min="0" step="any" value={form.quantity} onChange={(event) => change("quantity", event.target.value)} placeholder="Quantity" /></label>
        <label>Unit<select value={form.unitId} onChange={(event) => change("unitId", event.target.value)}><option value="">Choose unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <label>
          Approximate cost (₹, optional)
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.approximateCost}
            onChange={(event) => change("approximateCost", event.target.value)}
            placeholder="Auto-calculated if past data exists"
          />
          {autoCostHint && (
            <small className="location-auto-hint">{autoCostHint}</small>
          )}
        </label>
        <div className="marketing-list-form-actions"><button className="primary" type="submit">{editing ? "Save changes" : "Add to marketing list"}</button>{editing && <button type="button" onClick={resetForm}>Cancel</button>}</div>
      </form>

      <section className="marketing-items-section" aria-labelledby="marketing-items-heading">
        <div className="marketing-items-heading">
          <div>
            <h2 id="marketing-items-heading">Shopping items</h2>
            <p>
              {filteredRows.length} {filteredRows.length === 1 ? "item" : "items"} for {displayDate(form.purchaseDate)}
              {form.locationId ? ` · ${locations.find((location) => String(location.id) === String(form.locationId))?.name || "selected location"}` : ""}
              {form.categoryId ? ` · ${categories.find((category) => String(category.id) === String(form.categoryId))?.name || "selected category"}` : ""}
              {pagination.search ? " matching your search" : ""}
            </p>
          </div>
          <div className="marketing-heading-right">
            <div className="marketing-total-cost-banner" aria-live="polite">
              <Wallet size={16} />
              <div className="marketing-total-cost-copy">
                <span>Total cost (filtered)</span>
                <strong>₹{filteredCostSummary.totalCost.toFixed(2)}</strong>
                {filteredCostSummary.costItemCount > 0 && (
                  <small>
                    {filteredCostSummary.costItemCount} of {filteredRows.length}{" "}
                    {filteredRows.length === 1 ? "item" : "items"} with cost
                  </small>
                )}
              </div>
            </div>
            <div className="marketing-list-legend">
              <span><i className="status-dot pending-dot" /> Pending</span>
              <span><i className="status-dot purchased-dot" /> Purchased</span>
            </div>
          </div>
        </div>
        {selectionControls("top")}
        <Pagination page={safePage} setPage={setPage} total={filteredRows.length} {...pagination} sortOptions={sortOptions} />

        {loading ? <div className="marketing-list-empty"><span className="marketing-loading-mark" />Loading marketing list…</div> : visibleRows.length ? (
          <div className="marketing-item-grid">
            {visibleRows.map((row) => {
              const status = row.status === "pending" ? "pending" : row.status === "removed" ? "removed" : "purchased";
              const quantity = status === "purchased" ? (row.purchased_quantity ?? row.quantity ?? "—") : (row.quantity ?? "—");
              const unit = status === "purchased" ? (row.purchased_unit_name || row.unit_name || "") : (row.unit_name || "");
              const approxCost = Number(row.approximate_cost);
              const hasApproxCost = Number.isFinite(approxCost) && approxCost > 0;
              const isSelected = selectedIds.includes(String(row.id));
              return <article className={`marketing-item-card status-${status}${isSelected ? " is-selected" : ""}`} key={row.id}>
                <div className="marketing-item-card-top">{status === "pending" && canSelectMarketingItems && <label className="marketing-item-checkbox" aria-label={`Select ${row.item_name}`}><input type="checkbox" checked={selectedIds.includes(String(row.id))} onChange={() => toggleOne(row.id)} /><span>Select</span></label>}</div>
                <div className="marketing-item-main">
                  <div className="marketing-item-icon"><ShoppingBasket size={21} /></div>
                  <div className="marketing-item-name">
                    <h3>{row.item_name || "Unnamed item"}</h3>
                    <p>{row.category_name || "Uncategorized"}</p>
                  </div>
                  {status === "pending" && (
                    <div className="marketing-item-icon-actions">
                      <button type="button" className="marketing-item-edit-icon" onClick={() => edit(row)} aria-label={`Edit ${row.item_name || "marketing item"}`} title="Edit item"><Pencil size={16} /></button>
                      <button type="button" className="marketing-item-remove-icon" onClick={() => setPendingRemoval(row)} aria-label={`Remove ${row.item_name || "marketing item"}`} title="Remove item"><Trash2 size={16} /></button>
                    </div>
                  )}
                  {status === "purchased" && (
                    <div className="marketing-item-icon-actions">
                      <button
                        type="button"
                        className="marketing-item-detail-icon"
                        onClick={() => openExpenseDetails(row)}
                        aria-label={`View purchase and expense details for ${row.item_name || "purchased item"}`}
                        title="View purchase & expense details"
                      >
                        <Eye size={16} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="marketing-item-details marketing-item-quantity-status">
                  <div>
                    <span>Quantity</span>
                    <strong>{quantity} {unit}</strong>
                  </div>
                  {hasApproxCost && (
                    <div className="marketing-item-approx-cost">
                      <span>Approx. cost</span>
                      <strong>₹{approxCost.toFixed(2)}</strong>
                    </div>
                  )}
                  <span className={`marketing-status-pill ${status}`}>{status === "pending" ? <><Clock3 size={13} /> Pending</> : status === "removed" ? "Removed" : <><CheckCircle2 size={13} /> Purchased</>}</span>
                </div>
                {status === "purchased" && (
                  <div className="marketing-purchase-price">
                    <Wallet size={16} />
                    <span>Expense price</span>
                    <strong>₹{Number(row.expense_price || 0).toFixed(2)}</strong>
                    <button
                      type="button"
                      className="marketing-item-detail-icon marketing-price-detail-icon"
                      onClick={() => openExpenseDetails(row)}
                      aria-label={`Expense details for ${row.item_name || "purchased item"}`}
                      title="Show purchase & expense details"
                    >
                      <FileText size={14} />
                    </button>
                  </div>
                )}
                {status === "removed" && <div className="marketing-removed-note">The linked expense was removed.</div>}
                {status !== "pending" && <div className="marketing-item-actions"><span className="marketing-readonly-label">{status === "purchased" ? <><CheckCircle2 size={15} /> Purchased · Read-only</> : "Removed · Read-only"}</span></div>}
              </article>;
            })}
          </div>
        ) : <div className="marketing-list-empty"><ShoppingBasket size={28} /><strong>{pagination.search || form.locationId || form.categoryId ? "No matching items" : `No items for ${displayDate(form.purchaseDate)}`}</strong><span>{pagination.search || form.locationId || form.categoryId ? "Try changing the date, shopping location, category, or search term above." : "Choose another date or add a shopping item using the form above."}</span></div>}
        {selectionControls("bottom")}
      </section>
      {detailItem && (
        <div
          className="marketing-confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeExpenseDetails();
          }}
        >
          <div
            className="marketing-confirm-dialog marketing-expense-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="marketing-expense-detail-title"
          >
            <div className="marketing-expense-detail-header">
              <div className="marketing-expense-detail-title-group">
                <div className="marketing-expense-detail-icon">
                  <Wallet size={20} />
                </div>
                <div>
                  <h2 id="marketing-expense-detail-title">{detailItem.item_name || "Purchased Item"}</h2>
                  <p className="marketing-expense-detail-subtitle">
                    {detailItem.category_name || "Uncategorized"} · {detailItem.location_name || "Location not set"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="marketing-item-edit-icon"
                onClick={closeExpenseDetails}
                aria-label="Close expense details"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="marketing-expense-detail-body">
              <div className="marketing-expense-detail-grid">
                <div className="marketing-expense-detail-cell">
                  <span>Marketing Date</span>
                  <strong>{displayDate(detailItem.purchase_date)}</strong>
                </div>
                <div className="marketing-expense-detail-cell">
                  <span>Expense Date</span>
                  <strong>{displayDate(detailExpense?.expense_date || detailItem.expense_date || detailItem.purchase_date)}</strong>
                </div>
                <div className="marketing-expense-detail-cell">
                  <span>Planned Quantity</span>
                  <strong>
                    {detailItem.quantity ?? "—"} {detailItem.unit_name || ""}
                  </strong>
                </div>
                <div className="marketing-expense-detail-cell">
                  <span>Purchased Quantity</span>
                  <strong>
                    {detailItem.purchased_quantity ?? detailItem.quantity ?? "—"}{" "}
                    {detailItem.purchased_unit_name || detailItem.unit_name || ""}
                  </strong>
                </div>
                {Number(detailItem.approximate_cost) > 0 && (
                  <div className="marketing-expense-detail-cell">
                    <span>Approximate Cost</span>
                    <strong>₹{Number(detailItem.approximate_cost).toFixed(2)}</strong>
                  </div>
                )}
                <div className="marketing-expense-detail-cell">
                  <span>Total Expense Cost</span>
                  <strong className="marketing-expense-cost-highlight">
                    ₹{Number(detailExpense?.total_cost ?? detailItem.expense_total_cost ?? detailItem.expense_price ?? 0).toFixed(2)}
                  </strong>
                </div>
                <div className="marketing-expense-detail-cell">
                  <span>Payment Mode</span>
                  <strong className="marketing-expense-capitalize">
                    {detailExpense?.expense_type || detailItem.expense_type || "Cash / Recorded"}
                  </strong>
                </div>
                {detailItem.expense_id && (
                  <div className="marketing-expense-detail-cell">
                    <span>Expense ID</span>
                    <strong>#{detailItem.expense_id}</strong>
                  </div>
                )}
                {(detailExpense?.category || detailItem.expense_category_name || detailExpense?.item || detailExpense?.other_item) && (
                  <div className="marketing-expense-detail-cell">
                    <span>Expense Entry</span>
                    <strong>
                      {detailExpense?.category || detailItem.expense_category_name || detailItem.category_name} ·{" "}
                      {detailExpense?.item || detailExpense?.other_item || detailItem.expense_item_name || detailItem.expense_other_item || "Total"}
                    </strong>
                  </div>
                )}
                {(detailItem.purchased_by_name || detailExpense?.created_by_name) && (
                  <div className="marketing-expense-detail-cell">
                    <span>Recorded By</span>
                    <strong>{detailItem.purchased_by_name || detailExpense?.created_by_name}</strong>
                  </div>
                )}
                {displayDateTime(detailExpense?.created_at || detailItem.updated_at) && (
                  <div className="marketing-expense-detail-cell">
                    <span>Purchased On</span>
                    <strong>{displayDateTime(detailExpense?.created_at || detailItem.updated_at)}</strong>
                  </div>
                )}
              </div>

              {loadingDetailExpense && (
                <div className="marketing-expense-detail-loading">Loading linked expense details…</div>
              )}

              {siblingPurchasedItems.length > 1 && (
                <div className="marketing-expense-detail-section">
                  <h3>Items Purchased in This Expense ({siblingPurchasedItems.length})</h3>
                  <ul className="marketing-expense-detail-list">
                    {siblingPurchasedItems.map((sib) => (
                      <li key={sib.id}>
                        <span>{sib.item_name}</span>
                        <strong>
                          {sib.purchased_quantity ?? sib.quantity ?? "—"}{" "}
                          {sib.purchased_unit_name || sib.unit_name || ""}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(detailExpense?.comment || detailItem.expense_comment) && (
                <div className="marketing-expense-detail-section">
                  <h3>Expense Comment / Notes</h3>
                  <div className="marketing-expense-detail-comment">
                    {detailExpense?.comment || detailItem.expense_comment}
                  </div>
                </div>
              )}

              {Array.isArray(detailExpense?.shares) && detailExpense.shares.length > 0 && (
                <div className="marketing-expense-detail-section">
                  <h3>Survivor Shares Breakdown</h3>
                  <ul className="marketing-expense-detail-list">
                    {detailExpense.shares.map((share, idx) => (
                      <li key={share.survivorId || idx}>
                        <span>
                          {share.survivorName}{" "}
                          <small className="marketing-expense-share-type">({share.shareType})</small>
                        </span>
                        <strong>₹{Number(share.amount || 0).toFixed(2)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="marketing-confirm-actions">
              {(detailExpense?.proof_key || detailItem.expense_proof_key) && detailItem.expense_id && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => openExpenseProof(detailItem.expense_id)}
                >
                  <Eye size={15} /> View Proof
                </button>
              )}
              <button type="button" onClick={closeExpenseDetails}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingRemoval && (
        <div className="marketing-confirm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !removing) setPendingRemoval(null); }}>
          <div className="marketing-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="marketing-confirm-title" aria-describedby="marketing-confirm-description">
            <div className="marketing-confirm-icon"><Trash2 size={22} /></div>
            <h2 id="marketing-confirm-title">Permanently delete item?</h2>
            <p id="marketing-confirm-description">Are you sure you want to permanently delete <strong>{pendingRemoval.item_name || "this item"}</strong> from the marketing list? This cannot be undone. Purchased items cannot be deleted.</p>
            <div className="marketing-confirm-actions">
              <button type="button" onClick={() => setPendingRemoval(null)} disabled={removing}>Cancel</button>
              <button type="button" className="marketing-confirm-delete" onClick={remove} disabled={removing}>{removing ? "Deleting…" : "Confirm delete"}</button>
            </div>
          </div>
        </div>
      )}
      <ProofViewer
        url={proofViewerUrl}
        title="Expense proof"
        onClose={() => setProofViewerUrl("")}
      />
    </div>
  );
}