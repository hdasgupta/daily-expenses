import React, { useEffect, useMemo, useState } from "react";
import Layout, { getNavigationItems } from "./components/Layout";
import Loader from "./components/Loader";
import Toast from "./components/Toast";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import Login from "./pages/Login";
import Expense from "./pages/Expense";
import Survivors from "./pages/Survivors";
import CategoriesItems from "./pages/CategoriesItems";
import Units from "./pages/Units";
import BulkUpload from "./pages/BulkUpload";
import Reports from "./pages/Reports";
import Dashboard from "./pages/Dashboard";
import DashboardDetail from "./pages/DashboardDetail";
import DashboardDrilldown from "./pages/DashboardDrilldown";
import Users from "./pages/Users";
import { api } from "./lib/api";
import { isIndiaTimezone } from "./utils/dates.js";

const routes = {
  "/add-expense": { component: Expense, permission: "add-expense" },
  "/add-survivor": { component: Survivors, permission: "add-survivor" },
  "/add-item": { component: CategoriesItems, permission: "add-item" },
  "/add-unit": { component: Units, permission: "add-unit" },
  "/bulk-upload-expenses": {
    component: BulkUpload,
    permission: "bulk-upload-expenses",
    type: "expenses",
  },
  "/bulk-upload-categories-items": {
    component: BulkUpload,
    permission: "bulk-upload-categories-items",
    type: "categories-items",
  },
  "/report": { component: Reports, permission: "report" },
  "/dashboard": { component: Dashboard, permission: "dashboard" },
  "/add-user": { component: Users, permission: "add-user" },
};

function normalizePath(pathname) {
  const cleanPath = String(pathname || "/").split("?")[0];
  const result = cleanPath.replace(/\/+/g, "/").replace(/\/$/, "");
  return result || "/";
}

function routeForPath(path) {
  if (routes[path]) return routes[path];
  if (path.startsWith("/dashboard/report/")) return { component: DashboardDetail, permission: "dashboard" };
  if (path.startsWith("/dashboard/drilldown/")) return { component: DashboardDrilldown, permission: "dashboard" };
  return null;
}

export default function App() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const indiaTimezone = isIndiaTimezone();

  useEffect(() => {
    const popState = () => setPath(normalizePath(window.location.pathname));
    const expired = () => {
      localStorage.removeItem("token");
      setUser(null);
      setPath("/");
      window.history.replaceState({}, "", "/");
    };
    window.addEventListener("popstate", popState);
    window.addEventListener("app:auth-expired", expired);
    const token = localStorage.getItem("token");
    if (!token) {
      setChecking(false);
    } else {
      api("/me", { loadingMessage: "Checking your session…" })
        .then(setUser)
        .catch(expired)
        .finally(() => setChecking(false));
    }
    return () => {
      window.removeEventListener("popstate", popState);
      window.removeEventListener("app:auth-expired", expired);
    };
  }, []);

  const allowedItems = useMemo(() => getNavigationItems(user?.permissions), [user]);

  useEffect(() => {
    if (checking || !user) return;
    const route = routeForPath(path);
    const allowed = route && user.permissions?.includes(route.permission);
    if (allowed) return;
    const fallback = allowedItems[0]?.path;
    if (fallback) {
      window.history.replaceState({}, "", fallback);
      setPath(fallback);
    }
  }, [allowedItems, checking, path, user]);

  const navigate = (next) => {
    const [rawPath, search = ""] = String(next || "/").split("?");
    const target = normalizePath(rawPath);
    const route = routeForPath(target);
    if (!route || !user?.permissions?.includes(route.permission)) return;
    const url = search ? `${target}?${search}` : target;
    window.history.pushState({}, "", url);
    setPath(target);
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
    window.history.replaceState({}, "", "/");
    setPath("/");
  };

  if (!indiaTimezone)
    return (
      <>
        <Toast />
        <div className="auth-loading">
          <div className="card">
            <h2>Access unavailable</h2>
            <p>This application is available only in India (Indian Standard Time).</p>
            <p>
              Your browser reports a time zone that is not recognized as Indian Standard Time. If
              you are in India, check your device date/time and time zone settings.
            </p>
          </div>
        </div>
      </>
    );
  if (checking)
    return (
      <>
        <Loader />
        <Toast />
        <div className="auth-loading">
          <div className="card">Checking your session…</div>
        </div>
      </>
    );
  if (!user)
    return (
      <>
        <Loader />
        <Toast />
        <Login onLogin={(nextUser) => setUser(nextUser)} initialPath={path} />
      </>
    );

  const route = routeForPath(path);
  const Component = route?.component || routes[allowedItems[0]?.path]?.component;
  if (!Component)
    return (
      <div className="auth-loading">
        <div className="card">No module is assigned to this account.</div>
      </div>
    );

  return (
    <>
      <Loader />
      <Toast />
      <Layout user={user} path={path} navigate={navigate} logout={logout}>
        <RouteErrorBoundary>
          <Component type={route?.type} navigate={navigate} />
        </RouteErrorBoundary>
      </Layout>
    </>
  );
}
