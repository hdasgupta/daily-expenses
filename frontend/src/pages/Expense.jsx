import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { Edit, Trash2, Upload } from "lucide-react";

const emptyForm = {
  categoryId: "",
  itemId: "",
  otherItem: "",
  quantity: "",
  unitId: "",
  totalCost: "",
  expenseType: "cash",
  shares: [],
};

export default function Expense() {
  const [date, setDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const [cats, setCats] = useState([]);
  const [units, setUnits] = useState([]);
  const [survivors, setSurvivors] = useState([]);
  const [items, setItems] = useState([]);

  const [f, setF] = useState(emptyForm);

  const [edit, setEdit] = useState(null);

  const [data, setData] = useState({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 10,
  });

  const [search, setSearch] = useState("");

  /*
   * Load categories, units and survivors.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      try {
        const [c, u, s] = await Promise.all([
          api("/meta/categories", {
            loadingMessage: "Loading categories…",
          }),
          api("/meta/units", {
            loadingMessage: "Loading units…",
          }),
          api("/meta/survivors", {
            loadingMessage: "Loading survivors…",
          }),
        ]);

        if (cancelled) return;

        setCats(Array.isArray(c) ? c : []);
        setUnits(Array.isArray(u) ? u : []);
        setSurvivors(Array.isArray(s) ? s : []);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load expense metadata:", error);
          window.alert(error.message || "Unable to load expense data");
        }
      }
    }

    loadMeta();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Load items whenever category changes.
   */
  useEffect(() => {
    if (!f.categoryId) {
      setItems([]);
      return undefined;
    }

    let cancelled = false;

    async function loadItems() {
      try {
        const result = await api(
          `/meta/items/${encodeURIComponent(f.categoryId)}`,
          {
            loadingMessage: "Loading items…",
          },
        );

        if (cancelled) return;

        setItems(Array.isArray(result) ? result : []);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load items:", error);
          setItems([]);
          window.alert(error.message || "Unable to load items");
        }
      }
    }

    loadItems();

    return () => {
      cancelled = true;
    };
  }, [f.categoryId]);

  /*
   * Load expense list.
   *
   * IMPORTANT:
   * Do not use:
   *
   *   useEffect(load, [...])
   *
   * because load() returns a Promise.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadExpenses() {
      try {
        const result = await api(
          `/expenses?date=${encodeURIComponent(date)}` +
            `&page=${data.page}` +
            `&pageSize=${data.pageSize}` +
            `&search=${encodeURIComponent(search)}`,
          {
            loadingMessage: "Loading expenses…",
          },
        );

        if (cancelled) return;

        setData({
          rows: Array.isArray(result?.rows) ? result.rows : [],
          total: Number(result?.total || 0),
          page: Number(result?.page || data.page),
          pageSize: Number(result?.pageSize || data.pageSize),
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load expenses:", error);

          setData((previous) => ({
            ...previous,
            rows: [],
            total: 0,
          }));
        }
      }
    }

    loadExpenses();

    return () => {
      cancelled = true;
    };
  }, [date, data.page, data.pageSize, search]);

  async function refreshExpenses() {
    try {
      const result = await api(
        `/expenses?date=${encodeURIComponent(date)}` +
          `&page=${data.page}` +
          `&pageSize=${data.pageSize}` +
          `&search=${encodeURIComponent(search)}`,
        {
          loadingMessage: "Refreshing expenses…",
        },
      );

      setData({
        rows: Array.isArray(result?.rows) ? result.rows : [],
        total: Number(result?.total || 0),
        page: Number(result?.page || data.page),
        pageSize: Number(result?.pageSize || data.pageSize),
      });
    } catch (error) {
      console.error("Failed to refresh expenses:", error);
      window.alert(error.message || "Unable to refresh expenses");
    }
  }

  function updateField(field, value) {
    setF((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  function changeCategory(value) {
    setF((previous) => ({
      ...previous,
      categoryId: value,
      itemId: "",
      otherItem: "",
    }));
  }

  function changeItem(value) {
    setF((previous) => ({
      ...previous,
      itemId: value,
      otherItem: value === "other" ? previous.otherItem : "",
    }));
  }

  async function save(e) {
    e.preventDefault();

    try {
      if (!f.categoryId) {
        window.alert("Please select a category.");
        return;
      }

      if (!f.totalCost || Number(f.totalCost) <= 0) {
        window.alert("Please enter a valid total cost.");
        return;
      }

      if (!Array.isArray(f.shares) || f.shares.length === 0) {
        window.alert("At least one survivor share is required.");
        return;
      }

      for (const share of f.shares) {
        if (!share.survivorId) {
          window.alert("Please select a survivor for every share.");
          return;
        }

        if (
          share.shareType === "fixed" &&
          (!share.amount || Number(share.amount) <= 0)
        ) {
          window.alert("Please enter a valid amount for every fixed share.");
          return;
        }
      }

      if (f.itemId === "other" && !f.otherItem?.trim()) {
        window.alert("Please enter the other item name.");
        return;
      }

      /*
       * IMPORTANT:
       *
       * "other" is a UI value and must NEVER be sent
       * as itemId to PostgreSQL.
       *
       * When "Other" is selected:
       * itemId = null
       * otherItem = entered text
       */
      const payload = {
        expenseDate: date,
        categoryId: f.categoryId,
        itemId:
          f.itemId && f.itemId !== "other"
            ? f.itemId
            : null,
        otherItem:
          f.itemId === "other"
            ? f.otherItem?.trim() || null
            : null,
        quantity: f.quantity || null,
        unitId: f.unitId || null,
        totalCost: f.totalCost,
        expenseType: f.expenseType || "cash",
        shares: f.shares.map((share) => ({
          survivorId: share.survivorId,
          shareType: share.shareType,
          amount:
            share.shareType === "fixed"
              ? share.amount || null
              : null,
        })),
      };

      console.log(
        edit ? "Updating expense:" : "Adding expense:",
        payload,
      );

      await api(edit ? `/expenses/${edit}` : "/expenses", {
        method: edit ? "PUT" : "POST",
        body: JSON.stringify(payload),
        loadingMessage: edit
          ? "Updating expense…"
          : "Adding expense…",
      });

      setEdit(null);
      setF(emptyForm);

      await refreshExpenses();
    } catch (error) {
      console.error("Failed to save expense:", error);
      window.alert(error.message || "Unable to save expense");
    }
  }

  function addShare() {
    if (!survivors.length) {
      window.alert(
        "No survivors are available. Please add a survivor first.",
      );
      return;
    }

    setF((previous) => ({
      ...previous,
      shares: [
        ...previous.shares,
        {
          survivorId: String(survivors[0].id),
          shareType: "fixed",
          amount: "",
        },
      ],
    }));
  }

  function updateShare(index, field, value) {
    setF((previous) => {
      const shares = [...previous.shares];

      shares[index] = {
        ...shares[index],
        [field]: value,
      };

      if (field === "shareType" && value !== "fixed") {
        shares[index].amount = "";
      }

      return {
        ...previous,
        shares,
      };
    });
  }

  function removeShare(index) {
    setF((previous) => ({
      ...previous,
      shares: previous.shares.filter((_, i) => i !== index),
    }));
  }

  function editExpense(expense) {
    setEdit(expense.id);

    setF({
      categoryId: String(expense.category_id || ""),
      itemId: expense.item_id
        ? String(expense.item_id)
        : expense.other_item
          ? "other"
          : "",
      otherItem: expense.other_item || "",
      quantity: expense.quantity ?? "",
      unitId: expense.unit_id
        ? String(expense.unit_id)
        : "",
      totalCost: expense.total_cost ?? "",
      expenseType: expense.expense_type || "cash",
      shares: Array.isArray(expense.shares)
        ? expense.shares.map((share) => ({
            survivorId: String(share.survivorId),
            shareType: share.shareType,
            amount: share.amount ?? "",
          }))
        : [],
    });
  }

  function cancelEdit() {
    setEdit(null);
    setF(emptyForm);
  }

  async function deleteExpense(id) {
    if (!window.confirm("Remove expense?")) return;

    try {
      await api(`/expenses/${id}`, {
        method: "DELETE",
        loadingMessage: "Deleting expense…",
      });

      await refreshExpenses();
    } catch (error) {
      console.error("Failed to delete expense:", error);
      window.alert(error.message || "Unable to delete expense");
    }
  }

  async function uploadProof(expenseId, file) {
    if (!file) return;

    try {
      const fd = new FormData();
      fd.append("proof", file);

      await api(`/expenses/${expenseId}/proof`, {
        method: "POST",
        body: fd,
        loadingMessage: "Uploading proof…",
      });

      await refreshExpenses();
    } catch (error) {
      console.error("Failed to upload proof:", error);
      window.alert(error.message || "Unable to upload proof");
    }
  }

  return (
    <section>
      <h2>{edit ? "Edit Expense" : "Add Expenses"}</h2>

      <form className="card" onSubmit={save}>
        <div className="formgrid">
          <label>
            Date
            <input
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>

          <label>
            Category
            <select
              required
              value={f.categoryId}
              onChange={(e) => changeCategory(e.target.value)}
            >
              <option value="">Select category</option>

              {cats.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Item
            <select
              value={f.itemId}
              onChange={(e) => changeItem(e.target.value)}
            >
              <option value="">Total</option>

              {items.map((i) => (
                <option key={i.id} value={String(i.id)}>
                  {i.name}
                </option>
              ))}

              <option value="other">Other</option>
            </select>
          </label>

          {f.itemId === "other" && (
            <label>
              Other item
              <input
                required
                placeholder="Other item"
                value={f.otherItem}
                onChange={(e) =>
                  updateField("otherItem", e.target.value)
                }
              />
            </label>
          )}

          <label>
            Quantity
            <input
              type="number"
              step="any"
              min="0"
              placeholder="Quantity"
              value={f.quantity}
              onChange={(e) =>
                updateField("quantity", e.target.value)
              }
            />
          </label>

          <label>
            Unit
            <select
              value={f.unitId}
              onChange={(e) =>
                updateField("unitId", e.target.value)
              }
            >
              <option value="">None</option>

              {units.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Total cost
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              placeholder="Total cost"
              value={f.totalCost}
              onChange={(e) =>
                updateField("totalCost", e.target.value)
              }
            />
          </label>

          <label>
            Expense type
            <select
              value={f.expenseType}
              onChange={(e) =>
                updateField("expenseType", e.target.value)
              }
            >
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </select>
          </label>
        </div>

        <div className="shares">
          <h3>Share of expense — mandatory</h3>

          {f.shares.length === 0 && (
            <p>
              Add at least one survivor share before saving the
              expense.
            </p>
          )}

          {f.shares.map((share, index) => (
            <div className="share" key={index}>
              <label>
                Survivor
                <select
                  required
                  value={share.survivorId}
                  onChange={(e) =>
                    updateShare(
                      index,
                      "survivorId",
                      e.target.value,
                    )
                  }
                >
                  <option value="">Select survivor</option>

                  {survivors.map((survivor) => (
                    <option
                      key={survivor.id}
                      value={String(survivor.id)}
                    >
                      {survivor.full_name}
                      {survivor.nickname
                        ? ` (${survivor.nickname})`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Share type
                <select
                  value={share.shareType}
                  onChange={(e) =>
                    updateShare(
                      index,
                      "shareType",
                      e.target.value,
                    )
                  }
                >
                  <option value="fixed">Fixed amount</option>
                  <option value="average">Average amount</option>
                  <option value="remaining">
                    Remaining amount
                  </option>
                </select>
              </label>

              {share.shareType === "fixed" && (
                <label>
                  Amount
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="Amount"
                    value={share.amount}
                    onChange={(e) =>
                      updateShare(
                        index,
                        "amount",
                        e.target.value,
                      )
                    }
                  />
                </label>
              )}

              <button
                type="button"
                onClick={() => removeShare(index)}
                title="Remove survivor share"
              >
                <Trash2 />
              </button>
            </div>
          ))}

          <button type="button" onClick={addShare}>
            + Add survivor share
          </button>
        </div>

        <div className="buttonrow">
          <button className="primary" type="submit">
            {edit ? "Update" : "Add"} expense
          </button>

          {edit && (
            <button type="button" onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="card">
        <h3>Expenses</h3>

        <div className="list">
          {data.rows.length === 0 ? (
            <p>No expenses found for this date.</p>
          ) : (
            data.rows.map((expense) => (
              <div
                className="row expense"
                key={expense.id}
              >
                <div>
                  <strong>
                    ₹
                    {Number(expense.total_cost || 0).toFixed(2)}
                    {" — "}
                    {expense.category}
                    {" / "}
                    {expense.item ||
                      expense.other_item ||
                      "Total"}
                  </strong>

                  <small>
                    {expense.expense_type}
                    {" • "}
                    {expense.quantity || ""}
                    {" "}
                    {expense.unit || ""}
                    {" • "}
                    {Array.isArray(expense.shares)
                      ? expense.shares
                          .map(
                            (share) =>
                              share.survivorName,
                          )
                          .join(", ")
                      : ""}
                  </small>
                </div>

                <span>
                  <button
                    type="button"
                    onClick={() => editExpense(expense)}
                    title="Edit"
                  >
                    <Edit />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      deleteExpense(expense.id)
                    }
                    title="Delete"
                  >
                    <Trash2 />
                  </button>

                  <label
                    className="iconbtn"
                    title="Upload proof"
                  >
                    <Upload />

                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={(event) => {
                        const file =
                          event.target.files?.[0];

                        uploadProof(expense.id, file);

                        event.target.value = "";
                      }}
                    />
                  </label>
                </span>
              </div>
            ))
          )}
        </div>

        <Pagination
          page={data.page}
          total={data.total}
          pageSize={data.pageSize}
          setPage={(page) =>
            setData((previous) => ({
              ...previous,
              page: Number(page),
            }))
          }
          setPageSize={(pageSize) =>
            setData((previous) => ({
              ...previous,
              page: 1,
              pageSize: Number(pageSize),
            }))
          }
          search={search}
          setSearch={(value) => {
            setSearch(value);
            setData((previous) => ({
              ...previous,
              page: 1,
            }));
          }}
        />
      </div>
    </section>
  );
}
