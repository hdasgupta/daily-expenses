import React, { useEffect, useMemo, useState } from "react";
import { Compass, LocateFixed, MapPin, Pencil, Star, Trash2 } from "lucide-react";
import { api, showToast } from "../lib/api";
import {
  fetchLocationsWithGps,
  formatDistanceLabel,
  getCurrentGpsPosition,
  isValidCoordinates,
  recordLocationSelection,
} from "../lib/locationTracker";
import Pagination from "../components/Pagination";
import { usePagination } from "../hooks/usePagination";
import "./marketing.css";

export default function MarketingLocations() {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [currentCoords, setCurrentCoords] = useState(null);
  const [detectingGps, setDetectingGps] = useState(false);
  const [pinningId, setPinningId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pagination = usePagination("marketing-locations", "name");

  const load = async (overrideCoords = null) => {
    setLoading(true);
    try {
      const { locations, coords } = await fetchLocationsWithGps({
        coords: overrideCoords || currentCoords,
        silent: true,
      });
      if (isValidCoordinates(coords)) {
        setCurrentCoords(coords);
      }
      setRows(Array.isArray(locations) ? locations : []);
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

  const captureCurrentGpsForForm = async () => {
    setDetectingGps(true);
    try {
      const coords = await getCurrentGpsPosition({
        timeout: 8000,
        maximumAge: 0,
        enableHighAccuracy: true,
        allowCacheFallback: false,
      });
      if (!isValidCoordinates(coords)) {
        showToast("warning", "Unable to read current GPS coordinates. Check browser/app location permissions.");
        return;
      }
      setCurrentCoords(coords);
      setLatitude(Number(coords.latitude).toFixed(6));
      setLongitude(Number(coords.longitude).toFixed(6));
      showToast("success", "Current GPS coordinates captured.");
      await load(coords);
    } finally {
      setDetectingGps(false);
    }
  };

  const pinRowToCurrentGps = async (row) => {
    setPinningId(row.id);
    try {
      const coords = await getCurrentGpsPosition({
        timeout: 8000,
        maximumAge: 0,
        enableHighAccuracy: true,
      });
      if (!isValidCoordinates(coords)) {
        showToast("warning", "Unable to read current GPS coordinates. Check location permissions.");
        return;
      }
      setCurrentCoords(coords);
      await recordLocationSelection(row.id, {
        coords,
        source: "manual_gps_pin",
        pinLocationCoordinates: true,
      });
      showToast("success", `Pinned current GPS coordinates to ${row.name}.`);
      await load(coords);
    } catch (e) {
      setError(e.message || "Unable to pin GPS coordinates");
    } finally {
      setPinningId(null);
    }
  };

  const filteredRows = useMemo(() => {
    const term = String(pagination.search || "").trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        !term ||
        `${row.name || ""} ${row.address || ""}`.toLowerCase().includes(term)
    );
    const column = pagination.sortColumn;
    if (column) {
      filtered.sort((a, b) => {
        if (column === "distance_km") {
          const leftDist = a.distance_km === null || a.distance_km === undefined ? Infinity : Number(a.distance_km);
          const rightDist = b.distance_km === null || b.distance_km === undefined ? Infinity : Number(b.distance_km);
          const result = leftDist - rightDist;
          return pagination.sortDirection === "desc" ? -result : result;
        }
        if (column === "usage_count") {
          const result = Number(a.usage_count || 0) - Number(b.usage_count || 0);
          return pagination.sortDirection === "desc" ? -result : result;
        }
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
    setLatitude("");
    setLongitude("");
  };

  const save = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const hasCoords = latitude !== "" && longitude !== "";
      const payload = {
        name: name.trim(),
        address: address.trim(),
        latitude: hasCoords ? Number(latitude) : null,
        longitude: hasCoords ? Number(longitude) : null,
        clearCoordinates: Boolean(editing && !hasCoords),
      };
      await api(editing ? `/marketing-locations/${editing}` : "/marketing-locations", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(payload),
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
    setLatitude(row.latitude !== null && row.latitude !== undefined ? String(Number(row.latitude).toFixed(6)) : "");
    setLongitude(row.longitude !== null && row.longitude !== undefined ? String(Number(row.longitude).toFixed(6)) : "");
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
          <p>Manage places where marketing-list items are purchased and map GPS coordinates for automatic nearest and most-frequent selection.</p>
        </div>
      </div>

      {error ? <div className="marketing-error" role="alert">{error}</div> : null}

      <form className="card marketing-form-grid" onSubmit={save}>
        <label>
          Location name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Local market"
          />
        </label>
        <label>
          Address / notes
          <input
            maxLength={500}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Optional address or notes"
          />
        </label>
        <label>
          Latitude (optional GPS)
          <input
            type="number"
            step="any"
            min="-90"
            max="90"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
            placeholder="e.g. 22.572645"
          />
        </label>
        <label>
          Longitude (optional GPS)
          <input
            type="number"
            step="any"
            min="-180"
            max="180"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
            placeholder="e.g. 88.363892"
          />
        </label>
        <div className="location-form-actions" style={{ gridColumn: "1 / -1" }}>
          <button className="primary" type="submit">
            {editing ? "Update location" : "Add location"}
          </button>
          <button
            type="button"
            onClick={captureCurrentGpsForForm}
            disabled={detectingGps}
            title="Fill latitude and longitude from your current GPS position"
          >
            <LocateFixed size={15} />{" "}
            <span>{detectingGps ? "Detecting GPS…" : "Use current GPS"}</span>
          </button>
          {(latitude !== "" || longitude !== "") && (
            <button
              type="button"
              onClick={() => {
                setLatitude("");
                setLongitude("");
              }}
            >
              Clear GPS
            </button>
          )}
          {editing ? (
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <section className="location-section" aria-labelledby="locations-heading">
        <div className="subheading location-list-heading">
          <div>
            <h2 id="locations-heading">Saved locations</h2>
            <p>
              {filteredRows.length} {filteredRows.length === 1 ? "location" : "locations"}
              {isValidCoordinates(currentCoords)
                ? ` · Current GPS active (${Number(currentCoords.latitude).toFixed(4)}, ${Number(currentCoords.longitude).toFixed(4)})`
                : ""}
            </p>
          </div>
        </div>

        <Pagination
          page={safePage}
          setPage={setPage}
          total={filteredRows.length}
          {...pagination}
          sortOptions={[
            { value: "name", label: "Location" },
            { value: "distance_km", label: "Nearest GPS distance" },
            { value: "usage_count", label: "Most frequently used" },
            { value: "address", label: "Address / notes" },
          ]}
        />

        {loading ? (
          <div className="location-empty-state">Loading locations…</div>
        ) : visibleRows.length ? (
          <div className="location-list">
            {visibleRows.map((row) => {
              const distLabel = formatDistanceLabel(row.distance_km);
              const uses = Number(row.usage_count || 0);
              const hasRowGps =
                row.latitude !== null &&
                row.latitude !== undefined &&
                row.longitude !== null &&
                row.longitude !== undefined;

              return (
                <article
                  className={`location-card${row.auto_recommended ? " is-recommended-location" : ""}`}
                  key={row.id}
                >
                  <div className="location-card-icon">
                    <MapPin size={19} aria-hidden="true" />
                  </div>
                  <div className="location-card-content">
                    <div className="location-card-title-row">
                      <h3>{row.name}</h3>
                      <div className="location-badges">
                        {row.auto_recommended && (
                          <span className="location-badge badge-recommended">
                            <Compass size={12} /> Auto-mapped
                          </span>
                        )}
                        {row.is_nearest && distLabel && (
                          <span className="location-badge badge-nearest">
                            📍 Nearest ({distLabel})
                          </span>
                        )}
                        {!row.is_nearest && distLabel && (
                          <span className="location-badge badge-distance">
                            📍 {distLabel} away
                          </span>
                        )}
                        {uses > 0 && (
                          <span
                            className={`location-badge ${
                              row.is_most_frequent ? "badge-frequent" : "badge-usage"
                            }`}
                          >
                            <Star size={11} /> {row.is_most_frequent ? `Most frequent (${uses}x)` : `${uses}x used`}
                          </span>
                        )}
                      </div>
                    </div>
                    <p>{row.address || "No address or notes added"}</p>
                    {hasRowGps ? (
                      <p className="location-gps-coords">
                        GPS: {Number(row.latitude).toFixed(5)}, {Number(row.longitude).toFixed(5)}
                      </p>
                    ) : (
                      <p className="location-gps-coords muted">
                        GPS coordinates will be learned automatically when selected or can be pinned now.
                      </p>
                    )}
                  </div>
                  <div className="location-card-actions">
                    <button
                      type="button"
                      onClick={() => pinRowToCurrentGps(row)}
                      disabled={pinningId === row.id}
                      aria-label={`Pin current GPS to ${row.name}`}
                      title="Map this location to your current GPS position"
                    >
                      <LocateFixed size={16} />{" "}
                      <span>{pinningId === row.id ? "Pinning…" : "Pin GPS"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => edit(row)}
                      aria-label={`Edit ${row.name}`}
                    >
                      <Pencil size={16} /> <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(row.id)}
                      aria-label={`Delete ${row.name}`}
                    >
                      <Trash2 size={16} /> <span>Delete</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="location-empty-state">
            {pagination.search
              ? "No locations match your search."
              : "No locations added yet. Add your first location above."}
          </div>
        )}
      </section>
    </div>
  );
}
