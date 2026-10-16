import "./marketing.css";
import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, MapPin, Pencil, ShoppingBasket, Wallet } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { usePagination } from "../hooks/usePagination";
import { todayKolkata } from "../utils/dates.js";

const empty = () => ({ categoryId: "", itemId: "", itemName: "", quantity: "", unitId: "", purchaseDate: todayKolkata(), locationId: "" });
const sortOptions = [
  { value: "id", label: "Entry order" },
  { value: "purchase_date", label: "Purchase date" },
  { value: "category_name", label: "Category" },
  { value: "item_name", label: "Item" },
  { value: "location_name", label: "Location" },
  { value: "status", label: "Status" },
];

function displayDate(value) {
  if (!value) return "Date not set";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function MarketingList({ navigate }) {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const pagination = usePagination("marketing-list", "id");

  const load = async () => {
    setLoading(true);
    try {
      const [r, c, u, l] = await Promise.all([
        api("/marketing-list"), api("/meta/categories"), api("/meta/units"), api("/marketing-locations"),
      ]);
      setRows(Array.isArray(r) ? r : []);
      setCategories(Array.isArray(c) ? c : []);
      setUnits(Array.isArray(u) ? u : []);
      setLocations(Array.isArray(l) ? l : []);
      setError("");
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

  const filteredRows = useMemo(() => {
    const term = String(pagination.search || "").trim().toLowerCase();
    const selectedDate = String(form.purchaseDate || "").slice(0, 10);
    const filtered = rows.filter((row) => {
      if (String(row.purchase_date || "").slice(0, 10) !== selectedDate) return false;
      if (form.locationId && String(row.location_id || "") !== String(form.locationId)) return false;
      if (form.categoryId && String(row.category_id || "") !== String(form.categoryId)) return false;
      const haystack = [row.item_name, row.category_name, row.location_name, row.unit_name, row.status, row.purchase_date, row.quantity, row.expense_price]
        .map((value) => String(value ?? "")).join(" ").toLowerCase();
      return !term || haystack.includes(term);
    });
    if (pagination.sortColumn) {
      const column = pagination.sortColumn;
      filtered.sort((a, b) => {
        const result = column === "id"
          ? Number(a.id || 0) - Number(b.id || 0)
          : String(a[column] ?? "").toLowerCase().localeCompare(String(b[column] ?? "").toLowerCase(), undefined, { numeric: true });
        return pagination.sortDirection === "desc" ? -result : result;
      });
    }
    return filtered;
  }, [rows, form.purchaseDate, form.locationId, form.categoryId, pagination.search, pagination.sortColumn, pagination.sortDirection]);

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

  const change = (key, value) => setForm((current) => ({
    ...current,
    [key]: value,
    ...(key === "itemId" ? { itemName: items.find((item) => String(item.id) === String(value))?.name || current.itemName } : {}),
  }));

  const resetForm = ({ preserveSelection = true } = {}) => {
    const selection = preserveSelection ? { categoryId: form.categoryId, purchaseDate: form.purchaseDate, locationId: form.locationId } : {};
    setEditing(null);
    setForm({ ...empty(), ...selection });
  };
  const save = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const payload = { ...form, itemName: form.itemName.trim() };
      await api(editing ? `/marketing-list/${editing}` : "/marketing-list", {
        method: editing ? "PUT" : "POST", body: JSON.stringify(payload),
      });
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

  const edit = (row) => {
    if (row.status !== "pending") return;
    setEditing(row.id);
    setForm({ categoryId: String(row.category_id || ""), itemId: String(row.item_id || ""), itemName: row.item_name || "", quantity: row.quantity ?? "", unitId: String(row.unit_id || ""), purchaseDate: String(row.purchase_date).slice(0, 10), locationId: String(row.location_id || "") });
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
      return `• ${row.item_name}${quantity}`;
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

  const selectionControls = (position) => (
    <div className={`marketing-bulk-toolbar marketing-bulk-toolbar-${position}`}>
      <label className="marketing-select-all"><input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} disabled={!pendingFilteredRows.length} />{allFilteredSelected ? "Deselect all" : "Select all pending items"}</label>
      <span>{selectedPendingRows.length} selected</span>
      {canAddExpenseForSelectedDate ? (
        <button type="button" className="primary" onClick={buySelected} disabled={!selectedPendingRows.length || !selectedCategoryCompatible}>
          <CheckCircle2 size={15} /> Purchased all / Add expense
        </button>
      ) : (
        <span className="marketing-selection-hint" role="status">You can add to expense in future</span>
      )}
      {selectedPendingRows.length > 0 && !selectedCategoryCompatible && <span className="marketing-selection-hint">Select items from one category at a time.</span>}
    </div>
  );

  return (
    <div className="marketing-page marketing-list-page">
      <div className="page-heading"><div><h1>Marketing List</h1><p>One shared shopping list for everyone. Purchased and removed items remain available for reference.</p></div></div>
      {error && <div className="marketing-error" role="alert">{error}</div>}

      <form className="card marketing-form-grid marketing-list-form" onSubmit={save}>
        <div className="marketing-form-title"><ShoppingBasket size={20} /><h2>{editing ? "Edit marketing item" : "Add an item to the list"}</h2></div>
        <label className="marketing-date-field">Date<input required type="date" value={form.purchaseDate} onChange={(event) => { change("purchaseDate", event.target.value); setPage(1); }} /></label>
        <label>Shopping location<select value={form.locationId} onChange={(event) => { change("locationId", event.target.value); setPage(1); }}><option value="">Choose location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Category<select value={form.categoryId} onChange={(event) => { change("categoryId", event.target.value); setPage(1); }}><option value="">Choose category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Known item<select value={form.itemId} onChange={(event) => change("itemId", event.target.value)}><option value="">Custom / type item name</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Item name<input required value={form.itemName} onChange={(event) => change("itemName", event.target.value)} placeholder="e.g. Potatoes" /></label>
        <label>Quantity<input type="number" min="0" step="any" value={form.quantity} onChange={(event) => change("quantity", event.target.value)} placeholder="Quantity" /></label>
        <label>Unit<select value={form.unitId} onChange={(event) => change("unitId", event.target.value)}><option value="">Choose unit</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <div className="marketing-list-form-actions"><button className="primary" type="submit">{editing ? "Save changes" : "Add to marketing list"}</button>{editing && <button type="button" onClick={resetForm}>Cancel</button>}</div>
      </form>

      <section className="marketing-items-section" aria-labelledby="marketing-items-heading">
        <div className="marketing-items-heading"><div><h2 id="marketing-items-heading">Shopping items</h2><p>{filteredRows.length} {filteredRows.length === 1 ? "item" : "items"} for {displayDate(form.purchaseDate)}{form.locationId ? ` · ${locations.find((location) => String(location.id) === String(form.locationId))?.name || "selected location"}` : ""}{form.categoryId ? ` · ${categories.find((category) => String(category.id) === String(form.categoryId))?.name || "selected category"}` : ""}{pagination.search ? " matching your search" : ""}</p></div><div className="marketing-list-legend"><span><i className="status-dot pending-dot" /> Pending</span><span><i className="status-dot purchased-dot" /> Purchased</span></div></div>
        {selectionControls("top")}
        <Pagination page={safePage} setPage={setPage} total={filteredRows.length} {...pagination} sortOptions={sortOptions} />

        {loading ? <div className="marketing-list-empty"><span className="marketing-loading-mark" />Loading marketing list…</div> : visibleRows.length ? (
          <div className="marketing-item-grid">
            {visibleRows.map((row) => {
              const status = row.status === "pending" ? "pending" : row.status === "removed" ? "removed" : "purchased";
              const quantity = status === "purchased" ? (row.purchased_quantity ?? row.quantity ?? "—") : (row.quantity ?? "—");
              const unit = status === "purchased" ? (row.purchased_unit_name || row.unit_name || "") : (row.unit_name || "");
              return <article className={`marketing-item-card status-${status}`} key={row.id}>
                <div className="marketing-item-card-top">{status === "pending" && <label className="marketing-item-checkbox" aria-label={`Select ${row.item_name}`}><input type="checkbox" checked={selectedIds.includes(String(row.id))} onChange={() => toggleOne(row.id)} /><span>Select</span></label>}<span className={`marketing-status-pill ${status}`}>{status === "pending" ? <><Clock3 size={13} /> Pending</> : status === "removed" ? "Removed" : <><CheckCircle2 size={13} /> Purchased</>}</span><span className="marketing-item-date"><CalendarDays size={14} />{displayDate(row.purchase_date)}</span></div>
                <div className="marketing-item-main"><div className="marketing-item-icon"><ShoppingBasket size={21} /></div><div className="marketing-item-name"><h3>{row.item_name || "Unnamed item"}</h3><p>{row.category_name || "Uncategorized"}</p></div></div>
                <div className="marketing-item-details"><div><span>Quantity</span><strong>{quantity} {unit}</strong></div><div><span>Location</span><strong className="marketing-location-value"><MapPin size={14} />{row.location_name || "Not specified"}</strong></div></div>
                {status === "purchased" && <div className="marketing-purchase-price"><Wallet size={16} /><span>Expense price</span><strong>₹{Number(row.expense_price || 0).toFixed(2)}</strong></div>}
                {status === "removed" && <div className="marketing-removed-note">The linked expense was removed.</div>}
                <div className="marketing-item-actions">{status === "pending" ? <button type="button" onClick={() => edit(row)}><Pencil size={15} /> Edit</button> : <span className="marketing-readonly-label">{status === "purchased" ? <><CheckCircle2 size={15} /> Purchased · Read-only</> : "Removed · Read-only"}</span>}</div>
              </article>;
            })}
          </div>
        ) : <div className="marketing-list-empty"><ShoppingBasket size={28} /><strong>{pagination.search || form.locationId || form.categoryId ? "No matching items" : `No items for ${displayDate(form.purchaseDate)}`}</strong><span>{pagination.search || form.locationId || form.categoryId ? "Try changing the date, shopping location, category, or search term above." : "Choose another date or add a shopping item using the form above."}</span></div>}
        {selectionControls("bottom")}
      </section>
    </div>
  );
}
