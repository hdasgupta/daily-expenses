import React, { useState } from "react";
import {
  Menu,
  LogOut,
  Sun,
  Moon,
  PanelLeftClose,
  Receipt,
  Users,
  Package,
  Scale,
  Upload,
  FileSpreadsheet,
  BarChart3,
  LayoutDashboard,
} from "lucide-react";

const navMeta = {
  "add-expense": ["Add expenses", Receipt],
  "add-survivor": ["Add survivors", Users],
  "add-item": ["Categories & items", Package],
  "add-unit": ["Add units", Scale],
  "bulk-upload-expenses": ["Bulk upload expenses", Upload],
  "bulk-upload-categories-items": [
    "Bulk upload categories & items",
    FileSpreadsheet,
  ],
  report: ["Reports", BarChart3],
  dashboard: ["Dashboard", LayoutDashboard],
  "add-user": ["Add user", Users],
};

export default function Layout({ user, onLogout, children, go, currentPath }) {
  const [open, setOpen] = useState(false),
    [dark, setDark] = useState(localStorage.getItem("theme") === "dark");
  const toggle = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("theme", d ? "dark" : "light");
  };
  return (
    <div className="app">
      <header>
        <div className="top">
          <span>{user.fullName}</span>
          <b>{user.role}</b>
          <button aria-label="Toggle theme" onClick={toggle}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button onClick={onLogout}>
            <LogOut size={18} /> Logout
          </button>
        </div>
        <div className="brand">
          <div className="logo">RC</div>
          <div>
            <strong>Rehabilitation Center</strong>
            <small>Expense Tracker</small>
          </div>
        </div>
      </header>
      <button
        className="menu"
        aria-label={open ? "Close navigation" : "Open navigation"}
        onClick={() => setOpen(!open)}
      >
        {open ? <PanelLeftClose /> : <Menu />}
      </button>
      {open && (
        <button
          className="drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={open ? "drawer open" : "drawer"}>
        {user.permissions.map((permission) => {
          const [label, Icon] = navMeta[permission] || [
            permission.replaceAll("-", " "),
            null,
          ];
          const path = "/" + permission;
          return (
            <button
              type="button"
              className={currentPath === path ? "active" : ""}
              key={permission}
              onClick={(e) => {
                e.preventDefault();
                go(path);
                setOpen(false);
              }}
            >
              {Icon ? <Icon size={18} /> : null}
              <span>{label}</span>
            </button>
          );
        })}
      </aside>
      <main>{children}</main>
    </div>
  );
}
