import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { Edit, Trash2, Plus } from "lucide-react";

export function Survivors() {
  const empty = {
    fullName: "",
    fatherName: "",
    motherName: "",
    nickname: "",
    houseNo: "",
    street: "",
    area: "",
    villageCity: "",
    pincode: "",
    district: "",
    state: "",
  };

  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [f, setF] = useState(empty);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [pinStatus, setPinStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadSurvivors = async () => {
      try {
        const x = await api(
          `/survivors?page=${page}&pageSize=${size}&search=${encodeURIComponent(
            search,
          )}`,
          { loadingMessage: "Loading survivors…" },
        );

        if (!cancelled) {
          setRows(x.rows || []);
          setTotal(x.total || 0);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load survivors:", error);
        }
      }
    };

    loadSurvivors();

    return () => {
      cancelled = true;
    };
  }, [page, size, search]);

  useEffect(() => {
    const pin = String(f.pincode || "").replace(/\D/g, "");

    if (pin.length !== 6) {
      setPinStatus("");
      return;
    }

    let cancelled = false;

    const lookupPincode = async () => {
      setPinStatus("Looking up district and state…");

      try {
        const x = await api(`/pincode/${pin}`, {
          loadingMessage: "Finding district and state…",
        });

        if (cancelled) return;

        setF((v) => ({
          ...v,
          district: x.district || "",
          state: x.state || "",
        }));

        setPinStatus(
          x.district && x.state
            ? "District and state updated automatically."
            : "Pincode not found.",
        );
      } catch {
        if (!cancelled) {
          setPinStatus(
            "Pincode lookup failed. You can enter district and state manually.",
          );
        }
      }
    };

    lookupPincode();

    return () => {
      cancelled = true;
    };
  }, [f.pincode]);

  const save = async (e) => {
    e.preventDefault();

    try {
      await api(edit ? `/survivors/${edit}` : "/survivors", {
        method: edit ? "PUT" : "POST",
        body: JSON.stringify(f),
        loadingMessage: edit
          ? "Updating survivor…"
          : "Adding survivor…",
      });

      setEdit(null);
      setF(empty);
      setPage(1);
    } catch (error) {
      console.error("Failed to save survivor:", error);
    }
  };

  return (
    <section>
      <h2>{edit ? "Edit Survivor" : "Add Survivor"}</h2>

      <form className="card formstack" onSubmit={save}>
        <label>
          Full name
          <input
            required
            value={f.fullName}
            onChange={(e) =>
              setF({ ...f, fullName: e.target.value })
            }
          />
        </label>

        <label>
          Father's full name
          <input
            value={f.fatherName}
            onChange={(e) =>
              setF({ ...f, fatherName: e.target.value })
            }
          />
        </label>

        <label>
          Mother's full name
          <input
            value={f.motherName}
            onChange={(e) =>
              setF({ ...f, motherName: e.target.value })
            }
          />
        </label>

        <label>
          Nickname
          <input
            value={f.nickname}
            onChange={(e) =>
              setF({ ...f, nickname: e.target.value })
            }
          />
        </label>

        <label>
          House number
          <input
            value={f.houseNo}
            onChange={(e) =>
              setF({ ...f, houseNo: e.target.value })
            }
          />
        </label>

        <label>
          Street name
          <input
            value={f.street}
            onChange={(e) =>
              setF({ ...f, street: e.target.value })
            }
          />
        </label>

        <label>
          Area
          <input
            value={f.area}
            onChange={(e) =>
              setF({ ...f, area: e.target.value })
            }
          />
        </label>

        <label>
          Village / City
          <input
            value={f.villageCity}
            onChange={(e) =>
              setF({ ...f, villageCity: e.target.value })
            }
          />
        </label>

        <label>
          Pincode
          <input
            inputMode="numeric"
            maxLength="6"
            value={f.pincode}
            onChange={(e) =>
              setF({
                ...f,
                pincode: e.target.value
                  .replace(/\D/g, "")
                  .slice(0, 6),
              })
            }
          />
        </label>

        <label>
          District
          <input
            value={f.district}
            onChange={(e) =>
              setF({ ...f, district: e.target.value })
            }
          />
        </label>

        <label>
          State
          <input
            value={f.state}
            onChange={(e) =>
              setF({ ...f, state: e.target.value })
            }
          />
        </label>

        {pinStatus && <div className="notice">{pinStatus}</div>}

        <button className="primary">
          <Plus />
          {edit ? "Update" : "Add"} survivor
        </button>
      </form>

      <Pagination
        page={page}
        total={total}
        pageSize={size}
        setPage={setPage}
        setPageSize={setSize}
        search={search}
        setSearch={setSearch}
      />

      <div className="list">
        {rows.map((r) => (
          <div className="row" key={r.id}>
            <div>
              <strong>{r.full_name}</strong>

              <small>
                {[
                  r.nickname,
                  r.village_city,
                  r.district,
                  r.state,
                  r.pincode,
                ]
                  .filter(Boolean)
                  .join(" • ")}
              </small>
            </div>

            <span>
              <button
                type="button"
                onClick={() => {
                  setEdit(r.id);

                  setF({
                    fullName: r.full_name,
                    fatherName: r.father_name || "",
                    motherName: r.mother_name || "",
                    nickname: r.nickname || "",
                    houseNo: r.house_no || "",
                    street: r.street || "",
                    area: r.area || "",
                    villageCity: r.village_city || "",
                    pincode: r.pincode || "",
                    district: r.district || "",
                    state: r.state || "",
                  });
                }}
              >
                <Edit />
              </button>

              <button
                type="button"
                onClick={async () => {
                  if (!confirm("Remove survivor?")) return;

                  try {
                    await api(`/survivors/${r.id}`, {
                      method: "DELETE",
                      loadingMessage: "Removing survivor…",
                    });

                    setPage(1);
                  } catch (error) {
                    console.error(
                      "Failed to remove survivor:",
                      error,
                    );
                  }
                }}
              >
                <Trash2 />
              </button>
            </span>
          </div>
        ))}
      </div>

      <Pagination
        page={page}
        total={total}
        pageSize={size}
        setPage={setPage}
        setPageSize={setSize}
        search={search}
        setSearch={setSearch}
      />
    </section>
  );
}

