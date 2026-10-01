import React, { useEffect, useState } from "react";
import { Edit3, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import PasswordField from "../components/PasswordField";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import { usePagination } from "../hooks/usePagination";

const emptyForm = {
  fullName: "",
  email: "",
  role: "editor",
  password: "",
  confirmPassword: "",
  isDisabled: false,
};

export default function Users() {
  const pagination = usePagination("users", "full_name");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const load = async () => {
    if (!pagination.ready) return;
    const data = await api(
      `/users?page=${page}&pageSize=${pagination.pageSize}&search=${encodeURIComponent(pagination.search)}&sortColumn=${encodeURIComponent(pagination.sortColumn || "full_name")}&sortDirection=${pagination.sortDirection}`,
      { loadingMessage: "Loading users…" },
    );
    setRows(data.rows);
    setTotal(data.total);
  };
  useEffect(() => {
    api("/roles", { loadingMessage: "Loading roles…" })
      .then(setRoles)
      .catch(() => {});
  }, []);
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
    const body = { ...form };
    if (editingId && !body.password) {
      delete body.password;
      delete body.confirmPassword;
    }
    await api(editingId ? `/users/${editingId}` : "/users", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(body),
      loadingMessage: editingId ? "Updating user…" : "Adding user…",
    });
    setForm(emptyForm);
    setEditingId(null);
    await load();
  };
  const remove = async () => {
    await api(`/users/${deleteId}`, {
      method: "DELETE",
      loadingMessage: "Removing user…",
    });
    setDeleteId(null);
    await load();
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Add Users</h1>
          <p>Each user has one role. Permissions come from that role.</p>
        </div>
      </div>
      <form className="card form-stack" onSubmit={submit}>
        <div className="section-label">{editingId ? "Update user" : "Add user"}</div>
        <label>
          Full name
          <input
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </label>
        <label>
          Email / login ID
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          Role
          <select
            required
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.name}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <PasswordField
          value={form.password}
          onChange={(value) => setForm({ ...form, password: value })}
          confirmValue={form.confirmPassword}
          onConfirmChange={(value) => setForm({ ...form, confirmPassword: value })}
          confirm={true}
          required={!editingId}
          confirmRequired={Boolean(form.password) || !editingId}
          label={editingId ? "New password (optional)" : "Password"}
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.isDisabled}
            onChange={(e) => setForm({ ...form, isDisabled: e.target.checked })}
          />{" "}
          Disable account
        </label>
        <div className="form-actions">
          <button className="primary" type="submit">
            <Plus size={18} />
            {editingId ? "Update user" : "Add user"}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm);
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
          { value: "full_name", label: "Name" },
          { value: "email", label: "Email" },
          { value: "role", label: "Role" },
          { value: "created_at", label: "Created" },
        ]}
      />
      <div className="list-stack">
        {rows.map((row) => (
          <article className="list-card" key={row.id}>
            <div className="list-main">
              <strong>{row.full_name}</strong>
              <span>
                {row.email} · {row.role} {row.is_disabled ? "· Disabled" : ""}
              </span>
            </div>
            <div className="row-actions">
              <button
                className="icon-button soft"
                title="Update user"
                onClick={() => {
                  setEditingId(row.id);
                  setForm({
                    fullName: row.full_name,
                    email: row.email,
                    role: row.role,
                    password: "",
                    confirmPassword: "",
                    isDisabled: row.is_disabled,
                  });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <Edit3 size={17} />
              </button>
              <button
                className="icon-button danger-soft"
                title="Remove user"
                onClick={() => setDeleteId(row.id)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}
        {!rows.length ? <div className="empty-card">No users match the search.</div> : null}
      </div>
      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[
          { value: "full_name", label: "Name" },
          { value: "email", label: "Email" },
          { value: "role", label: "Role" },
          { value: "created_at", label: "Created" },
        ]}
      />
      <ConfirmDialog
        open={Boolean(deleteId)}
        message="This will permanently remove the selected user."
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />
    </section>
  );
}
