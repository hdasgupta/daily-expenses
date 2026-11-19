import pkg from "../../package.json";

const buildVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

export const APP_VERSION = String(
  import.meta.env.VITE_APP_VERSION || buildVersion || pkg.version || "2.0.1",
).trim();
