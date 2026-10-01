const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

export async function downloadPdf(path, body, loadingMessage = "Preparing PDF report…") {
  const token = localStorage.getItem("token");
  const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  const headers = {
    "Content-Type": "application/json",
    "X-App-Timezone": clientTimezone,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  window.dispatchEvent(new CustomEvent("app:api:start", { detail: { message: loadingMessage } }));
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = `Request failed (${response.status})`;
      try {
        message = JSON.parse(text)?.error || message;
      } catch {}
      if (response.status === 401) window.dispatchEvent(new CustomEvent("app:auth-expired"));
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "expense-report.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    window.dispatchEvent(
      new CustomEvent("app:toast", {
        detail: { type: "success", message: "Report PDF downloaded." },
      }),
    );
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent("app:toast", { detail: { type: "error", message: error.message } }),
    );
    throw error;
  } finally {
    window.dispatchEvent(new CustomEvent("app:api:end"));
  }
}
