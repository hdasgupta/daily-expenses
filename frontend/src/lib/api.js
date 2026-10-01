const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
export function showToast(type, message) {
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { type, message } }));
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
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
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
      ["POST", "PUT", "PATCH", "DELETE"].includes(String(options.method || "GET").toUpperCase()) &&
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
