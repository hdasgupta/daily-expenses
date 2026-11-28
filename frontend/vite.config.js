import { execSync } from "node:child_process";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function formatIstCommitVersion(date) {
  const istParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(istParts.map((p) => [p.type, p.value]));
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}.${map.month}.${map.day}.${hour}.${map.minute}`;
}

function resolveCommitTimestampVersion() {
  if (process.env.VITE_APP_VERSION) {
    return String(process.env.VITE_APP_VERSION).trim();
  }

  try {
    const out = execSync("git log -1 --format=%ct", {
      cwd: path.resolve(process.cwd(), ".."),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const epochSeconds = Number.parseInt(out, 10);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
      return formatIstCommitVersion(new Date(epochSeconds * 1000));
    }
  } catch {
    // Not a git checkout or git is unavailable
  }

  return formatIstCommitVersion(new Date());
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(resolveCommitTimestampVersion()),
  },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (id.includes("node_modules/recharts")) {
            return "charts";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "icons";
          }
          if (id.includes("node_modules/@capacitor/")) {
            return "capacitor";
          }
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
