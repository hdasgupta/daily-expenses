import React, { useEffect, useMemo, useState } from "react";
import { Check, Eye, FileUp, Plus, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { formatDateKolkata, todayKolkata } from "../utils/dates.js";
import Modal from "../components/Modal";
import ProofViewer from "../components/ProofViewer";
import ConfirmDialog from "../components/ConfirmDialog";
import { usePagination } from "../hooks/usePagination";

const TOTAL_ITEM = "__total__";
const OTHER_ITEM = "__other__";

function formatExpenseDate(value) {
  return formatDateKolkata(value);
}

const today = todayKolkata;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function emptyForm(date = today()) {
  return {
    expenseDate: date,
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
  const total = Number(totalCost || 0);
  const fixed = shares
    .filter((share) => share.shareType === "fixed")
    .reduce((sum, share) => sum + Number(share.amount || 0), 0);

  const average = shares.filter((share) => share.shareType === "average");

  const remaining = shares.find((share) => share.shareType === "remaining");

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

    /*
     * Metadata endpoints normally return arrays. Accept arrays as well as
     * paginated { rows }, { data }, or { items } responses so an API-shape
     * difference can never cause a .map() runtime error in this page.
     */
    setCategories(asArray(categoryData));
    setUnits(asArray(unitData));
    setSurvivors(asArray(survivorData));
  };

  const loadItems = async (selectedCategory) => {
    if (!selectedCategory) {
      setItems([]);
      return;
    }

    const data = await api(`/meta/items/${selectedCategory}`, {
      loadingMessage: "Loading items…",
    });

    setItems(asArray(data));
  };

  const loadExpenses = async (requestedPage = page, requestedDate = date) => {
    if (!pagination.ready) return;

    const result = await api(
      `/expenses?date=${encodeURIComponent(requestedDate)}&page=${requestedPage}&pageSize=${
        pagination.pageSize
      }&search=${encodeURIComponent(pagination.search)}&sortColumn=${encodeURIComponent(
        pagination.sortColumn || "expense_date",
      )}&sortDirection=${pagination.sortDirection}`,
      {
        loadingMessage: "Loading expenses…",
      },
    );

    setRows(Array.isArray(result?.rows) ? result.rows : []);
    setTotal(Number(result?.total || 0));
  };

  useEffect(() => {
    loadMeta().catch(() => {});
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
        shareType: "fixed",
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
    updateField(
      "shares",
      form.shares.filter((_, currentIndex) => currentIndex !== index),
    );

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
            Other item
            <input
              required
              value={form.otherItem}
              onChange={(e) => updateField("otherItem", e.target.value)}
            />
          </label>
        ) : null}

        <label>
          Quantity
          <input
            type="number"
            min="0"
            step="0.0001"
            value={form.quantity}
            onChange={(e) => updateField("quantity", e.target.value)}
          />
        </label>

        <label>
          Unit
          <select value={form.unitId} onChange={(e) => updateField("unitId", e.target.value)}>
            <option value="">No unit</option>

            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Total cost
          <input
            required
            type="number"
            min="0"
            step="0.01"
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

        <label>
          Attach proof (optional)
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => updateField("proofFile", e.target.files?.[0] || null)}
          />
          <small className="field-note">
            Images are converted to PDF before S3-compatible storage upload.
          </small>
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

                   return (
                     <button
                       key={value}
                       type="button"
                       aria-pressed={selected}
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
                  step="0.01"
                  min="0"
                  readOnly={share.shareType !== "fixed"}
                  required={share.shareType === "fixed"}
                  value={
                    share.shareType === "fixed"
                      ? share.amount
                      : (shareCalculation.values[share.survivorId] ?? "")
                  }
                  onChange={(e) => editShare(index, "amount", e.target.value)}
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

          {form.shares.length && form.totalCost ? (
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
            }}
          >
            <RotateCcw size={17} /> Reset
          </button>
        </div>
      </form>

      <div className="subheading">
        <div>
          <h2>Expenses for {date}</h2>
          <p>All expenses recorded for the selected date.</p>
        </div>
      </div>

      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[
          {
            value: "expense_date",
            label: "Date",
          },
          {
            value: "category",
            label: "Category",
          },
          {
            value: "item",
            label: "Item",
          },
          {
            value: "total_cost",
            label: "Cost",
          },
          {
            value: "expense_type",
            label: "Type",
          },
        ]}
      />

      <div className="list-stack">
        {rows.map((row) => (
          <article className="list-card expense-card" key={row.id}>
            <div className="list-main">
              <strong>
                {formatExpenseDate(row.expense_date)} · ₹{Number(row.total_cost).toFixed(2)} ·{" "}
                {row.category} · {row.item || row.other_item || "Total"}
              </strong>

              {row.quantity !== null && row.quantity !== undefined && row.quantity !== "" ? (
                <span>
                  {row.quantity}
                  {row.unit ? ` ${row.unit}` : ""}
                </span>
              ) : null}

              <span>{row.comment || "No comment"}</span>

              <span>
                Shares:{" "}
                {(Array.isArray(row.shares) ? row.shares : [])
                  .map(
                    (share) =>
                      `${share.survivorName} ₹${Number(share.amount).toFixed(
                        2,
                      )} (${share.shareType})`,
                  )
                  .join(" · ")}
              </span>
            </div>

            <div className="row-actions">
              <button
                className="icon-button soft"
                title="Update expense"
                onClick={() => beginEdit(row)}
              >
                <Edit3Icon />
              </button>

              <button
                className="icon-button soft"
                title="Upload proof"
                onClick={() => {
                  setProofExpense(row);
                  setProofFile(null);
                }}
              >
                <FileUp size={17} />
              </button>

              {row.proof_key ? (
                <button
                  className="icon-button soft"
                  title="Open proof"
                  onClick={() => openProof(row)}
                >
                  <Eye size={17} />
                </button>
              ) : null}

              <button
                className="icon-button danger-soft"
                title="Remove expense"
                onClick={() => setDeleteId(row.id)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}

        {!rows.length ? (
          <div className="empty-card">No expenses recorded for this date.</div>
        ) : null}
      </div>

      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[
          {
            value: "expense_date",
            label: "Date",
          },
          {
            value: "category",
            label: "Category",
          },
          {
            value: "item",
            label: "Item",
          },
          {
            value: "total_cost",
            label: "Cost",
          },
          {
            value: "expense_type",
            label: "Type",
          },
        ]}
      />

      <Modal
        open={Boolean(proofExpense)}
        title={`Upload proof for expense #${proofExpense?.id || ""}`}
        onClose={() => setProofExpense(null)}
        footer={
          <>
            <button className="secondary" onClick={() => setProofExpense(null)}>
              Cancel
            </button>

            <button className="primary" form="proof-form">
              Submit
            </button>
          </>
        }
      >
        <form id="proof-form" className="form-stack" onSubmit={submitProof}>
          <label>
            Proof file
            <input
              required
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => setProofFile(e.target.files?.[0] || null)}
            />
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteId)}
        message="This will permanently remove the expense and its survivor shares."
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />

      <ProofViewer
        url={proofViewerUrl}
        title="Expense proof"
        onClose={() => setProofViewerUrl("")}
      />
    </section>
  );
}

function Edit3Icon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}
