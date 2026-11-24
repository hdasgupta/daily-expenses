import { reportClientError } from "./clientErrorReporter";
const BACKEND_API_BASE_URL = "https://daily-expenses-8pbr.vercel.app/api";

function isCapacitorNative() {
  if (typeof window === "undefined") {
    return false;
  }

  const capacitor = window.Capacitor;

  /*
   * Standard Capacitor detection.
   */
  if (capacitor) {
    try {
      if (typeof capacitor.isNativePlatform === "function" && capacitor.isNativePlatform()) {
        return true;
      }

      if (typeof capacitor.getPlatform === "function" && capacitor.getPlatform() !== "web") {
        return true;
      }

      /*
       * Older Capacitor builds expose isNativePlatform
       * as a boolean rather than a function.
       */
      if (capacitor.isNativePlatform === true) {
        return true;
      }
    } catch {
      // Continue with fallback detection.
    }
  }

  /*
   * Capacitor Android WebView fallback.
   *
   * The Android application is packaged with Capacitor,
   * so an Android WebView should use the Render backend
   * rather than the Vite/SPA /api path.
   */
  const userAgent = String(window.navigator?.userAgent || "").toLowerCase();

  if (
    userAgent.includes("android") &&
    (userAgent.includes("wv") || userAgent.includes("capacitor"))
  ) {
    return true;
  }

  /*
   * Native Capacitor protocols.
   */
  const protocol = String(window.location.protocol || "").toLowerCase();

  if (protocol === "capacitor:" || protocol === "ionic:") {
    return true;
  }

  return false;
}

const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
const useDirectBackend = Boolean(import.meta.env.PROD) || isCapacitorNative();

/*
 * In production, a relative /api URL can be rewritten to the SPA's
 * index.html if the frontend's Vercel rewrite configuration is missing or
 * stale. Resolve that default to the deployed backend directly. Keep /api
 * for local web development, where Vite proxies it to localhost:4000.
 */
const requestedBaseUrl = configuredBaseUrl || (useDirectBackend ? BACKEND_API_BASE_URL : "/api");
const resolvedBaseUrl =
  useDirectBackend && /^\/api\/?$/i.test(requestedBaseUrl)
    ? BACKEND_API_BASE_URL
    : requestedBaseUrl;
const baseUrl = resolvedBaseUrl.replace(/\/$/, "");

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

export function showToast(type, message) {
  window.dispatchEvent(
    new CustomEvent("app:toast", {
      detail: {
        type,
        message,
      },
    }),
  );
}

function isRetryableRequest(path, options) {
  const method = String(options.method || "GET").toUpperCase();

  if (options.retryTransient === false) {
    return false;
  }

  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return true;
  }

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
      if (attempt >= retries) {
        throw error;
      }

      await sleep(DEFAULT_RETRY_DELAYS_MS[Math.min(attempt, DEFAULT_RETRY_DELAYS_MS.length - 1)]);
    }
  }

  return lastResponse;
}

function inferLoadingMessage(path, method = "GET") {
  const cleanPath = String(path || "").split("?")[0].toLowerCase();
  const verb = String(method || "GET").toUpperCase();

  if (cleanPath.startsWith("/auth/login")) return "Verifying credentials & signing in…";
  if (cleanPath.startsWith("/auth/")) return "Updating authentication…";
  if (cleanPath.startsWith("/marketing-list")) {
    if (verb === "POST") return "Saving item to marketing list…";
    if (verb === "PUT") return "Updating marketing list item…";
    if (verb === "DELETE") return "Removing marketing list item…";
    return "Fetching marketing list items…";
  }
  if (cleanPath.startsWith("/marketing-locations")) {
    return verb === "GET" ? "Loading shopping locations…" : "Saving shopping location…";
  }
  if (cleanPath.startsWith("/expenses")) {
    if (cleanPath.includes("/proof")) return "Uploading expense proof document…";
    if (verb === "POST") return "Saving expense & survivor shares…";
    if (verb === "PUT") return "Updating expense record…";
    if (verb === "DELETE") return "Deleting expense record…";
    return "Loading expenses for selected date…";
  }
  if (cleanPath.startsWith("/food-chart")) {
    if (verb === "POST") return "Adding recipe to food chart…";
    if (verb === "PUT") return "Updating food chart servings…";
    if (verb === "DELETE") return "Clearing food chart entries…";
    return "Loading planned meals for food chart…";
  }
  if (cleanPath.startsWith("/recipes")) {
    if (verb === "GET") return "Loading recipe catalogue…";
    return "Saving recipe changes…";
  }
  if (cleanPath.startsWith("/price-trend")) {
    return "Calculating 1-unit approximate price trend…";
  }
  if (cleanPath.startsWith("/dashboard")) {
    return "Aggregating dashboard totals & charts…";
  }
  if (cleanPath.startsWith("/reports/export-pdf")) return "Generating PDF report…";
  if (cleanPath.startsWith("/reports/email-pdf")) return "Generating & emailing report PDF…";
  if (cleanPath.startsWith("/reports")) {
    return verb === "POST" ? "Running report query…" : "Loading saved report settings…";
  }
  if (cleanPath.startsWith("/scheduled-reports")) {
    return verb === "GET" ? "Loading scheduled report jobs…" : "Updating scheduled report job…";
  }
  if (cleanPath.startsWith("/job-status")) return "Checking scheduled jobs & execution history…";
  if (cleanPath.startsWith("/bulk-upload")) return "Processing bulk upload file…";
  if (cleanPath.startsWith("/meta/categories")) return "Loading categories…";
  if (cleanPath.startsWith("/meta/items")) return "Loading items for category…";
  if (cleanPath.startsWith("/meta/units")) return "Loading measurement units…";
  if (cleanPath.startsWith("/meta/survivors")) return "Loading survivors…";
  if (cleanPath.startsWith("/users")) return "Managing user accounts…";
  if (cleanPath.startsWith("/survivors")) return "Updating survivor records…";
  return verb === "GET" ? "Fetching data from server…" : "Saving changes to server…";
}

