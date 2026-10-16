import React, { useEffect, useMemo, useState } from "react";
import { MapPin, Pencil, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { usePagination } from "../hooks/usePagination";
import "./marketing.css";

export default function MarketingLocations() {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pagination = usePagination("marketing-locations", "name");

  const load = async () => {
    setLoading(true);
    try {
      const result = await api("/marketing-locations");
      setRows(Array.isArray(result) ? result : []);
      setError("");
    } catch (e) {
      setError(e.message || "Unable to load locations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredRows = useMemo(() => {
    const term = String(pagination.search || "").trim().toLowerCase();
    const filtered = rows.filter((row) =>
      !term || `${row.name || ""} ${row.address || ""}`.toLowerCase().includes(term),
    );
    const column = pagination.sortColumn;
    if (column) {
      filtered.sort((a, b) => {
        const left = String(a[column] ?? "").toLowerCase();
        const right = String(b[column] ?? "").toLowerCase();
        const result = left.localeCompare(right, undefined, { numeric: true });
        return pagination.sortDirection === "desc" ? -result : result;
      });
    }
    return filtered;
  }, [rows, pagination.search, pagination.sortColumn, pagination.sortDirection]);

  const pageSize = Number(pagination.pageSize) || 10;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const resetForm = () => {
    setEditing(null);
    setName("");
    setAddress("");
  };

  const save = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await api(editing ? `/marketing-locations/${editing}` : "/marketing-locations", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ name: name.trim(), address: address.trim() }),
      });
      resetForm();
      setPage(1);
      await load();
    } catch (e) {
      setError(e.message || "Unable to save location");
    }
  };

  const edit = (row) => {
    setEditing(row.id);
    setName(row.name || "");
    setAddress(row.address || "");
    setError("");
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this location? Existing list items will keep their history but show no location.")) return;
    setError("");
    try {
      await api(`/marketing-locations/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e.message || "Unable to delete location");
    }
  };

  return (
    <div className="marketing-page marketing-locations-page">
      <div className="page-heading">
        <div>
          <h1>Add Location</h1>
          <p>Manage places where marketing-list items will be purchased.</p>
        </div>
      </div>

      {error ? <div className="marketing-error" role="alert">{error}</div> : null}

      <form className="card marketing-form-grid" onSubmit={save}>
        <label>
          Location name
          <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Local market" />
        </label>
        <label>
          Address / notes
          <input maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Optional address or notes" />
        </label>
        <div className="location-form-actions">
          <button className="primary" type="submit">{editing ? "Update location" : "Add location"}</button>
          {editing ? <button type="button" onClick={resetForm}>Cancel</button> : null}
        </div>
      </form>

      <section className="location-section" aria-labelledby="locations-heading">
        <div className="subheading location-list-heading">
          <div>
            <h2 id="locations-heading">Saved locations</h2>
            <p>{filteredRows.length} {filteredRows.length === 1 ? "location" : "locations"}</p>
          </div>
        </div>

        <Pagination
          page={safePage}
          setPage={setPage}
          total={filteredRows.length}
          {...pagination}
          sortOptions={[
            { value: "name", label: "Location" },
            { value: "address", label: "Address / notes" },
          ]}
        />

        {loading ? (
          <div className="location-empty-state">Loading locations…</div>
        ) : visibleRows.length ? (
          <div className="location-list">
            {visibleRows.map((row) => (
              <article className="location-card" key={row.id}>
                <div className="location-card-icon"><MapPin size={19} aria-hidden="true" /></div>
                <div className="location-card-content">
                  <h3>{row.name}</h3>
                  <p>{row.address || "No address or notes added"}</p>
                </div>
                <div className="location-card-actions">
                  <button type="button" onClick={() => edit(row)} aria-label={`Edit ${row.name}`}><Pencil size={16} /> <span>Edit</span></button>
                  <button type="button" onClick={() => remove(row.id)} aria-label={`Delete ${row.name}`}><Trash2 size={16} /> <span>Delete</span></button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="location-empty-state">
            {pagination.search ? "No locations match your search." : "No locations added yet. Add your first location above."}
          </div>
        )}
      </section>
    </div>
  );
}
