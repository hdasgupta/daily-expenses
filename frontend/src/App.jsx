import React, { useEffect, useState } from "react";
import Layout from "./components/Layout";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import Login from "./pages/Login";
import Expense from "./pages/Expense";
import { Survivors, CategoriesItems, Units } from "./pages/Crud";
import Reports from "./pages/Reports";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import { api } from "./lib/api";
import {
  BulkUploadExpenses,
  BulkUploadCategoriesItems,
} from "./pages/BulkUpload";

const routes = {
  "/add-expense": { component: Expense, permission: "add-expense" },
  "/add-survivor": { component: Survivors, permission: "add-survivor" },
  "/add-item": { component: CategoriesItems, permission: "add-item" },
  "/add-unit": { component: Units, permission: "add-unit" },
  "/bulk-upload-expenses": {
    component: BulkUploadExpenses,
    permission: "bulk-upload-expenses",
  },
  "/bulk-upload-categories-items": {
    component: BulkUploadCategoriesItems,
    permission: "bulk-upload-categories-items",
  },
  "/report": { component: Reports, permission: "report" },
  "/dashboard": { component: Dashboard, permission: "dashboard" },
  "/add-user": { component: Users, permission: "add-user" },
};

const preferredPaths = [
  "/dashboard",
  "/add-expense",
  "/report",
  "/add-survivor",
  "/add-item",
  "/add-unit",
  "/bulk-upload-expenses",
  "/bulk-upload-categories-items",
  "/add-user",
];

function normalizePath(path) {
  const p = (path || "/")
    .split("?")[0]
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
  return p || "/";
}

function firstAllowedPath(user) {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return (
    preferredPaths.find((p) => permissions.includes(routes[p]?.permission)) ||
    null
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [path, setPath] = useState(() =>
    normalizePath(window.location.pathname),
  );
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      localStorage.getItem("theme") === "dark",
    );
    const onPop = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    const token = localStorage.getItem("token");
    if (!token) {
      setChecking(false);
      return () => window.removeEventListener("popstate", onPop);
    }
    api("/me", { loadingMessage: "Checking your session…" })
      .then((u) => setUser(u))
      .catch(() => {
        localStorage.removeItem("token");
        setUser(null);
        if (window.location.pathname !== "/")
          window.history.replaceState({}, "", "/");
        setPath("/");
      })
      .finally(() => setChecking(false));
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Resolve the login/root entry point only after authentication state exists.
  useEffect(() => {
    if (checking || !user) return;
    if (path === "/" || path === "/login") {
      const next = firstAllowedPath(user);
      if (next && next !== path) {
        window.history.replaceState({}, "", next);
        setPath(next);
      }
    }
  }, [checking, user, path]);

  const go = (nextPath) => {
    const next = normalizePath(nextPath);
    if (next === path) return;
    if (!routes[next]) return;
    if (user && !user.permissions?.includes(routes[next].permission)) return;
    window.history.pushState({}, "", next);
    setPath(next);
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
    window.history.replaceState({}, "", "/");
    setPath("/");
  };

  if (checking)
    return (
      <div className="login">
        <div className="card">
          <p>Checking your session…</p>
        </div>
      </div>
    );

  if (!user) {
    return (
      <Login
        onLogin={(u) => {
          localStorage.setItem(
            "token",
            u?.token || localStorage.getItem("token") || "",
          );
          setUser(u);
          const current = normalizePath(window.location.pathname);
          const currentRoute = routes[current];
          const canOpenCurrent = Boolean(
            currentRoute && u?.permissions?.includes(currentRoute.permission),
          );
          const next = canOpenCurrent ? current : firstAllowedPath(u);
          const target = next || "/";
          if (target !== current) window.history.replaceState({}, "", target);
          setPath(target);
        }}
      />
    );
  }

  if (path === "/" || path === "/login") {
    return (
      <div className="login">
        <div className="card">
          <p>Opening your permitted module…</p>
        </div>
      </div>
    );
  }

  const route = routes[path];
  if (!route) {
    const fallback = firstAllowedPath(user);
    if (fallback) {
      window.history.replaceState({}, "", fallback);
      setPath(fallback);
      return null;
    }
    return (
      <Layout user={user} go={go} currentPath={path} onLogout={logout}>
        <section className="card">
          <h2>Page not found</h2>
          <p className="notice">The requested page does not exist.</p>
        </section>
      </Layout>
    );
  }

  if (!user.permissions?.includes(route.permission)) {
    return (
      <Layout user={user} go={go} currentPath={path} onLogout={logout}>
        <section className="card">
          <h2>Access denied</h2>
          <p className="notice">
            Your role does not have permission to open this module.
          </p>
        </section>
      </Layout>
    );
  }

  const C = route.component;
  return (
    <Layout user={user} go={go} currentPath={path} onLogout={logout}>
      <RouteErrorBoundary routeKey={path}>
        <C key={path} />
      </RouteErrorBoundary>
    </Layout>
  );
}
