import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, "../package.json");

function getGitCommitCount() {
  try {
    const out = execSync("git rev-list --count HEAD", {
      cwd: path.resolve(__dirname, "../.."),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const count = Number.parseInt(out, 10);
    return Number.isFinite(count) && count > 1 ? count : null;
  } catch {
    return null;
  }
}

if (process.env.VITE_APP_VERSION) {
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const parts = String(pkg.version || "2.0.0").split(".");
const major = Number.parseInt(parts[0], 10) || 2;
const minor = Number.parseInt(parts[1], 10) || 0;
const patch = Number.parseInt(parts[2], 10) || 0;

const gitCount = getGitCommitCount();
const nextPatch = gitCount !== null ? Math.max(patch, gitCount) : patch + 1;
const nextVersion = `${major}.${minor}.${nextPatch}`;

if (pkg.version !== nextVersion && !process.env.CI && !process.env.VERCEL) {
  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log(`[version] Auto-incremented app version to v${nextVersion}`);
}
