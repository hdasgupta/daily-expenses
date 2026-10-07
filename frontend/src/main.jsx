import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { reportClientError } from "./lib/clientErrorReporter";
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
    <App />
  </React.StrictMode>,
);
