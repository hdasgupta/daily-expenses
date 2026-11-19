import pkg from "../../package.json";

export const APP_VERSION = String(import.meta.env.VITE_APP_VERSION || pkg.version || "2.0.0").trim();
