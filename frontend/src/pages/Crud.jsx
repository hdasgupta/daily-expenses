import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { Edit, Trash2, Plus } from "lucide-react";

/* =========================================================
   Survivors
   ========================================================= */

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

    async function loadSurvivors() {
      try {
        const result = await api(
          `/survivors?page=${page}&pageSize=${size}&search=${encodeURIComponent(
            search,
          )}`,
          {
            loadingMessage: "Loading survivors…",
          },
        );

        if (cancelled) return;

        setRows(result?.rows || []);
        setTotal(Number(result?.total || 0));
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load survivors:", error);
          setRows([]);
          setTotal(0);
        }
      }
    }

    loadSurvivors();

    return () => {
      cancelled = true;
    };
  }, [page, size, search]);

  useEffect(() => {
    const pin = String(f.pincode || "").replace(/\D/g, "");

    if (pin.length !== 6) {
      setPinStatus("");
      return undefined;
    }

    let cancelled = false;

    setPinStatus("Looking up district and state…");

    async function lookupPincode() {
      try {
        const result = await api(`/pincode/${pin}`, {
          loadingMessage: "Finding district and state…",
        });

        if (cancelled) return;

        const district = result?.district || "";
        const state = result?.state || "";

        setF((previous) => ({
          ...previous,
          district,
          state,
        }));

        setPinStatus(
          district && state
            ? "District and state updated automatically."
            : "Pincode not found.",
        );
      } catch (error) {
        if (!cancelled) {
          console.error("Pincode lookup failed:", error);
          setPinStatus(
            "Pincode lookup failed. You can enter district and state manually.",
          );
        }
      }
    }

    lookupPincode();

    return () => {
      cancelled = true;
    };
  }, [f.pincode]);

  async function save(e) {
    e.preventDefault();

    try {
      await api(edit ? `/survivors/${edit}` : "/survivors", {
        method: edit ? "PUT" : "POST",
        body: JSON.stringify(f),
        loadingMessage: edit ? "Updating survivor…" : "Adding survivor…",
      });

      setEdit(null);
      setF(empty);
      setPinStatus("");

      const result = await api(
        `/survivors?page=${page}&pageSize=${size}&search=${encodeURIComponent(
          search,
        )}`,
        {
          loadingMessage: "Refreshing survivors…",
        },
      );

      setRows(result?.rows || []);
      setTotal(Number(result?.total || 0));
    } catch (error) {
      console.error("Failed to save survivor:", error);
    }
  }

  function editRow(row) {
    setEdit(row.id);

    setF({
      fullName: row.fullName || "",
      fatherName: row.fatherName || "",
      motherName: row.motherName || "",
      nickname: row.nickname || "",
      houseNo: row.houseNo || "",
      street: row.street || "",
      area: row.area || "",
      villageCity: row.villageCity || "",
      pincode: row.pincode || "",
      district: row.district || "",
      state: row.state || "",
    });
  }

  async function deleteRow(id) {
    if (!window.confirm("Delete this survivor?")) return;

    try {
      await api(`/survivors/${id}`, {
        method: "DELETE",
        loadingMessage: "Deleting survivor…",
      });

      const result = await api(
        `/survivors?page=${page}&pageSize=${size}&search=${encodeURIComponent(
          search,
        )}`,
        {
          loadingMessage: "Refreshing survivors…",
        },
      );

      setRows(result?.rows || []);
      setTotal(Number(result?.total || 0));
    } catch (error) {
      console.error("Failed to delete survivor:", error);
    }
  }

  return (
    <section>
      <h2>{edit ? "Edit Survivor" : "Add Survivor"}</h2>

      <form className="card formstack" onSubmit={save}>
        <input
          value={f.fullName}
          onChange={(e) => setF({ ...f, fullName: e.target.value })}
          placeholder="Full Name"
          required
        />

        <input
          value={f.fatherName}
          onChange={(e) => setF({ ...f, fatherName: e.target.value })}
          placeholder="Father Name"
        />

        <input
          value={f.motherName}
          onChange={(e) => setF({ ...f, motherName: e.target.value })}
          placeholder="Mother Name"
        />

        <input
          value={f.nickname}
          onChange={(e) => setF({ ...f, nickname: e.target.value })}
          placeholder="Nickname"
        />

        <input
          value={f.houseNo}
          onChange={(e) => setF({ ...f, houseNo: e.target.value })}
          placeholder="House No"
        />

        <input
          value={f.street}
          onChange={(e) => setF({ ...f, street: e.target.value })}
          placeholder="Street"
        />

        <input
          value={f.area}
          onChange={(e) => setF({ ...f, area: e.target.value })}
          placeholder="Area"
        />

        <input
          value={f.villageCity}
          onChange={(e) => setF({ ...f, villageCity: e.target.value })}
          placeholder="Village / City"
        />

        <input
          value={f.pincode}
          onChange={(e) =>
            setF({
              ...f,
              pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
            })
          }
          placeholder="Pincode"
          inputMode="numeric"
          maxLength={6}
        />

        {pinStatus && <small>{pinStatus}</small>}

        <input
          value={f.district}
          onChange={(e) => setF({ ...f, district: e.target.value })}
          placeholder="District"
        />

        <input
          value={f.state}
          onChange={(e) => setF({ ...f, state: e.target.value })}
          placeholder="State"
        />

        <div className="buttonrow">
          <button type="submit">
            <Plus size={16} />
            {edit ? "Update Survivor" : "Add Survivor"}
          </button>

          {edit && (
            <button
              type="button"
              onClick={() => {
                setEdit(null);
                setF(empty);
                setPinStatus("");
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="card">
        <h3>Survivors</h3>

        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search survivors..."
        />

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Father</th>
                <th>Mother</th>
                <th>Pincode</th>
                <th>District</th>
                <th>State</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="7">No survivors found.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.fullName}</td>
                    <td>{row.fatherName}</td>
                    <td>{row.motherName}</td>
                    <td>{row.pincode}</td>
                    <td>{row.district}</td>
                    <td>{row.state}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => editRow(row)}
                        title="Edit"
                      >
                        <Edit size={16} />
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteRow(row.id)}
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          pageSize={size}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setSize(Number(value));
            setPage(1);
          }}
        />
      </div>
    </section>
  );
}

