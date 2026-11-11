import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  Eye,
  FileSpreadsheet,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { usePagination } from "../hooks/usePagination";
import { formatDateKolkata, todayKolkata as today } from "../utils/dates.js";

const TOTAL_ITEM = "__total__";
const OTHER_ITEM = "__other__";

function formatExpenseDate(dateStr) {
  return formatDateKolkata(dateStr);
}

/**
 * Renders newline feeds (\n or \r\n) in expense comments as HTML <br /> elements.
 */
function renderMultilineComment(comment) {
  const text = String(comment ?? "");
  if (!text.trim()) return "-";
  const lines = text.split(/\r?\n/);
  return lines.map((line, index) => (
    <React.Fragment key={index}>
      {line}
      {index < lines.length - 1 && <br />}
    </React.Fragment>
  ));
}

function emptyForm(expenseDate = today()) {
  return {
    expenseDate,
    categoryId: "",
    itemId: TOTAL_ITEM,
    otherItem: "",
    quantity: "",
    unitId: "",
    totalCost: "",
    expenseType: "cash",
    comment: "",
    proofFile: null,
    shares: [],
  };
}

function resolvedShares(totalCost, shares) {
  if (!Array.isArray(shares) || shares.length === 0) {
    return {
      values: {},
      valid: false,
      reason: "Add at least one survivor share",
    };
  }

  const fixedShares = shares.filter((share) => share.shareType === "fixed");
  for (const share of fixedShares) {
    const raw = String(share.amount ?? "").trim();
    if (raw === "") {
      return {
        values: {},
        valid: false,
        reason: "Fixed amount of a survivor cannot be blank",
      };
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) {
      return {
        values: {},
        valid: false,
        reason: "Fixed amount of a survivor must be greater than zero",
      };
    }
  }

  const total = Number(totalCost || 0);
  const fixed = fixedShares.reduce((sum, share) => sum + Number(share.amount || 0), 0);

  const average = shares.filter((share) => share.shareType === "average");
  const remainingList = shares.filter((share) => share.shareType === "remaining");
  const remaining = remainingList[0];

  if (average.length === 1) {
    return {
      values: {},
      valid: false,
      reason: "Average amount requires at least 2 survivors",
    };
  }

  if (remainingList.length > 1) {
    return {
      values: {},
      valid: false,
      reason: "Only one remaining share is allowed",
    };
  }

  if (average.length && remainingList.length) {
    return {
      values: {},
      valid: false,
      reason: "Use average shares or one remaining share, not both",
    };
  }

  let left = Math.round((total - fixed) * 100) / 100;

  if (left < 0) {
    return {
      values: {},
      valid: false,
      reason: "Fixed shares exceed total cost",
    };
  }

  const values = {};

  if (average.length) {
    const cents = Math.round(left * 100);
    const baseCents = Math.floor(cents / average.length);
    const extraCents = cents % average.length;

    average.forEach((share, index) => {
      values[share.survivorId] = (baseCents + (index < extraCents ? 1 : 0)) / 100;
    });

    left = 0;
  }

  if (remaining) {
    values[remaining.survivorId] = Math.max(0, left);
    left = 0;
  }

  shares
    .filter((share) => share.shareType === "fixed")
    .forEach((share) => {
      values[share.survivorId] = Number(share.amount || 0);
    });

  const hasDynamic = average.length || Boolean(remaining);

  const valid = Math.abs(left) < 0.01 && (hasDynamic || Math.abs(fixed - total) < 0.01);

  return {
    values,
    valid,
    reason: valid ? "" : "Share amounts must equal total cost",
  };
}

