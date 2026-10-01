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
  Shield,
  Sun,
  Tags,
  UserRound,
  Users,
  X,
} from "lucide-react";

const navItems = [
  { path: "/add-expense", label: "Add expenses", icon: ClipboardList, permission: "add-expense" },
  { path: "/add-survivor", label: "Add survivors", icon: Users, permission: "add-survivor" },
  { path: "/add-item", label: "Add items", icon: Tags, permission: "add-item" },
  { path: "/add-unit", label: "Add units", icon: Database, permission: "add-unit" },
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
  { path: "/report", label: "Reports", icon: FileBarChart, permission: "report" },
  { path: "/dashboard", label: "Dashboard", icon: Gauge, permission: "dashboard" },
  { path: "/add-user", label: "Add users", icon: UserRound, permission: "add-user" },
];

export function getNavigationItems(permissions) {
  return navItems.filter((item) => permissions?.includes(item.permission));
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

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="top-header">
          <div className="user-header">
            <span>{user.fullName}</span>
            <span className="role-pill">{user.role}</span>
            <button
              className="header-button"
              onClick={toggleTheme}
              title={dark ? "Light mode" : "Dark mode"}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
              <span>{dark ? "Light" : "Dark"}</span>
            </button>
            <button className="header-button" onClick={logout} title="Logout">
              <LogOut size={17} /> <span>Logout</span>
            </button>
          </div>
        </div>
        <div className="brand-row">
          <div className="brand-mark">
            {import.meta.env.VITE_ORGANIZATION_LOGO_URL ? (
              <img src={import.meta.env.VITE_ORGANIZATION_LOGO_URL} alt="Organization" />
            ) : (
              <Shield size={28} />
            )}
          </div>
          <div>
            <strong>{import.meta.env.VITE_ORGANIZATION_NAME || "Rehabilitation Center"}</strong>
            <span>Expense Tracker</span>
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
        {getNavigationItems(user.permissions).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              className={path === item.path ? "active" : ""}
              onClick={() => navigate(item.path)}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}
        <div className="drawer-foot">
          <KeyRound size={15} /> Permission-based access
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
