import React, { useEffect, useState } from "react";
import { Edit3, MapPin, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import ConfirmDialog from "../components/ConfirmDialog";
import { usePagination } from "../hooks/usePagination";

const emptyForm = {
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

export default function Survivors() {
  const pagination = usePagination("survivors", "full_name");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [pincodeMessage, setPincodeMessage] = useState("");
  const [deleteId, setDeleteId] = useState(null);

  const load = async () => {
    const result = await api(
      `/survivors?page=${page}&pageSize=${pagination.pageSize}&search=${encodeURIComponent(pagination.search)}&sortColumn=${encodeURIComponent(pagination.sortColumn || "full_name")}&sortDirection=${pagination.sortDirection}`,
      { loadingMessage: "Loading survivors…" },
    );
    setRows(result.rows);
    setTotal(result.total);
  };

  useEffect(() => {
    if (pagination.ready) load().catch(() => {});
  }, [
    page,
    pagination.pageSize,
    pagination.search,
    pagination.sortColumn,
    pagination.sortDirection,
    pagination.ready,
  ]);

  useEffect(() => {
    const pin = form.pincode.replace(/\D/g, "");
    if (pin.length !== 6) {
      setPincodeMessage("");
      return undefined;
    }
    let active = true;
    const timer = setTimeout(() => {
      setPincodeMessage("Looking up district and state…");
      api(`/pincode/${pin}`, { loadingMessage: "Finding district and state…" })
        .then((result) => {
          if (!active) return;
          setForm((current) => ({
            ...current,
            district: result.district || "",
            state: result.state || "",
            villageCity: current.villageCity || result.city || "",
          }));
          setPincodeMessage(
            `Updated from pincode: ${result.district || "District"}, ${result.state || "State"}`,
          );
        })
        .catch((error) => active && setPincodeMessage(error.message));
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [form.pincode]);

  const save = async (event) => {
    event.preventDefault();
    await api(editingId ? `/survivors/${editingId}` : "/survivors", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(form),
      loadingMessage: editingId ? "Updating survivor…" : "Adding survivor…",
    });
    setForm(emptyForm);
    setEditingId(null);
    setPage(1);
    await load();
  };

  const edit = (row) => {
    setEditingId(row.id);
    setForm({
      fullName: row.full_name || "",
      fatherName: row.father_name || "",
      motherName: row.mother_name || "",
      nickname: row.nickname || "",
      houseNo: row.house_no || "",
      street: row.street || "",
      area: row.area || "",
      villageCity: row.village_city || "",
      pincode: row.pincode || "",
      district: row.district || "",
      state: row.state || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async () => {
    await api(`/survivors/${deleteId}`, { method: "DELETE", loadingMessage: "Removing survivor…" });
    setDeleteId(null);
    await load();
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Add Survivors</h1>
          <p>Maintain survivor master data and address details.</p>
        </div>
      </div>
      <form className="card form-stack" onSubmit={save}>
        <div className="section-label">Basic information</div>
        <label>
          Full name
          <input
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </label>
        <label>
          Father's full name
          <input
            value={form.fatherName}
            onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
          />
        </label>
        <label>
          Mother's full name
          <input
            value={form.motherName}
            onChange={(e) => setForm({ ...form, motherName: e.target.value })}
          />
        </label>
        <label>
          Nickname
          <input
            value={form.nickname}
            onChange={(e) => setForm({ ...form, nickname: e.target.value })}
          />
        </label>
        <div className="section-label">Address</div>
        <label>
          House number
          <input
            value={form.houseNo}
            onChange={(e) => setForm({ ...form, houseNo: e.target.value })}
          />
        </label>
        <label>
          Street name
          <input
            value={form.street}
            onChange={(e) => setForm({ ...form, street: e.target.value })}
          />
        </label>
        <label>
          Area
          <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        </label>
        <label>
          Village / city
          <input
            value={form.villageCity}
            onChange={(e) => setForm({ ...form, villageCity: e.target.value })}
          />
        </label>
        <label>
          Pincode
          <input
            inputMode="numeric"
            maxLength={6}
            value={form.pincode}
            onChange={(e) =>
              setForm({ ...form, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })
            }
          />
          {pincodeMessage ? (
            <small className="field-note">
              <MapPin size={13} />
              {pincodeMessage}
            </small>
          ) : null}
        </label>
        <label>
          District
          <input
            value={form.district}
            onChange={(e) => setForm({ ...form, district: e.target.value })}
          />
        </label>
        <label>
          State
          <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
        </label>
        <div className="form-actions">
          <button className="primary" type="submit">
            <Plus size={18} />
            {editingId ? "Update survivor" : "Add survivor"}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm);
              setPincodeMessage("");
            }}
          >
            <RotateCcw size={17} /> Reset
          </button>
        </div>
      </form>

      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[
          { value: "full_name", label: "Full name" },
          { value: "nickname", label: "Nickname" },
          { value: "district", label: "District" },
          { value: "state", label: "State" },
        ]}
      />
      <div className="list-stack">
        {rows.map((row) => (
          <article className="list-card" key={row.id}>
            <div className="list-main">
              <strong>{row.full_name}</strong>
              <span>
                {[row.nickname, row.village_city, row.district, row.state, row.pincode]
                  .filter(Boolean)
                  .join(" • ") || "No address details"}
              </span>
            </div>
            <div className="row-actions">
              <button
                className="icon-button soft"
                title="Update survivor"
                onClick={() => edit(row)}
              >
                <Edit3 size={17} />
              </button>
              <button
                className="icon-button danger-soft"
                title="Remove survivor"
                onClick={() => setDeleteId(row.id)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}
        {!rows.length ? (
          <div className="empty-card">No survivors match the current search.</div>
        ) : null}
      </div>
      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[
          { value: "full_name", label: "Full name" },
          { value: "nickname", label: "Nickname" },
          { value: "district", label: "District" },
          { value: "state", label: "State" },
        ]}
      />
      <ConfirmDialog
        open={Boolean(deleteId)}
        message="This will permanently remove the selected survivor."
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />
    </section>
  );
}
