import { api } from "./api.js";

const LOCAL_GPS_CACHE_KEY = "de_last_gps_coords_v1";
const LOCAL_LOCATION_STATS_KEY = "de_location_usage_stats_v1";
const NEARBY_RADIUS_KM = 1.5;

function toFiniteCoord(val) {
  if (val === undefined || val === null || val === "") return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

export function isValidCoordinates(coords) {
  if (!coords) return false;
  const lat = toFiniteCoord(coords.latitude ?? coords.lat);
  const lng = toFiniteCoord(coords.longitude ?? coords.lng);
  if (lat === null || lng === null) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function getCachedGpsPosition(maxAgeMs = 15 * 60 * 1000) {
  try {
    const raw = localStorage.getItem(LOCAL_GPS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidCoordinates(parsed)) return null;
    if (maxAgeMs && parsed.timestamp && Date.now() - parsed.timestamp > maxAgeMs) {
      return null;
    }
    return {
      latitude: Number(parsed.latitude),
      longitude: Number(parsed.longitude),
      accuracy: parsed.accuracy ? Number(parsed.accuracy) : null,
      timestamp: parsed.timestamp || Date.now(),
      fromCache: true,
    };
  } catch {
    return null;
  }
}

function saveCachedGpsPosition(coords) {
  try {
    if (!isValidCoordinates(coords)) return;
    localStorage.setItem(
      LOCAL_GPS_CACHE_KEY,
      JSON.stringify({
        latitude: Number(coords.latitude),
        longitude: Number(coords.longitude),
        accuracy: coords.accuracy ? Number(coords.accuracy) : null,
        timestamp: Date.now(),
      })
    );
  } catch {
    // ignore storage errors
  }
}

export function getCurrentGpsPosition(options = {}) {
  const {
    timeout = 6000,
    maximumAge = 60000,
    enableHighAccuracy = true,
    allowCacheFallback = true,
  } = options;

  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(allowCacheFallback ? getCachedGpsPosition(24 * 60 * 60 * 1000) : null);
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(allowCacheFallback ? getCachedGpsPosition(24 * 60 * 60 * 1000) : null);
    }, timeout + 500);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        const coords = {
          latitude: Number(pos.coords.latitude),
          longitude: Number(pos.coords.longitude),
          accuracy: Number(pos.coords.accuracy || 0),
          timestamp: pos.timestamp || Date.now(),
          fromCache: false,
        };
        saveCachedGpsPosition(coords);
        finish(coords);
      },
      () => {
        clearTimeout(timer);
        finish(allowCacheFallback ? getCachedGpsPosition(24 * 60 * 60 * 1000) : null);
      },
      {
        enableHighAccuracy,
        timeout,
        maximumAge,
      }
    );
  });
}