/* =========================================================
   Categories & Items
   ========================================================= */

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
  const [editId, setEditId] = useState(null);

  /*
   * Load categories.
   *
   * IMPORTANT:
   * The effect itself is synchronous. Do NOT do:
   *
   * useEffect(loadCats, []);
   *
   * when loadCats is async because React can interpret the
   * returned Promise as an effect cleanup.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const result = await api("/meta/categories", {
          loadingMessage: "Loading categories…",
        });

        if (cancelled) return;

        /*
         * Support both:
         *   [...]
         * and
         *   { rows: [...] }
         */
        const categoryRows = Array.isArray(result)
          ? result
          : Array.isArray(result?.rows)
            ? result.rows
            : Array.isArray(result?.categories)
              ? result.categories
              : [];

        console.log("Categories API response:", result);
        console.log("Categories parsed:", categoryRows);

        setCats(categoryRows);

        /*
         * If the currently selected category disappeared,
         * clear it.
         */
        if (categoryRows.length > 0) {
          setCat((current) => {
            if (!current) return current;

            const exists = categoryRows.some((c) => {
              const id =
                c?.id ??
                c?.category_id ??
                c?.categoryId ??
                c?.value ??
                c?.code;

              return String(id) === String(current);
            });

            return exists ? current : "";
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load categories:", error);
          setCats([]);
        }
      }
    }

    loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Load items whenever category/page/pageSize changes.
   */
  useEffect(() => {
    let cancelled = false;

    if (!cat) {
      setItems({
        rows: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });

      return () => {
        cancelled = true;
      };
    }

    async function loadItems() {
      try {
        const url =
          `/items?categoryId=${encodeURIComponent(cat)}` +
          `&page=${items.page}` +
          `&pageSize=${items.pageSize}` +
          `&search=`;

        console.log("Category selected:", cat);
        console.log("Loading items:", url);

        const result = await api(url, {
          loadingMessage: "Loading items…",
        });

        if (cancelled) return;

        console.log("Items API response:", result);

        /*
         * Support all common response shapes:
         *
         * {
         *   rows: [],
         *   total: 10,
         *   page: 1,
         *   pageSize: 10
         * }
         *
         * or:
         *
         * []
         */
        let rows = [];
        let total = 0;
        let page = items.page;
        let pageSize = items.pageSize;

        if (Array.isArray(result)) {
          rows = result;
          total = result.length;
        } else if (result && typeof result === "object") {
          if (Array.isArray(result.rows)) {
            rows = result.rows;
          } else if (Array.isArray(result.items)) {
            rows = result.items;
          } else if (Array.isArray(result.data)) {
            rows = result.data;
          }

          total = Number(
            result.total ??
              result.count ??
              result.totalCount ??
              rows.length,
          );

          page = Number(result.page ?? items.page);
          pageSize = Number(result.pageSize ?? items.pageSize);
        }

        setItems({
          rows,
          total,
          page,
          pageSize,
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load items:", error);

          setItems((previous) => ({
            ...previous,
            rows: [],
            total: 0,
          }));
        }
      }
    }

    loadItems();

    return () => {
      cancelled = true;
    };
  }, [cat, items.page, items.pageSize]);

  function getCategoryId(category) {
    return (
      category?.id ??
      category?.category_id ??
      category?.categoryId ??
      category?.value ??
      category?.code ??
      ""
    );
  }

  function getCategoryName(category) {
    return (
      category?.name ??
      category?.label ??
      category?.category_name ??
      category?.categoryName ??
      category?.code ??
      getCategoryId(category)
    );
  }

  function getItemId(item) {
    return item?.id ?? item?.item_id ?? item?.itemId;
  }

  function getItemName(item) {
    return (
      item?.name ??
      item?.item_name ??
      item?.itemName ??
      item?.label ??
      ""
    );
  }

  function selectCategory(e) {
    const value = e.target.value;

    console.log("Category selected:", value);

    setCat(value);

    /*
     * Always restart pagination when changing category.
     */
    setItems((previous) => ({
      ...previous,
      rows: [],
      total: 0,
      page: 1,
    }));
  }

  async function saveItem(e) {
    e.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName) {
      return;
    }

    if (!cat) {
      window.alert("Please select a category.");
      return;
    }

    try {
      if (editId) {
        await api(`/items/${editId}`, {
          method: "PUT",
          body: JSON.stringify({
            name: trimmedName,
            categoryId: cat,
          }),
          loadingMessage: "Updating item…",
        });
      } else {
        await api("/items", {
          method: "POST",
          body: JSON.stringify({
            name: trimmedName,
            categoryId: cat,
          }),
          loadingMessage: "Adding item…",
        });
      }

      setName("");
      setEditId(null);

      /*
       * Reload the current category.
       *
       * Changing page to itself does not trigger useEffect,
       * so force the item state through a temporary refresh.
       */
      const result = await api(
        `/items?categoryId=${encodeURIComponent(cat)}` +
          `&page=${items.page}` +
          `&pageSize=${items.pageSize}` +
          `&search=`,
        {
          loadingMessage: "Refreshing items…",
        },
      );

      const rows = Array.isArray(result)
        ? result
        : result?.rows || result?.items || result?.data || [];

      const total = Array.isArray(result)
        ? result.length
        : Number(result?.total ?? result?.count ?? rows.length);

      setItems((previous) => ({
        ...previous,
        rows,
        total,
      }));
    } catch (error) {
      console.error("Failed to save item:", error);
    }
  }

  function editItem(item) {
    const id = getItemId(item);

    setEditId(id);
    setName(getItemName(item));
  }

  async function deleteItem(item) {
    const id = getItemId(item);

    if (!id) return;

    if (!window.confirm(`Delete "${getItemName(item)}"?`)) {
      return;
    }

    try {
      await api(`/items/${id}`, {
        method: "DELETE",
        loadingMessage: "Deleting item…",
      });

      /*
       * Reload items after deletion.
       */
      const result = await api(
        `/items?categoryId=${encodeURIComponent(cat)}` +
          `&page=${items.page}` +
          `&pageSize=${items.pageSize}` +
          `&search=`,
        {
          loadingMessage: "Refreshing items…",
        },
      );

      const rows = Array.isArray(result)
        ? result
        : result?.rows || result?.items || result?.data || [];

      const total = Array.isArray(result)
        ? result.length
        : Number(result?.total ?? result?.count ?? rows.length);

      setItems((previous) => ({
        ...previous,
        rows,
        total,
      }));
    } catch (error) {
      console.error("Failed to delete item:", error);
    }
  }

  return (
    <section>
      <h2>Categories &amp; Items</h2>

      <div className="card formstack">
        <label htmlFor="category-select">Category</label>

        <select
          id="category-select"
          value={cat}
          onChange={selectCategory}
        >
          <option value="">Select category</option>

          {cats.map((category, index) => {
            const id = getCategoryId(category);
            const label = getCategoryName(category);

            return (
              <option key={String(id || index)} value={String(id)}>
                {label}
              </option>
            );
          })}
        </select>
      </div>

      {cat && (
        <>
          <div className="card">
            <h3>{editId ? "Edit Item" : "Add Item"}</h3>

            <form className="formstack" onSubmit={saveItem}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Item name"
                required
              />

              <div className="buttonrow">
                <button type="submit">
                  <Plus size={16} />
                  {editId ? "Update Item" : "Add Item"}
                </button>

                {editId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditId(null);
                      setName("");
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="card">
            <h3>Items</h3>

            {items.rows.length === 0 ? (
              <p>No items found for this category.</p>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {items.rows.map((item, index) => {
                      const id = getItemId(item);
                      const itemName = getItemName(item);

                      return (
                        <tr key={String(id || index)}>
                          <td>{itemName}</td>

                          <td>
                            <button
                              type="button"
                              onClick={() => editItem(item)}
                              title="Edit"
                            >
                              <Edit size={16} />
                            </button>

                            <button
                              type="button"
                              onClick={() => deleteItem(item)}
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <Pagination
              page={items.page}
              pageSize={items.pageSize}
              total={items.total}
              onPageChange={(newPage) =>
                setItems((previous) => ({
                  ...previous,
                  page: Number(newPage),
                }))
              }
              onPageSizeChange={(newSize) =>
                setItems((previous) => ({
                  ...previous,
                  page: 1,
                  pageSize: Number(newSize),
                }))
              }
            />
          </div>
        </>
      )}
    </section>
  );
}

/* =========================================================
   Units
   ========================================================= */

export function Units() {
  const [data, setData] = useState({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 10,
  });

  const [name, setName] = useState("");
  const [editId, setEditId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUnits() {
      try {
        const result = await api(
          `/units?page=${data.page}&pageSize=${data.pageSize}&search=`,
          {
            loadingMessage: "Loading units…",
          },
        );

        if (cancelled) return;

        setData({
          rows: result?.rows || [],
          total: Number(result?.total || 0),
          page: Number(result?.page || data.page),
          pageSize: Number(result?.pageSize || data.pageSize),
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load units:", error);

          setData((previous) => ({
            ...previous,
            rows: [],
            total: 0,
          }));
        }
      }
    }

    loadUnits();

    return () => {
      cancelled = true;
    };
  }, [data.page, data.pageSize]);

  async function saveUnit(e) {
    e.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName) return;

    try {
      await api(editId ? `/units/${editId}` : "/units", {
        method: editId ? "PUT" : "POST",
        body: JSON.stringify({
          name: trimmedName,
        }),
        loadingMessage: editId ? "Updating unit…" : "Adding unit…",
      });

      setName("");
      setEditId(null);

      const result = await api(
        `/units?page=${data.page}&pageSize=${data.pageSize}&search=`,
        {
          loadingMessage: "Refreshing units…",
        },
      );

      setData({
        rows: result?.rows || [],
        total: Number(result?.total || 0),
        page: Number(result?.page || data.page),
        pageSize: Number(result?.pageSize || data.pageSize),
      });
    } catch (error) {
      console.error("Failed to save unit:", error);
    }
  }

  function editUnit(row) {
    setEditId(row.id);
    setName(row.name || "");
  }

  async function deleteUnit(id) {
    if (!window.confirm("Delete this unit?")) return;

    try {
      await api(`/units/${id}`, {
        method: "DELETE",
        loadingMessage: "Deleting unit…",
      });

      const result = await api(
        `/units?page=${data.page}&pageSize=${data.pageSize}&search=`,
        {
          loadingMessage: "Refreshing units…",
        },
      );

      setData({
        rows: result?.rows || [],
        total: Number(result?.total || 0),
        page: Number(result?.page || data.page),
        pageSize: Number(result?.pageSize || data.pageSize),
      });
    } catch (error) {
      console.error("Failed to delete unit:", error);
    }
  }

  return (
    <section>
      <h2>Units</h2>

      <div className="card">
        <h3>{editId ? "Edit Unit" : "Add Unit"}</h3>

        <form className="formstack" onSubmit={saveUnit}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Unit name"
            required
          />

          <div className="buttonrow">
            <button type="submit">
              <Plus size={16} />
              {editId ? "Update Unit" : "Add Unit"}
            </button>

            {editId && (
              <button
                type="button"
                onClick={() => {
                  setEditId(null);
                  setName("");
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <h3>Units</h3>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan="2">No units found.</td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>

                    <td>
                      <button
                        type="button"
                        onClick={() => editUnit(row)}
                        title="Edit"
                      >
                        <Edit size={16} />
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteUnit(row.id)}
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={(newPage) =>
            setData((previous) => ({
              ...previous,
              page: Number(newPage),
            }))
          }
          onPageSizeChange={(newSize) =>
            setData((previous) => ({
              ...previous,
              page: 1,
              pageSize: Number(newSize),
            }))
          }
        />
      </div>
    </section>
  );
}
