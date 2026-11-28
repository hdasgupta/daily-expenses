import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { reportClientError } from "./lib/clientErrorReporter";

class AppErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Root rendering error", error, errorInfo);
    void reportClientError({
      category: "frontend-root-error",
      error,
      stack: `${error?.stack || ""}\n${errorInfo?.componentStack || ""}`,
      path: typeof window !== "undefined" ? window.location.pathname : "",
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div style={{ padding: "24px", maxWidth: "640px", margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
        <div className="card" style={{ padding: "20px" }}>
          <h2>Unable to load page</h2>
          <p>{msg}</p>
          <div className="form-actions" style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
            <button
              className="primary"
              type="button"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                try {
                  sessionStorage.clear();
                } catch {}
                window.location.href = "/";
              }}
            >
              Reset &amp; Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}

window.addEventListener(
  "error",
  (e) =>
    void reportClientError({
      category: "frontend-global-error",
      error: e.error,
      message: e.message,
      stack: e.error?.stack,
      path: window.location.pathname,
    }),
);
window.addEventListener("unhandledrejection", (e) => {
  const r =
    e.reason instanceof Error
      ? e.reason
      : new Error(String(e.reason ?? "Unhandled promise rejection"));
  void reportClientError({
    category: "frontend-unhandled-rejection",
    error: r,
    path: window.location.pathname,
  });
});
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
