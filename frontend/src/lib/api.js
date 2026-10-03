const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

export function showToast(type, message) {
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { type, message } }));
}

function isRetryableRequest(path, options) {
  const method = String(options.method || "GET").toUpperCase();
  if (options.retryTransient === false) return false;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

  // Login is read-like from the application's state perspective and can safely
  // be retried when Render is waking from a Free-tier cold start.
  return method === "POST" && path === "/auth/login";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTransientRetry(url, fetchOptions, path, options) {
  const retries = isRetryableRequest(path, options)
    ? Number(options.transientRetries ?? DEFAULT_RETRY_DELAYS_MS.length)
    : 0;

  let lastResponse = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, fetchOptions);
      lastResponse = response;

      if (!TRANSIENT_STATUS_CODES.has(response.status) || attempt >= retries) {
        return response;
      }

      await sleep(DEFAULT_RETRY_DELAYS_MS[Math.min(attempt, DEFAULT_RETRY_DELAYS_MS.length - 1)]);
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(DEFAULT_RETRY_DELAYS_MS[Math.min(attempt, DEFAULT_RETRY_DELAYS_MS.length - 1)]);
    }
  }

  return lastResponse;
}

export async function api(path, options = {}) {
  const token = localStorage.getItem("token");
  const isFormData = options.body instanceof FormData;
  const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    "X-App-Timezone": clientTimezone,
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  window.dispatchEvent(
    new CustomEvent("app:api:start", {
      detail: { message: options.loadingMessage || "Please wait…" },
    }),
  );

  try {
    const { retryTransient, transientRetries, ...requestOptions } = options;
    const response = await fetchWithTransientRetry(
      `${baseUrl}${path}`,
      { ...requestOptions, headers },
      path,
      { retryTransient, transientRetries },
    );
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new CustomEvent("app:auth-expired"));
      throw new Error(data?.error || `Request failed (${response.status})`);
    }

    if (options.toast)
      showToast(options.toast.type || "information", options.toast.message || "Done.");
    else if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(
        String(options.method || "GET").toUpperCase(),
      ) &&
      !options.silentToast
    )
      showToast("success", "Operation completed successfully.");

    return data;
  } catch (error) {
    const message =
      error instanceof TypeError && error.message.includes("fetch")
        ? `Unable to reach the backend API at ${baseUrl}. Verify the backend and API proxy configuration.`
        : error.message;
    if (!options.silent) showToast("error", message);
    throw new Error(message);
  } finally {
    window.dispatchEvent(new CustomEvent("app:api:end"));
  }
}

export function assetUrl(path) {
  return `${baseUrl}${path}`;
}
