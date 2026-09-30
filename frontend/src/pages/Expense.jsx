import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { Edit, Trash2, Upload } from "lucide-react";
export default function Expense() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [cats, setCats] = useState([]),
    [units, setUnits] = useState([]),
    [survivors, setSurvivors] = useState([]),
    [items, setItems] = useState([]),
    [f, setF] = useState({
      categoryId: "",
      itemId: "",
      totalCost: "",
      expenseType: "cash",
      shares: [],
    }),
    [edit, setEdit] = useState(null),
    [data, setData] = useState({ rows: [], total: 0, page: 1, pageSize: 10 }),
    [search, setSearch] = useState("");
  useEffect(() => {
    Promise.all([
      api("/meta/categories"),
      api("/meta/units"),
      api("/meta/survivors"),
    ]).then(([c, u, s]) => {
      setCats(c);
      setUnits(u);
      setSurvivors(s);
    });
  }, []);
  useEffect(() => {
    if (f.categoryId)
      api("/meta/items/" + f.categoryId).then((x) => {
        setItems(x);
        setF((v) => ({ ...v, itemId: "" }));
      });
  }, [f.categoryId]);
  const load = () =>
    api(
      `/expenses?date=${date}&page=${data.page}&pageSize=${data.pageSize}&search=${encodeURIComponent(search)}`,
    ).then(setData);
  useEffect(load, [date, data.page, data.pageSize, search]);
  const save = async (e) => {
    e.preventDefault();
    await api(edit ? "/expenses/" + edit : "/expenses", {
      method: edit ? "PUT" : "POST",
      body: JSON.stringify({ ...f, expenseDate: date }),
    });
    setEdit(null);
    setF({
      categoryId: "",
      itemId: "",
      totalCost: "",
      expenseType: "cash",
      shares: [],
    });
    load();
  };
  const addShare = () =>
    setF({
      ...f,
      shares: [
        ...f.shares,
        { survivorId: survivors[0]?.id || "", shareType: "fixed", amount: "" },
      ],
    });
  return (
    <section>
      <h2>Add Expenses</h2>
      <form className="card" onSubmit={save}>
        <div className="formgrid">
          <label>
            Date
            <input
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Category
            <select
              required
              value={f.categoryId}
              onChange={(e) => setF({ ...f, categoryId: e.target.value })}
            >
              <option value="">Select category</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Item
            <select
              value={f.itemId}
              onChange={(e) => setF({ ...f, itemId: e.target.value })}
            >
              <option value="">Total</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
              <option value="other">Other</option>
            </select>
          </label>
          {f.itemId === "other" && (
            <input
              required
              placeholder="Other item"
              value={f.otherItem || ""}
              onChange={(e) => setF({ ...f, otherItem: e.target.value })}
            />
          )}
          <input
            type="number"
            step="any"
            placeholder="Quantity"
            value={f.quantity || ""}
            onChange={(e) => setF({ ...f, quantity: e.target.value })}
          />
          <label>
            Unit
            <select
              value={f.unitId || ""}
              onChange={(e) => setF({ ...f, unitId: e.target.value })}
            >
              <option value="">None</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <input
            required
            type="number"
            step="0.01"
            placeholder="Total cost"
            value={f.totalCost}
            onChange={(e) => setF({ ...f, totalCost: e.target.value })}
          />
          <select
            value={f.expenseType}
            onChange={(e) => setF({ ...f, expenseType: e.target.value })}
          >
            <option value="cash">Cash</option>
            <option value="online">Online</option>
          </select>
        </div>
        <div className="shares">
          <h3>Share of expense — mandatory</h3>
          {f.shares.map((s, i) => (
            <div className="share" key={i}>
              <select
                value={s.survivorId}
                onChange={(e) => {
                  const x = [...f.shares];
                  x[i] = { ...x[i], survivorId: e.target.value };
                  setF({ ...f, shares: x });
                }}
              >
                {survivors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.full_name}
                  </option>
                ))}
              </select>
              <select
                value={s.shareType}
                onChange={(e) => {
                  const x = [...f.shares];
                  x[i] = { ...x[i], shareType: e.target.value };
                  setF({ ...f, shares: x });
                }}
              >
                <option value="fixed">Fixed amount</option>
                <option value="average">Average amount</option>
                <option value="remaining">Remaining amount</option>
              </select>
              {s.shareType === "fixed" && (
                <input
                  required
                  type="number"
                  step="0.01"
                  placeholder="Amount"
                  value={s.amount || ""}
                  onChange={(e) => {
                    const x = [...f.shares];
                    x[i] = { ...x[i], amount: e.target.value };
                    setF({ ...f, shares: x });
                  }}
                />
              )}
              <button
                type="button"
                onClick={() =>
                  setF({ ...f, shares: f.shares.filter((_, j) => j !== i) })
                }
              >
                <Trash2 />
              </button>
            </div>
          ))}
          <button type="button" onClick={addShare}>
            + Add survivor share
          </button>
        </div>
        <button className="primary">{edit ? "Update" : "Add"} expense</button>
      </form>
      <Pagination
        {...{
          page: data.page,
          total: data.total,
          pageSize: data.pageSize,
          setPage: (p) => setData({ ...data, page: p }),
          setPageSize: (s) => setData({ ...data, pageSize: s, page: 1 }),
          search,
          setSearch,
        }}
      />
      <div className="list">
        {data.rows.map((e) => (
          <div className="row expense" key={e.id}>
            <div>
              <strong>
                ₹{Number(e.total_cost).toFixed(2)} — {e.category} /{" "}
                {e.item || "Total"}
              </strong>
              <small>
                {e.expense_type} • {e.quantity || ""} {e.unit || ""} •{" "}
                {e.shares?.map((s) => s.survivorName).join(", ")}
              </small>
            </div>
            <span>
              <button
                onClick={() => {
                  setEdit(e.id);
                  setF({
                    categoryId: e.category_id,
                    itemId: e.item_id || "",
                    otherItem: e.other_item,
                    totalCost: e.total_cost,
                    quantity: e.quantity,
                    unitId: e.unit_id || "",
                    expenseType: e.expense_type,
                    shares: e.shares.map((s) => ({
                      survivorId: s.survivorId,
                      shareType: s.shareType,
                      amount: s.amount,
                    })),
                  });
                }}
              >
                <Edit />
              </button>
              <button
                onClick={async () => {
                  if (confirm("Remove expense?")) {
                    await api("/expenses/" + e.id, { method: "DELETE" });
                    load();
                  }
                }}
              >
                <Trash2 />
              </button>
              <label className="iconbtn">
                <Upload />
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={async (ev) => {
                    const file = ev.target.files[0];
                    if (!file) return;
                    const fd = new FormData();
                    fd.append("proof", file);
                    await api("/expenses/" + e.id + "/proof", {
                      method: "POST",
                      body: fd,
                    });
                    load();
                  }}
                />
              </label>
            </span>
          </div>
        ))}
      </div>
      <Pagination
        {...{
          page: data.page,
          total: data.total,
          pageSize: data.pageSize,
          setPage: (p) => setData({ ...data, page: p }),
          setPageSize: (s) => setData({ ...data, pageSize: s, page: 1 }),
          search,
          setSearch,
        }}
      />
    </section>
  );
}
