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
  const [rows, setRows] = useState([]),
    [edit, setEdit] = useState(null),
    [f, setF] = useState(empty),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [search, setSearch] = useState(""),
    [total, setTotal] = useState(0),
    [pinStatus, setPinStatus] = useState("");
  const load = () =>
    api(
      `/survivors?page=${page}&pageSize=${size}&search=${encodeURIComponent(search)}`,
      { loadingMessage: "Loading survivors…" },
    ).then((x) => {
      setRows(x.rows);
      setTotal(x.total);
    });
  useEffect(load, [page, size, search]);
  useEffect(() => {
    const pin = String(f.pincode || "").replace(/\D/g, "");
    if (pin.length !== 6) {
      setPinStatus("");
      return;
    }
    setPinStatus("Looking up district and state…");
    api(`/pincode/${pin}`, { loadingMessage: "Finding district and state…" })
      .then((x) => {
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
      })
      .catch(() =>
        setPinStatus(
          "Pincode lookup failed. You can enter district and state manually.",
        ),
      );
  }, [f.pincode]);
  const save = async (e) => {
    e.preventDefault();
    await api(edit ? `/survivors/${edit}` : "/survivors", {
      method: edit ? "PUT" : "POST",
      body: JSON.stringify(f),
      loadingMessage: edit ? "Updating survivor…" : "Adding survivor…",
    });
    setEdit(null);
    setF(empty);
    load();
  };
  return (
    <section>
      <h2>Add Survivor</h2>
      <form className="card formstack" onSubmit={save}>
        <label>
          Full name
          <input
            required
            value={f.fullName}
            onChange={(e) => setF({ ...f, fullName: e.target.value })}
          />
        </label>
        <label>
          Father's full name
          <input
            value={f.fatherName}
            onChange={(e) => setF({ ...f, fatherName: e.target.value })}
          />
        </label>
        <label>
          Mother's full name
          <input
            value={f.motherName}
            onChange={(e) => setF({ ...f, motherName: e.target.value })}
          />
        </label>
        <label>
          Nickname
          <input
            value={f.nickname}
            onChange={(e) => setF({ ...f, nickname: e.target.value })}
          />
        </label>
        <label>
          House number
          <input
            value={f.houseNo}
            onChange={(e) => setF({ ...f, houseNo: e.target.value })}
          />
        </label>
        <label>
          Street name
          <input
            value={f.street}
            onChange={(e) => setF({ ...f, street: e.target.value })}
          />
        </label>
        <label>
          Area
          <input
            value={f.area}
            onChange={(e) => setF({ ...f, area: e.target.value })}
          />
        </label>
        <label>
          Village / City
          <input
            value={f.villageCity}
            onChange={(e) => setF({ ...f, villageCity: e.target.value })}
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
                pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
              })
            }
          />
        </label>
        <label>
          District
          <input
            value={f.district}
            onChange={(e) => setF({ ...f, district: e.target.value })}
          />
        </label>
        <label>
          State
          <input
            value={f.state}
            onChange={(e) => setF({ ...f, state: e.target.value })}
          />
        </label>
        {pinStatus && <div className="notice">{pinStatus}</div>}
        <button className="primary">
          <Plus />
          {edit ? "Update" : "Add"} survivor
        </button>
      </form>
      <Pagination
        {...{
          page,
          total,
          pageSize: size,
          setPage,
          setPageSize: setSize,
          search,
          setSearch,
        }}
      />
      <div className="list">
        {rows.map((r) => (
          <div className="row" key={r.id}>
            <div>
              <strong>{r.full_name}</strong>
              <small>
                {[r.nickname, r.village_city, r.district, r.state, r.pincode]
                  .filter(Boolean)
                  .join(" • ")}
              </small>
            </div>
            <span>
              <button
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
                onClick={async () => {
                  if (confirm("Remove survivor?")) {
                    await api("/survivors/" + r.id, {
                      method: "DELETE",
                      loadingMessage: "Removing survivor…",
                    });
                    load();
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
        {...{
          page,
          total,
          pageSize: size,
          setPage,
          setPageSize: setSize,
          search,
          setSearch,
        }}
      />
    </section>
  );
}
export function CategoriesItems() {
  const [cats, setCats] = useState([]),
    [cat, setCat] = useState(""),
    [items, setItems] = useState({ rows: [], total: 0, page: 1, pageSize: 10 }),
    [name, setName] = useState("");
  const loadCats = () => api("/meta/categories").then(setCats);
  const load = () =>
    cat &&
    api(
      `/items?categoryId=${cat}&page=${items.page}&pageSize=${items.pageSize}&search=`,
    ).then(setItems);
  useEffect(() => {
    loadCats();
  }, []);
  useEffect(load, [cat, items.page, items.pageSize]);
  return (
    <section>
      <h2>Categories & Items</h2>
      <div className="card inline">
        <select
          value={cat}
          onChange={(e) => {
            setCat(e.target.value);
            setItems({ ...items, page: 1 });
          }}
        >
          <option value="">Select category</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={async () => {
            const n = prompt("Category name");
            if (n) {
              await api("/categories", {
                method: "POST",
                body: JSON.stringify({ name: n }),
              });
              loadCats();
            }
          }}
        >
          <Plus /> Category
        </button>
        {cat && (
          <>
            <button
              onClick={async () => {
                const n = prompt(
                  "New category name",
                  cats.find((x) => String(x.id) === String(cat))?.name,
                );
                if (n) {
                  await api("/categories/" + cat, {
                    method: "PUT",
                    body: JSON.stringify({ name: n }),
                  });
                  loadCats();
                }
              }}
            >
              <Edit /> Category
            </button>
            <button
              onClick={async () => {
                if (confirm("Remove category and its items?")) {
                  await api("/categories/" + cat, { method: "DELETE" });
                  setCat("");
                  loadCats();
                }
              }}
            >
              <Trash2 /> Category
            </button>
          </>
        )}
      </div>
      {cat && (
        <>
          <form
            className="card inline"
            onSubmit={async (e) => {
              e.preventDefault();
              await api("/items", {
                method: "POST",
                body: JSON.stringify({ categoryId: cat, name }),
              });
              setName("");
              load();
            }}
          >
            <input
              required
              placeholder="Item name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="primary">
              <Plus /> Add item
            </button>
          </form>
          <div className="list">
            {items.rows.map((i) => (
              <div className="row" key={i.id}>
                <strong>{i.name}</strong>
                <span>
                  <button
                    onClick={async () => {
                      const n = prompt("Item name", i.name);
                      if (n) {
                        await api("/items/" + i.id, {
                          method: "PUT",
                          body: JSON.stringify({ categoryId: cat, name: n }),
                        });
                        load();
                      }
                    }}
                  >
                    <Edit />
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm("Remove item?")) {
                        await api("/items/" + i.id, { method: "DELETE" });
                        load();
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
            page={items.page}
            total={items.total}
            pageSize={items.pageSize}
            setPage={(p) => setItems({ ...items, page: p })}
            setPageSize={(s) => setItems({ ...items, pageSize: s, page: 1 })}
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
    }),
    [name, setName] = useState("");
  const load = () =>
    api(`/units?page=${data.page}&pageSize=${data.pageSize}&search=`).then(
      setData,
    );
  useEffect(load, [data.page, data.pageSize]);
  return (
    <section>
      <h2>Units</h2>
      <form
        className="card inline"
        onSubmit={async (e) => {
          e.preventDefault();
          await api("/units", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
          setName("");
          load();
        }}
      >
        <input
          required
          placeholder="Unit"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary">
          <Plus /> Add unit
        </button>
      </form>
      <div className="list">
        {data.rows.map((u) => (
          <div className="row" key={u.id}>
            <strong>{u.name}</strong>
            <span>
              <button
                onClick={async () => {
                  const n = prompt("Unit", u.name);
                  if (n) {
                    await api("/units/" + u.id, {
                      method: "PUT",
                      body: JSON.stringify({ name: n }),
                    });
                    load();
                  }
                }}
              >
                <Edit />
              </button>
              <button
                onClick={async () => {
                  if (confirm("Remove unit?")) {
                    await api("/units/" + u.id, { method: "DELETE" });
                    load();
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
        setPage={(p) => setData({ ...data, page: p })}
        setPageSize={(s) => setData({ ...data, pageSize: s, page: 1 })}
        search=""
        setSearch={() => {}}
      />
    </section>
  );
}