export default function Expense() {
  const pagination = usePagination("expenses", "expense_date");

  const [page, setPage] = useState(1);
  const [date, setDate] = useState(today());
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);

  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [survivors, setSurvivors] = useState([]);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);

  const [proofExpense, setProofExpense] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [proofViewerUrl, setProofViewerUrl] = useState("");
  const [deleteId, setDeleteId] = useState(null);
  const [formError, setFormError] = useState("");
  const [proofInputKey, setProofInputKey] = useState(0);
  const [scanningProof, setScanningProof] = useState(false);
  const [scanFeedback, setScanFeedback] = useState("");
  const proofInputRef = useRef(null);
  const modalProofInputRef = useRef(null);
  const scanSeqRef = useRef(0);

  const resetProofInput = () => {
    scanSeqRef.current += 1;
    setScanningProof(false);
    setScanFeedback("");
    if (proofInputRef.current) {
      proofInputRef.current.value = "";
    }
    setProofInputKey((current) => current + 1);
  };

  const shareCalculation = useMemo(
    () => resolvedShares(form.totalCost, form.shares),
    [form.totalCost, form.shares],
  );

  const loadMeta = async () => {
    const [categoryData, unitData, survivorData] = await Promise.all([
      api("/meta/categories", {
        loadingMessage: "Loading expense categories…",
      }),
      api("/meta/units", {
        loadingMessage: "Loading expense units…",
      }),
      api("/meta/survivors", {
        loadingMessage: "Loading survivors…",
      }),
    ]);

    setCategories(categoryData);
    setUnits(unitData);
    setSurvivors(survivorData);
  };

  const loadItems = async (categoryId) => {
    const result = await api(`/meta/items?categoryId=${encodeURIComponent(categoryId)}`, {
      loadingMessage: "Loading category items…",
    });

    setItems(result);
  };

  const loadExpenses = async (customPage = page, customDate = date) => {
    if (!pagination.ready) return;

    const query = new URLSearchParams({
      date: customDate,
      page: customPage,
      pageSize: pagination.pageSize,
      search: pagination.search || "",
      sortColumn: pagination.sortColumn || "expense_date",
      sortDirection: pagination.sortDirection || "asc",
    });

    const result = await api(`/expenses?${query.toString()}`, {
      loadingMessage: "Loading expenses…",
    });

    setRows(result.rows || []);
    setTotal(result.total || 0);
  };

  useEffect(() => {
    loadMeta().catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const prefill = JSON.parse(localStorage.getItem("marketing-purchase-prefill") || "null");
      if (prefill && typeof prefill === "object") {
        const nextDate = prefill.expenseDate || today();
        setDate(nextDate);
        setForm((current) => ({
          ...current,
          expenseDate: nextDate,
          categoryId: prefill.categoryId ? String(prefill.categoryId) : current.categoryId,
          itemId: prefill.itemId ? String(prefill.itemId) : prefill.otherItem ? OTHER_ITEM : TOTAL_ITEM,
          otherItem: prefill.otherItem || "",
          quantity: prefill.quantity ?? "",
          unitId: prefill.unitId ? String(prefill.unitId) : "",
          totalCost: prefill.totalCost ?? "",
          comment: prefill.comment || "",
        }));
      }
    } catch {
      // Ignore prefill parse errors
    }
  }, []);

  useEffect(() => {
    loadExpenses().catch(() => {});
  }, [
    date,
    page,
    pagination.pageSize,
    pagination.search,
    pagination.sortColumn,
    pagination.sortDirection,
    pagination.ready,
  ]);

  useEffect(() => {
    setPage(1);
  }, [date, pagination.pageSize, pagination.search]);

  useEffect(() => {
    if (!form.categoryId) {
      setItems([]);
      return;
    }

    loadItems(form.categoryId).catch(() => {});
  }, [form.categoryId]);

  const updateField = (key, value) =>
    setForm((current) => ({
      ...current,
      [key]: value,
    }));

  const addShare = () => {
    const used = new Set(form.shares.map((share) => String(share.survivorId)));

    const available = survivors.find((survivor) => !used.has(String(survivor.id)));

    if (!available) return;

    updateField("shares", [
      ...form.shares,
      {
        survivorId: String(available.id),
        shareType: "remaining",
        amount: "",
      },
    ]);
  };

  const editShare = (index, key, value) =>
    updateField(
      "shares",
      form.shares.map((share, currentIndex) =>
        currentIndex === index
          ? {
              ...share,
              [key]: value,
            }
          : share,
      ),
    );

  const removeShare = (index) =>
    setForm((current) => {
      const nextShares = current.shares.filter((_, currentIndex) => currentIndex !== index);
      if (nextShares.length === 1 && nextShares[0].shareType === "average") {
        nextShares[0] = { ...nextShares[0], shareType: "remaining", amount: "" };
      }
      return { ...current, shares: nextShares };
    });

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");

    if (!shareCalculation.valid) {
      setFormError(shareCalculation.reason);
      return;
    }

    const payload = { ...form };
    delete payload.proofFile;

    const result = await api(editingId ? `/expenses/${editingId}` : "/expenses", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(payload),
      loadingMessage: editingId ? "Updating expense…" : "Adding expense…",
    });

    const expenseId = result.id;
    let marketingPrefill = null;
    try {
      marketingPrefill = JSON.parse(localStorage.getItem("marketing-purchase-prefill") || "null");
    } catch {
      marketingPrefill = null;
    }
    if ((marketingPrefill?.marketingItemId || Array.isArray(marketingPrefill?.marketingItemIds)) && expenseId) {
      try {
        if (Array.isArray(marketingPrefill.marketingItemIds)) {
          await api("/marketing-list/purchased-bulk", {
            method: "POST",
            body: JSON.stringify({ itemIds: marketingPrefill.marketingItemIds, expenseId, price: payload.totalCost }),
          });
        } else {
          await api(`/marketing-list/${marketingPrefill.marketingItemId}/purchased`, {
            method: "POST",
            body: JSON.stringify({ expenseId, price: payload.totalCost, quantity: payload.quantity, unitId: payload.unitId }),
          });
        }
        localStorage.removeItem("marketing-purchase-prefill");
      } catch (error) {
        setFormError(`Expense saved, but the Marketing List status could not be updated: ${error.message || "Please retry from Marketing List"}`);
      }
    }

    if (form.proofFile && expenseId) {
      const data = new FormData();
      data.append("proof", form.proofFile);

      await api(`/expenses/${expenseId}/proof`, {
        method: "POST",
        body: data,
        loadingMessage: "Uploading proof…",
      });
    }

    const savedDate = String(payload.expenseDate);

    setEditingId(null);
    setDate(savedDate);
    setPage(1);
    setForm(emptyForm(savedDate));
    resetProofInput();

    await loadExpenses(1, savedDate);
  };

  const beginEdit = async (row) => {
    setEditingId(row.id);
    setDate(row.expense_date.slice(0, 10));

    setForm({
      expenseDate: row.expense_date.slice(0, 10),
      categoryId: String(row.category_id),
      itemId: row.item_id ? String(row.item_id) : row.other_item ? OTHER_ITEM : TOTAL_ITEM,
      otherItem: row.other_item || "",
      quantity: row.quantity ?? "",
      unitId: row.unit_id ? String(row.unit_id) : "",
      totalCost: row.total_cost,
      expenseType: row.expense_type || "cash",
      comment: row.comment || "",
      proofFile: null,
      shares: Array.isArray(row.shares)
        ? row.shares.map((share) => ({
            survivorId: String(share.survivorId),
            shareType: share.shareType,
            amount: share.shareType === "fixed" ? share.amount : "",
          }))
        : [],
    });

    resetProofInput();

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const remove = async () => {
    await api(`/expenses/${deleteId}`, {
      method: "DELETE",
      loadingMessage: "Removing expense…",
    });

    setDeleteId(null);
    await loadExpenses();
  };

  const submitProof = async (event) => {
    event.preventDefault();

    if (!proofFile || !proofExpense) return;

    const data = new FormData();
    data.append("proof", proofFile);

    await api(`/expenses/${proofExpense.id}/proof`, {
      method: "POST",
      body: data,
      loadingMessage: "Uploading proof…",
    });

    setProofFile(null);
    setProofExpense(null);

    await loadExpenses();
  };

  const openProof = async (row) => {
    const result = await api(`/expenses/${row.id}/proof-url`, {
      loadingMessage: "Opening proof…",
    });

    setProofViewerUrl(result.url || "");
  };

  const sortOptions = [
    { value: "expense_date", label: "Date" },
    { value: "category", label: "Category" },
    { value: "total_cost", label: "Total cost" },
  ];

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Add Expenses</h1>
          <p>Record an expense and allocate its cost across survivors.</p>
        </div>
      </div>

      <form className="card form-stack" onSubmit={submit}>
        <div className="section-label">Expense details</div>

        <label>
          Date of expense
          <input
            type="date"
            max={today()}
            value={form.expenseDate}
            onChange={(e) => {
              setDate(e.target.value);
              updateField("expenseDate", e.target.value);
            }}
            required
          />
        </label>

        <label>
          Category
          <select
            value={form.categoryId}
            required
            onChange={(e) => {
              updateField("categoryId", e.target.value);
              updateField("itemId", TOTAL_ITEM);
              updateField("otherItem", "");
            }}
          >
            <option value="">Select category</option>

            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Item
          <select
            value={form.itemId}
            onChange={(e) => {
              updateField("itemId", e.target.value);

              if (e.target.value !== OTHER_ITEM) {
                updateField("otherItem", "");
              }
            }}
            disabled={!form.categoryId}
          >
            <option value={TOTAL_ITEM}>Total</option>

            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}

            <option value={OTHER_ITEM}>Other</option>
          </select>
        </label>

        {form.itemId === OTHER_ITEM ? (
          <label>
            Other item name
            <input
              required
              value={form.otherItem}
              onChange={(e) => updateField("otherItem", e.target.value)}
            />
          </label>
        ) : null}

        <div className="grid-2">
          <label>
            Quantity (optional)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.quantity}
              onChange={(e) => updateField("quantity", e.target.value)}
            />
          </label>

          <label>
            Unit (optional)
            <select
              value={form.unitId}
              onChange={(e) => updateField("unitId", e.target.value)}
            >
              <option value="">Select unit</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Total cost (₹)
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            value={form.totalCost}
            onChange={(e) => updateField("totalCost", e.target.value)}
          />
        </label>

        <label>
          Expense type
          <select
            value={form.expenseType}
            onChange={(e) => updateField("expenseType", e.target.value)}
          >
            <option value="cash">Cash</option>
            <option value="online">Online</option>
          </select>
        </label>

        <label>
          Comment
          <textarea
            rows="3"
            value={form.comment}
            onChange={(e) => updateField("comment", e.target.value)}
          />
        </label>

        <div className="shares-panel">
          <div className="shares-heading">
            <div>
              <strong>Share of expense — mandatory</strong>

              <span>Fixed, average and remaining shares are resolved against total cost.</span>
            </div>

            <button
              className="secondary"
              type="button"
              onClick={addShare}
              disabled={!survivors.length || form.shares.length >= survivors.length}
            >
              <Plus size={17} /> Add survivor
            </button>
          </div>

          {form.shares.map((share, index) => (
            <div className="share-row" key={`${share.survivorId}-${index}`}>
              <label>
                Survivor
                <select
                  required
                  value={share.survivorId}
                  onChange={(e) => editShare(index, "survivorId", e.target.value)}
                >
                  {survivors.map((survivor) => (
                    <option
                      key={survivor.id}
                      value={survivor.id}
                      disabled={form.shares.some(
                        (other, otherIndex) =>
                          otherIndex !== index && String(other.survivorId) === String(survivor.id),
                      )}
                    >
                      {survivor.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Share type
                <div
                  role="group"
                  aria-label="Share type"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: "0.5rem",
                  }}
                >
                  {[
                    ["fixed", "Fixed amount"],
                    ["average", "Average amount"],
                    ["remaining", "Remaining amount"],
                  ].map(([value, label]) => {
                    const selected = share.shareType === value;
                    const isAverageDisabled = value === "average" && form.shares.length < 2;

                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        disabled={isAverageDisabled}
                        title={
                          isAverageDisabled
                            ? "Add at least 2 survivors to use Average amount"
                            : label
                        }
                        className={selected ? "primary" : "secondary"}
                        onClick={() => editShare(index, "shareType", value)}
                        style={{
                          minHeight: "42px",
                          justifyContent: "center",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </label>

              <label>
                Share price
                <input
                  type="number"
                  min={share.shareType === "fixed" ? "0.01" : "0"}
                  step="0.01"
                  required={share.shareType === "fixed"}
                  placeholder={share.shareType === "fixed" ? "Enter amount (> 0)" : "Auto-calculated"}
                  value={
                    share.shareType === "fixed"
                      ? share.amount
                      : shareCalculation.values[share.survivorId] !== undefined && form.totalCost
                        ? shareCalculation.values[share.survivorId]
                        : ""
                  }
                  onChange={(e) => editShare(index, "amount", e.target.value)}
                  readOnly={share.shareType === "average" || share.shareType === "remaining"}
                />
              </label>

              <button
                className="icon-button danger-soft"
                type="button"
                title="Remove survivor share"
                onClick={() => removeShare(index)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}

          {!form.shares.length ? (
            <div className="notice">
              <X size={16} /> Add at least one survivor share.
            </div>
          ) : null}

          {form.shares.length && (form.totalCost || !shareCalculation.valid) ? (
            <div className={`share-result ${shareCalculation.valid ? "valid" : "invalid"}`}>
              <span>{shareCalculation.valid ? <Check size={16} /> : <X size={16} />}</span>

              {shareCalculation.valid
                ? "Share allocation matches total cost."
                : shareCalculation.reason}
            </div>
          ) : null}
        </div>

        {formError ? (
          <div className="notice error-notice">
            <X size={16} /> {formError}
          </div>
        ) : null}

        <div className="form-actions">
          <button className="primary" type="submit">
            <UploadCloud size={18} />

            {editingId ? "Update expense" : "Add expense"}
          </button>

          <button
            className="secondary"
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm(date));
              setFormError("");
              resetProofInput();
            }}
          >
            <RotateCcw size={17} /> Reset
          </button>
        </div>
      </form>

      <div className="card">
        <Pagination
          page={page}
          setPage={setPage}
          total={total}
          {...pagination}
          sortOptions={sortOptions}
        />

        <div className="table-wrap desktop-only">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Total</th>
                <th>Type</th>
                <th>Comment</th>
                <th>Shares</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatExpenseDate(row.expense_date)}</td>
                  <td>{row.category_name}</td>
                  <td>{row.item_name || row.other_item || "Total"}</td>
                  <td>{row.quantity ? `${row.quantity} ${row.unit_name || ""}` : "-"}</td>
                  <td>₹{Number(row.total_cost).toFixed(2)}</td>
                  <td>{row.expense_type || "cash"}</td>
                  <td>{renderMultilineComment(row.comment)}</td>
                  <td style={{ whiteSpace: "pre-line" }}>
                    {(row.shares || []).map((share, idx, arr) => (
                      <span key={share.survivorId || idx}>
                        {`${share.survivorName} ₹${Number(share.amount).toFixed(2)}`}
                        {idx < arr.length - 1 ? <br /> : null}
                      </span>
                    ))}
                  </td>
                  <td>
                    <div className="row-actions">
                      {row.proof_path ? (
                        <button
                          className="icon-button"
                          type="button"
                          title="View proof"
                          onClick={() => openProof(row)}
                        >
                          <Eye size={16} />
                        </button>
                      ) : null}
                      <button
                        className="icon-button"
                        type="button"
                        title="Edit expense"
                        onClick={() => beginEdit(row)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        title="Delete expense"
                        onClick={() => setDeleteId(row.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan="9" className="empty-cell">
                    No expenses recorded for this date.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mobile-cards mobile-only">
          {rows.map((row) => (
            <article className="mobile-card" key={row.id}>
              <div className="mobile-card-head">
                <strong>{row.category_name} — {row.item_name || row.other_item || "Total"}</strong>
                <span>
                  {formatExpenseDate(row.expense_date)} · ₹{Number(row.total_cost).toFixed(2)} ·{" "}
                  {row.expense_type || "cash"}
                </span>
              </div>
              {row.comment ? (
                <div className="mobile-card-comment">
                  {renderMultilineComment(row.comment)}
                </div>
              ) : null}
              <div className="mobile-card-shares" style={{ whiteSpace: "pre-line" }}>
                {(row.shares || []).map((share, idx, arr) => (
                  <span key={share.survivorId || idx}>
                    {`${share.survivorName} ₹${Number(share.amount).toFixed(2)}`}
                    {idx < arr.length - 1 ? <br /> : null}
                  </span>
                ))}
              </div>
              <div className="row-actions">
                {row.proof_path ? (
                  <button
                    className="icon-button"
                    type="button"
                    title="View proof"
                    onClick={() => openProof(row)}
                  >
                    <Eye size={16} />
                  </button>
                ) : null}
                <button
                  className="icon-button"
                  type="button"
                  title="Edit expense"
                  onClick={() => beginEdit(row)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  title="Delete expense"
                  onClick={() => setDeleteId(row.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>

        <Pagination
          page={page}
          setPage={setPage}
          total={total}
          {...pagination}
          sortOptions={sortOptions}
        />
      </div>
    </section>
  );
}
