import React, { useEffect, useState } from "react";
import {
  ClipboardList,
  Database,
  FileBarChart,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Sun,
  Tags,
  UserRound,
  Users,
  X,
} from "lucide-react";

const navItems = [
  {
    path: "/add-expense",
    label: "Add expenses",
    icon: ClipboardList,
    permission: "add-expense",
  },
  {
    path: "/add-survivor",
    label: "Add survivors",
    icon: Users,
    permission: "add-survivor",
  },
  {
    path: "/add-item",
    label: "Add items",
    icon: Tags,
    permission: "add-item",
  },
  {
    path: "/add-unit",
    label: "Add units",
    icon: Database,
    permission: "add-unit",
  },
  {
    path: "/bulk-upload-expenses",
    label: "Bulk upload expenses",
    icon: ClipboardList,
    permission: "bulk-upload-expenses",
  },
  {
    path: "/bulk-upload-categories-items",
    label: "Bulk upload categories/items",
    icon: Tags,
    permission: "bulk-upload-categories-items",
  },
  {
    path: "/report",
    label: "Reports",
    icon: FileBarChart,
    permission: "report",
  },
  {
    path: "/dashboard",
    label: "Dashboard",
    icon: Gauge,
    permission: "dashboard",
  },
  {
    path: "/job-status",
    label: "Job Status",
    icon: RefreshCw,
    permission: "job-status",
  },
  {
    path: "/add-user",
    label: "Add users",
    icon: UserRound,
    permission: "add-user",
  },
];

function normalizePermissions(permissions) {
  if (Array.isArray(permissions)) {
    return permissions
      .flatMap((permission) => {
        if (typeof permission !== "string") {
          return [];
        }

        return permission
          .replace(/^\{|\}$/g, "")
          .split(",")
          .map((value) => value.replace(/^"|"$/g, ""));
      })
      .map((permission) => permission.trim())
      .filter(Boolean);
  }

  if (typeof permissions === "string") {
    let value = permissions.trim();

    /*
     * PostgreSQL text[] representation:
     * {add-expense,add-item,report}
     */
    if (value.startsWith("{") && value.endsWith("}")) {
      value = value.slice(1, -1);
    }

    /*
     * JSON array representation:
     * ["add-expense","report"]
     */
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        const parsed = JSON.parse(value);

        if (Array.isArray(parsed)) {
          return normalizePermissions(parsed);
        }
      } catch {
        // Continue with normal parsing.
      }
    }

    return value
      .split(/[,\s]+/)
      .map((permission) =>
        permission
          .trim()
          .replace(/^\{|\}$/g, "")
          .replace(/^"|"$/g, ""),
      )
      .filter(Boolean);
  }

  if (permissions && typeof permissions === "object") {
    if (Array.isArray(permissions.permissions)) {
      return normalizePermissions(permissions.permissions);
    }

    return Object.entries(permissions)
      .filter(([, enabled]) => enabled === true)
      .map(([permission]) => permission.trim())
      .filter(Boolean);
  }

  return [];
}

export function getNavigationItems(permissions) {
  const normalized = normalizePermissions(permissions);

  return navItems.filter((item) => normalized.includes(item.permission));
}

export default function Layout({ user, path, navigate, logout, children }) {
  const [open, setOpen] = useState(false);

  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);

    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  const toggleTheme = () => setDark((value) => !value);

  const navigationItems = getNavigationItems(user?.permissions);
  const fullName = String(
    user?.fullName ||
      user?.full_name ||
      user?.name ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
      "User",
  ).trim();

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="top-header">
          <div className="user-header">
            <span className="user-full-name">{fullName}</span>

            <span className="role-pill">{user?.role || ""}</span>

            <button
              className="header-button"
              onClick={toggleTheme}
              title={dark ? "Light mode" : "Dark mode"}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}

              <span>{dark ? "Light" : "Dark"}</span>
            </button>

            <button className="header-button" onClick={logout} title="Logout" aria-label="Logout">
              <LogOut size={17} />
            </button>
          </div>
        </div>

        <div
          className="brand-row"
          style={{
            position: "relative",
            zIndex: 2,
            paddingLeft: "56px",
          }}
        >
          <div className="brand-mark">
            {import.meta.env.VITE_ORGANIZATION_LOGO_URL ? (
              <img src={import.meta.env.VITE_ORGANIZATION_LOGO_URL} alt="Organization" />
            ) : (
              <img src="logo.png" width="32" height="32" alt="Organization" />
            )}
          </div>

          <div>
            <strong>{import.meta.env.VITE_ORGANIZATION_NAME || "Rehabilitation Center"}</strong>

            <span>Daily Expenses</span>
          </div>
        </div>
      </header>

      <button
        className="drawer-toggle"
        onClick={() => setOpen((value) => !value)}
        title={open ? "Hide navigation" : "Show navigation"}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {open ? <div className="drawer-backdrop" onClick={() => setOpen(false)} /> : null}

      <aside className={`navigation-drawer ${open ? "open" : ""}`}>
        <div className="drawer-title">Navigation</div>

        {navigationItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.path}
              className={
                path === item.path || (item.path === "/dashboard" && path.startsWith("/dashboard"))
                  ? "active"
                  : ""
              }
              onClick={() => navigate(item.path)}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}

        <div className="drawer-foot">
          <KeyRound size={15} />
          Permission-based access
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
