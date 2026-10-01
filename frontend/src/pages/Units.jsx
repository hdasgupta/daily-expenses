import React, { useEffect, useState } from "react";
import { Edit3, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import { usePagination } from "../hooks/usePagination";

export default function Units() {
  const pagination = usePagination("units", "name");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState(null);
  const [name, setName] = useState("");
  const [deleteId, setDeleteId] = useState(null);

  const load = async () => {
    if (!pagination.ready) return;
    const result = await api(
      `/units?page=${page}&pageSize=${pagination.pageSize}&search=${encodeURIComponent(pagination.search)}&sortColumn=${encodeURIComponent(pagination.sortColumn || "name")}&sortDirection=${pagination.sortDirection}`,
      { loadingMessage: "Loading units…" },
    );
    setRows(result.rows);
    setTotal(result.total);
  };
  useEffect(() => {
    load().catch(() => {});
  }, [
    page,
    pagination.pageSize,
    pagination.search,
    pagination.sortColumn,
    pagination.sortDirection,
    pagination.ready,
  ]);

  const submit = async (event) => {
    event.preventDefault();
    if (modal?.mode === "edit")
      await api(`/units/${modal.id}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
        loadingMessage: "Updating unit…",
      });
    else
      await api("/units", {
        method: "POST",
        body: JSON.stringify({ name }),
        loadingMessage: "Adding unit…",
      });
    setModal(null);
    setName("");
    await load();
  };
  const remove = async () => {
    await api(`/units/${deleteId}`, { method: "DELETE", loadingMessage: "Removing unit…" });
    setDeleteId(null);
    await load();
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Add Units</h1>
          <p>Units are used for optional expense quantities.</p>
        </div>
      </div>
      <button
        className="primary add-row-button"
        onClick={() => {
          setName("");
          setModal({ mode: "add" });
        }}
      >
        <Plus size={18} /> Add unit
      </button>
      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[
          { value: "name", label: "Name" },
          { value: "created_at", label: "Created" },
        ]}
      />
      <div className="list-stack">
        {rows.map((row) => (
          <article className="list-card" key={row.id}>
            <div className="list-main">
              <strong>{row.name}</strong>
              <span>Unit</span>
            </div>
            <div className="row-actions">
              <button
                className="icon-button soft"
                title="Update unit"
                onClick={() => {
                  setName(row.name);
                  setModal({ mode: "edit", id: row.id });
                }}
              >
                <Edit3 size={17} />
              </button>
              <button
                className="icon-button danger-soft"
                title="Remove unit"
                onClick={() => setDeleteId(row.id)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}
        {!rows.length ? <div className="empty-card">No units match the search.</div> : null}
      </div>
      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[
          { value: "name", label: "Name" },
          { value: "created_at", label: "Created" },
        ]}
      />
      <button
        className="primary add-row-button"
        onClick={() => {
          setName("");
          setModal({ mode: "add" });
        }}
      >
        <Plus size={18} /> Add unit
      </button>
      <Modal
        open={Boolean(modal)}
        title={modal?.mode === "edit" ? "Update unit" : "Add unit"}
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button className="secondary" type="reset" form="unit-form" onClick={() => setName("")}>
              <RotateCcw size={15} /> Reset
            </button>
            <button className="primary" form="unit-form">
              {modal?.mode === "edit" ? "Update" : "Add"}
            </button>
          </>
        }
      >
        <form id="unit-form" className="form-stack" onSubmit={submit}>
          <label>
            Unit name
            <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteId)}
        message="This will permanently remove the selected unit. If an existing expense uses it, the database will block the removal."
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />
    </section>
  );
}