export async function api(path, options = {}) {
  const token = localStorage.getItem("token");

  const isFormData = options.body instanceof FormData;

  const clientTimezone = getIndiaTimezone();

  const headers = {
    ...(isFormData
      ? {}
      : {
          "Content-Type": "application/json",
        }),
    "X-App-Timezone": clientTimezone,
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const showLoader = !options.silent;

  if (showLoader) {
    const resolvedMessage =
      options.loadingMessage || inferLoadingMessage(path, options.method);
    window.dispatchEvent(
      new CustomEvent("app:api:start", {
        detail: {
          message: resolvedMessage,
          path,
          method: options.method || "GET",
        },
      }),
    );
  }

  try {
    const { retryTransient, transientRetries, ...requestOptions } = options;

    const response = await fetchWithTransientRetry(
      `${baseUrl}${path}`,
      {
        ...requestOptions,
        headers,
      },
      path,
      {
        retryTransient,
        transientRetries,
      },
    );

    const text = await response.text();

    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = {
        raw: text,
      };
    }

    /*
     * Never silently accept the frontend's index.html
     * as an API response.
     */
    if (typeof text === "string" && text.trimStart().toLowerCase().startsWith("<!doctype html")) {
      throw new Error(
        `The API request ${path} was routed to the frontend instead of the backend. API base URL: ${baseUrl}`,
      );
    }

    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(
          new CustomEvent("app:auth-expired", {
            detail: { token },
          }),
        );
      }

      throw new Error(data?.error || `Request failed (${response.status})`);
    }

    if (options.toast) {
      showToast(options.toast.type || "information", options.toast.message || "Done.");
    } else if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(String(options.method || "GET").toUpperCase()) &&
      !options.silentToast &&
      !options.silent
    ) {
      showToast("success", "Operation completed successfully.");
    }

    return data;
  } catch (error) {
    const isFetchFailure = error instanceof TypeError && error.message.includes("fetch");
    const message = isFetchFailure
      ? `Unable to reach the backend API at ${baseUrl}. Verify the backend and API proxy configuration.`
      : error.message;

    let loginEmail = null;
    if (path === "/auth/login" && typeof options.body === "string") {
      try {
        loginEmail = JSON.parse(options.body)?.email || null;
      } catch {
        // Ignore malformed request bodies.
      }
    }

    // Backend HTTP failures are reported by the backend error handler.
    // Report only failures that can occur entirely on the client side, such
    // as a network outage or an API request accidentally receiving the SPA.
    if (
      !options.silent &&
      (isFetchFailure || String(message || "").includes("routed to the frontend"))
    ) {
      void reportClientError({
        category: "frontend-api-runtime",
        error,
        message,
        path,
        method: String(options.method || "GET").toUpperCase(),
        userEmail: loginEmail,
      });
    }

    if (!options.silent) {
      showToast("error", message);
    }

    throw new Error(message);
  } finally {
    if (showLoader) {
      window.dispatchEvent(new CustomEvent("app:api:end"));
    }
  }
}

export function assetUrl(path) {
  return `${baseUrl}${path}`;
}

function getIndiaTimezone() {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (timezone === "Asia/Kolkata" || timezone === "Asia/Calcutta") {
      return "Asia/Kolkata";
    }

    const offset = -new Date().getTimezoneOffset();

    if (offset === 330) {
      return "Asia/Kolkata";
    }

    return timezone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}