export function CategoriesItems() {
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState("");
  const [items, setItems] = useState({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 10,
  });
  const [name, setName] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadCategories = async () => {
      try {
        const result = await api("/meta/categories", {
          loadingMessage: "Loading categories…",
        });

        if (!cancelled) {
          setCats(Array.isArray(result) ? result : []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load categories:", error);
        }
      }
    };

    loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cat) {
      setItems((current) => ({
        ...current,
        rows: [],
        total: 0,
        page: 1,
      }));

      return;
    }

    let cancelled = false;

    const loadItems = async () => {
      try {
        const result = await api(
          `/items?categoryId=${encodeURIComponent(
            cat,
          )}&page=${items.page}&pageSize=${items.pageSize}&search=`,
          {
            loadingMessage: "Loading items…",
          },
        );

        if (!cancelled) {
          setItems({
            rows: result.rows || [],
            total: result.total || 0,
            page: result.page || items.page,
            pageSize: result.pageSize || items.pageSize,
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load items:", error);
        }
      }
    };

    loadItems();

    return () => {
      cancelled = true;
    };
  }, [cat, items.page, items.pageSize]);

  const addItem = async (e) => {
    e.preventDefault();

    if (!cat || !name.trim()) return;

    try {
      await api("/items", {
        method: "POST",
        body: JSON.stringify({
          categoryId: cat,
          name: name.trim(),
        }),
        loadingMessage: "Adding item…",
      });

      setName("");

      setItems((current) => ({
        ...current,
        page: 1,
      }));
    } catch (error) {
      console.error("Failed to add item:", error);
    }
  };

  const editItem = async (item) => {
    const newName = prompt("Item", item.name);

    if (!newName || !newName.trim()) return;

    try {
      await api(`/items/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: newName.trim(),
        }),
        loadingMessage: "Updating item…",
      });

      setItems((current) => ({
        ...current,
        rows: current.rows.map((x) =>
          x.id === item.id
            ? { ...x, name: newName.trim() }
            : x,
        ),
      }));
    } catch (error) {
      console.error("Failed to update item:", error);
    }
  };

  const deleteItem = async (item) => {
    if (!confirm(`Remove "${item.name}"?`)) return;

    try {
      await api(`/items/${item.id}`, {
        method: "DELETE",
        loadingMessage: "Removing item…",
      });

      setItems((current) => ({
        ...current,
        rows: current.rows.filter((x) => x.id !== item.id),
        total: Math.max(0, current.total - 1),
      }));
    } catch (error) {
      console.error("Failed to remove item:", error);
    }
  };

  return (
    <section>
      <h2>Categories &amp; Items</h2>

      <div className="card formstack">
        <label>
          Category
          <select
            value={cat}
            onChange={(e) => {
              const value = e.target.value;

              setCat(value);

              setItems((current) => ({
                ...current,
                rows: [],
                total: 0,
                page: 1,
              }));
            }}
          >
            <option value="">Select category</option>

            {cats.map((c) => (
              <option key={c.id ?? c.code} value={c.id ?? c.code}>
                {c.name ?? c.label}
              </option>
            ))}
          </select>
        </label>

        {cat && (
          <form className="inline" onSubmit={addItem}>
            <input
              required
              placeholder="Item name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <button className="primary" type="submit">
              <Plus />
              Add item
            </button>
          </form>
        )}
      </div>

      {cat && (
        <>
          <div className="list">
            {items.rows.map((item) => (
              <div className="row" key={item.id}>
                <strong>{item.name}</strong>

                <span>
                  <button
                    type="button"
                    onClick={() => editItem(item)}
                  >
                    <Edit />
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteItem(item)}
                  >
                    <Trash2 />
                  </button>
                </span>
              </div>
            ))}

            {!items.rows.length && (
              <div className="notice">
                No items found for this category.
              </div>
            )}
          </div>

          <Pagination
            page={items.page}
            total={items.total}
            pageSize={items.pageSize}
            setPage={(page) =>
              setItems((current) => ({
                ...current,
                page,
              }))
            }
            setPageSize={(pageSize) =>
              setItems((current) => ({
                ...current,
                pageSize,
                page: 1,
              }))
            }
            search=""
            setSearch={() => {}}
          />
        </>
      )}
    </section>
  );
}

export function Units() {
  const [data, setData] = useState({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 10,
  });

  const [name, setName] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadUnits = async () => {
      try {
        const result = await api(
          `/units?page=${data.page}&pageSize=${data.pageSize}&search=`,
          {
            loadingMessage: "Loading units…",
          },
        );

        if (!cancelled) {
          setData(result);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load units:", error);
        }
      }
    };

    loadUnits();

    return () => {
      cancelled = true;
    };
  }, [data.page, data.pageSize]);

  const addUnit = async (e) => {
    e.preventDefault();

    try {
      await api("/units", {
        method: "POST",
        body: JSON.stringify({ name }),
        loadingMessage: "Adding unit…",
      });

      setName("");

      setData((current) => ({
        ...current,
        page: 1,
      }));
    } catch (error) {
      console.error("Failed to add unit:", error);
    }
  };

  return (
    <section>
      <h2>Units</h2>

      <form className="card inline" onSubmit={addUnit}>
        <input
          required
          placeholder="Unit"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <button className="primary" type="submit">
          <Plus />
          Add unit
        </button>
      </form>

      <div className="list">
        {data.rows.map((u) => (
          <div className="row" key={u.id}>
            <strong>{u.name}</strong>

            <span>
              <button
                type="button"
                onClick={async () => {
                  const n = prompt("Unit", u.name);

                  if (!n || !n.trim()) return;

                  try {
                    await api(`/units/${u.id}`, {
                      method: "PUT",
                      body: JSON.stringify({
                        name: n.trim(),
                      }),
                      loadingMessage: "Updating unit…",
                    });

                    setData((current) => ({
                      ...current,
                      rows: current.rows.map((x) =>
                        x.id === u.id
                          ? { ...x, name: n.trim() }
                          : x,
                      ),
                    }));
                  } catch (error) {
                    console.error(
                      "Failed to update unit:",
                      error,
                    );
                  }
                }}
              >
                <Edit />
              </button>

              <button
                type="button"
                onClick={async () => {
                  if (!confirm("Remove unit?")) return;

                  try {
                    await api(`/units/${u.id}`, {
                      method: "DELETE",
                      loadingMessage: "Removing unit…",
                    });

                    setData((current) => ({
                      ...current,
                      rows: current.rows.filter(
                        (x) => x.id !== u.id,
                      ),
                      total: Math.max(
                        0,
                        current.total - 1,
                      ),
                    }));
                  } catch (error) {
                    console.error(
                      "Failed to remove unit:",
                      error,
                    );
                  }
                }}
              >
                <Trash2 />
              </button>
            </span>
          </div>
        ))}
      </div>

      <Pagination
        page={data.page}
        total={data.total}
        pageSize={data.pageSize}
        setPage={(page) =>
          setData((current) => ({
            ...current,
            page,
          }))
        }
        setPageSize={(pageSize) =>
          setData((current) => ({
            ...current,
            pageSize,
            page: 1,
          }))
        }
        search=""
        setSearch={() => {}}
      />
    </section>
  );
}
