import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function resolveAutoIncrementVersion() {
  if (process.env.VITE_APP_VERSION) {
    return String(process.env.VITE_APP_VERSION).trim();
  }

  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const parts = String(pkg.version || "2.0.0").split(".");
  const major = Number.parseInt(parts[0], 10) || 2;
  const minor = Number.parseInt(parts[1], 10) || 0;
  const patch = Number.parseInt(parts[2], 10) || 0;

  try {
    const out = execSync("git rev-list --count HEAD", {
      cwd: path.resolve(process.cwd(), ".."),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const count = Number.parseInt(out, 10);
    if (Number.isFinite(count) && count > 1) {
      return `${major}.${minor}.${Math.max(patch, count)}`;
    }
  } catch {
    // Not a git checkout or git is unavailable
  }

  if (process.env.VERCEL === "1" || process.env.CI) {
    const istParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const map = Object.fromEntries(istParts.map((p) => [p.type, p.value]));
    const buildStamp = `${map.year}${map.month}${map.day}${map.hour}${map.minute}`;
    return `${major}.${minor}.${patch}.${buildStamp}`;
  }

  return `${major}.${minor}.${patch}`;
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(resolveAutoIncrementVersion()),
  },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
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