function loadLocalLocationStats() {
  try {
    const raw = localStorage.getItem(LOCAL_LOCATION_STATS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalLocationStats(stats) {
  try {
    localStorage.setItem(LOCAL_LOCATION_STATS_KEY, JSON.stringify(stats));
  } catch {
    // ignore storage errors
  }
}

export function updateLocalLocationStats(locationId, coords = null) {
  if (!locationId) return;
  const key = String(locationId);
  const stats = loadLocalLocationStats();
  const existing = stats[key] || {
    count: 0,
    lastSelectedAt: 0,
    points: [],
  };

  existing.count = Number(existing.count || 0) + 1;
  existing.lastSelectedAt = Date.now();

  if (isValidCoordinates(coords)) {
    const lat = Number(coords.latitude ?? coords.lat);
    const lng = Number(coords.longitude ?? coords.lng);
    const points = Array.isArray(existing.points) ? existing.points : [];
    points.unshift({ lat, lng, ts: Date.now() });
    existing.points = points.slice(0, 25);

    const sum = existing.points.reduce(
      (acc, pt) => ({ lat: acc.lat + pt.lat, lng: acc.lng + pt.lng }),
      { lat: 0, lng: 0 }
    );
    existing.centroidLat = sum.lat / existing.points.length;
    existing.centroidLng = sum.lng / existing.points.length;
  }

  stats[key] = existing;
  saveLocalLocationStats(stats);
}

export function enrichLocationsWithClientStats(locations = [], coords = null) {
  const localStats = loadLocalLocationStats();
  const hasCallerGps = isValidCoordinates(coords);
  const callerLat = hasCallerGps ? Number(coords.latitude ?? coords.lat) : null;
  const callerLng = hasCallerGps ? Number(coords.longitude ?? coords.lng) : null;

  const enriched = (Array.isArray(locations) ? locations : []).map((loc) => {
    const key = String(loc.id);
    const local = localStats[key] || { count: 0, points: [] };

    const serverLat = toFiniteCoord(loc.latitude);
    const serverLng = toFiniteCoord(loc.longitude);
    const effectiveLat =
      serverLat !== null ? serverLat : toFiniteCoord(local.centroidLat);
    const effectiveLng =
      serverLng !== null ? serverLng : toFiniteCoord(local.centroidLng);

    let distanceKm = toFiniteCoord(loc.distance_km);
    if (
      distanceKm === null &&
      hasCallerGps &&
      effectiveLat !== null &&
      effectiveLng !== null
    ) {
      distanceKm =
        Math.round(
          haversineDistanceKm(callerLat, callerLng, effectiveLat, effectiveLng) *
            1000
        ) / 1000;
    }

    let localNearbyCount = 0;
    if (hasCallerGps && Array.isArray(local.points)) {
      localNearbyCount = local.points.filter(
        (pt) =>
          isValidCoordinates({ latitude: pt.lat, longitude: pt.lng }) &&
          haversineDistanceKm(callerLat, callerLng, pt.lat, pt.lng) <=
            NEARBY_RADIUS_KM
      ).length;
    }

    const serverUsage = Number(loc.usage_count || 0);
    const localUsage = Number(local.count || 0);
    const usageCount = Math.max(serverUsage, localUsage);
    const nearbyUsageCount = Math.max(
      Number(loc.nearby_usage_count || 0),
      localNearbyCount
    );

    return {
      ...loc,
      latitude: effectiveLat,
      longitude: effectiveLng,
      usage_count: usageCount,
      nearby_usage_count: nearbyUsageCount,
      distance_km: distanceKm,
      last_selected_at: local.lastSelectedAt || 0,
    };
  });

  let nearestId = null;
  let minDistance = Infinity;
  let mostFrequentId = null;
  let maxUsage = 0;

  for (const loc of enriched) {
    if (loc.distance_km !== null && loc.distance_km < minDistance) {
      minDistance = loc.distance_km;
      nearestId = loc.id;
    }
    if (loc.usage_count > maxUsage) {
      maxUsage = loc.usage_count;
      mostFrequentId = loc.id;
    }
  }

  return enriched.map((loc) => ({
    ...loc,
    is_nearest: Boolean(loc.is_nearest) || (nearestId !== null && loc.id === nearestId),
    is_most_frequent:
      Boolean(loc.is_most_frequent) ||
      (mostFrequentId !== null && maxUsage > 0 && loc.id === mostFrequentId),
  }));
}

/**
 * Picks the best automatic location based on:
 * 1. Most frequently selected location within 1.5km of current GPS coordinates.
 * 2. Nearest GPS-mapped location within 5km (breaking ties by selection frequency).
 * 3. Overall most frequently selected location.
 * 4. First location in list.
 */
export function pickBestLocation(locations = [], coords = null) {
  const enriched = enrichLocationsWithClientStats(locations, coords);
  if (!enriched.length) return { bestLocation: null, locations: [] };

  const scored = enriched.map((loc) => {
    const dist = toFiniteCoord(loc.distance_km);
    const nearbyUses = Number(loc.nearby_usage_count || 0);
    const totalUses = Number(loc.usage_count || 0);
    let score = 0;

    if (nearbyUses > 0) {
      score += 2000 + nearbyUses * 60;
    }
    if (dist !== null) {
      if (dist <= NEARBY_RADIUS_KM) {
        score += 1200 + Math.max(0, (NEARBY_RADIUS_KM - dist) * 400);
      } else if (dist <= 5) {
        score += 600 + Math.max(0, (5 - dist) * 80);
      } else {
        score += Math.max(0, 200 - dist * 5);
      }
    }
    score += totalUses * 25;
    if (loc.auto_recommended) {
      score += 150;
    }

    let matchReason = "default";
    if (nearbyUses > 0 && dist !== null && dist <= NEARBY_RADIUS_KM) {
      matchReason = "nearest_frequent";
    } else if (dist !== null && loc.is_nearest) {
      matchReason = "nearest_gps";
    } else if (totalUses > 0 && loc.is_most_frequent) {
      matchReason = "most_frequent";
    } else if (nearbyUses > 0) {
      matchReason = "frequent_here";
    }

    return {
      ...loc,
      auto_score: Math.round(score * 100) / 100,
      match_reason: matchReason,
    };
  });

  const sortedByScore = [...scored].sort((a, b) => {
    if (b.auto_score !== a.auto_score) return b.auto_score - a.auto_score;
    if (a.distance_km !== null && b.distance_km !== null && a.distance_km !== b.distance_km) {
      return a.distance_km - b.distance_km;
    }
    if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const bestLocation = sortedByScore[0] || scored[0];
  const annotated = scored.map((loc) => ({
    ...loc,
    auto_recommended: Boolean(bestLocation && loc.id === bestLocation.id),
  }));

  return {
    bestLocation: annotated.find((l) => l.id === bestLocation.id) || annotated[0],
    locations: annotated,
  };
}

export async function fetchLocationsWithGps(options = {}) {
  const { coords: providedCoords = null, silent = true, fastInitial = false } = options;
  const coords = isValidCoordinates(providedCoords)
    ? providedCoords
    : fastInitial
    ? getCachedGpsPosition(24 * 60 * 60 * 1000)
    : await getCurrentGpsPosition();

  let query = "";
  if (isValidCoordinates(coords)) {
    const lat = encodeURIComponent(Number(coords.latitude ?? coords.lat));
    const lng = encodeURIComponent(Number(coords.longitude ?? coords.lng));
    query = `?lat=${lat}&lng=${lng}`;
  }

  const rawResult = await api(`/marketing-locations${query}`, { silent });
  const rawLocations = Array.isArray(rawResult) ? rawResult : [];
  const { bestLocation, locations } = pickBestLocation(rawLocations, coords);

  return {
    locations,
    bestLocation,
    coords,
  };
}

export async function recordLocationSelection(
  locationId,
  { coords = null, source = "manual_select", pinLocationCoordinates = false } = {}
) {
  if (!locationId) return;
  const resolvedCoords = isValidCoordinates(coords)
    ? coords
    : await getCurrentGpsPosition({ timeout: 3500 });

  updateLocalLocationStats(locationId, resolvedCoords);

  try {
    await api("/marketing-locations/track-selection", {
      method: "POST",
      body: JSON.stringify({
        locationId: Number(locationId),
        latitude: resolvedCoords ? resolvedCoords.latitude : null,
        longitude: resolvedCoords ? resolvedCoords.longitude : null,
        accuracyMeters: resolvedCoords ? resolvedCoords.accuracy : null,
        source,
        pinLocationCoordinates: Boolean(pinLocationCoordinates),
      }),
      silent: true,
      silentToast: true,
    });
  } catch {
    // Non-blocking telemetry
  }
}

export function formatDistanceLabel(distanceKm) {
  const dist = toFiniteCoord(distanceKm);
  if (dist === null) return "";
  if (dist < 1) {
    return `${Math.max(10, Math.round(dist * 1000))} m`;
  }
  return `${dist.toFixed(1)} km`;
}

export function formatLocationOptionLabel(loc) {
  if (!loc) return "";
  const badges = [];
  const distLabel = formatDistanceLabel(loc.distance_km);
  if (distLabel) {
    badges.push(`📍 ${distLabel}`);
  } else if (loc.is_nearest) {
    badges.push("📍 Nearest");
  }
  const uses = Number(loc.usage_count || 0);
  if (uses > 0) {
    badges.push(`★ ${uses}x`);
  }
  if (!badges.length) return loc.name;
  return `${loc.name} (${badges.join(" · ")})`;
}

export function describeAutoMatchReason(loc) {
  if (!loc) return "";
  const distLabel = formatDistanceLabel(loc.distance_km);
  const uses = Number(loc.usage_count || 0);
  if (loc.match_reason === "nearest_frequent") {
    return `Auto-selected from current GPS (${distLabel || "nearby"}, selected ${uses}x)`;
  }
  if (loc.match_reason === "nearest_gps") {
    return `Auto-selected nearest GPS location (${distLabel || "closest"})`;
  }
  if (loc.match_reason === "most_frequent") {
    return `Auto-selected most frequent location (${uses}x selections)`;
  }
  if (loc.match_reason === "frequent_here") {
    return "Auto-selected from GPS selection history";
  }
  return "Auto-selected default location";
}
