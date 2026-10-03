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
import JobStatus from "./pages/JobStatus";
import { api } from "./lib/api";

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
  "/job-status": { component: JobStatus, permission: "job-status" },
};

function normalizePath(pathname) {
  const cleanPath = String(pathname || "/").split("?")[0];
  const result = cleanPath.replace(/\/+/g, "/").replace(/\/$/, "");
  return result || "/";
}

function normalizePermissions(permissions) {
  if (Array.isArray(permissions)) {
    return permissions
      .map((permission) => String(permission || "").trim())
      .filter(Boolean);
  }

  if (typeof permissions === "string") {
    return permissions
      .split(",")
      .map((permission) => permission.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeUser(nextUser) {
  if (!nextUser || typeof nextUser !== "object") return null;

  return {
    ...nextUser,
    permissions: normalizePermissions(nextUser.permissions),
  };
}

function routeForPath(path) {
  if (routes[path]) return routes[path];

  if (path.startsWith("/dashboard/report/")) {
    return { component: DashboardDetail, permission: "dashboard" };
  }

  if (path.startsWith("/dashboard/drilldown/")) {
    return { component: DashboardDrilldown, permission: "dashboard" };
  }

  return null;
}

export default function App() {
  const [path, setPath] = useState(() =>
    normalizePath(window.location.pathname),
  );
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const popState = () => {
      setPath(normalizePath(window.location.pathname));
    };

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
      api("/me", {
        loadingMessage: "Checking your session…",
      })
        .then((nextUser) => {
          setUser(normalizeUser(nextUser));
        })
        .catch(expired)
        .finally(() => setChecking(false));
    }

    return () => {
      window.removeEventListener("popstate", popState);
      window.removeEventListener("app:auth-expired", expired);
    };
  }, []);

  const allowedItems = useMemo(
    () => getNavigationItems(user?.permissions || []),
    [user],
  );

  useEffect(() => {
    if (checking || !user) return;

    const route = routeForPath(path);
    const permissions = normalizePermissions(user.permissions);
    const allowed =
      route && permissions.includes(route.permission);

    if (allowed) return;

    const fallback = allowedItems[0]?.path;

    if (fallback) {
      window.history.replaceState({}, "", fallback);
      setPath(fallback);
    }
  }, [allowedItems, checking, path, user]);

  const handleLogin = async (nextUser) => {
    const normalizedUser = normalizeUser(nextUser);

    setUser(normalizedUser);

    const permissions = normalizePermissions(normalizedUser?.permissions);
    const requestedPath = normalizePath(window.location.pathname);
    const requestedRoute = routeForPath(requestedPath);

    const requestedAllowed =
      requestedRoute &&
      permissions.includes(requestedRoute.permission);

    const navigationItems = getNavigationItems(permissions);
    const fallback = navigationItems[0]?.path;
    const destination = requestedAllowed ? requestedPath : fallback;

    if (destination) {
      window.history.replaceState({}, "", destination);
      setPath(destination);
      return;
    }

    // If the login response did not contain permissions, refresh the account
    // from the backend before deciding that the account has no assigned module.
    if (permissions.length === 0) {
      try {
        const refreshedUser = normalizeUser(
          await api("/me", {
            loadingMessage: "Loading your account…",
            silent: true,
            silentToast: true,
          }),
        );

        setUser(refreshedUser);

        const refreshedPermissions = normalizePermissions(
          refreshedUser?.permissions,
        );
        const refreshedItems = getNavigationItems(refreshedPermissions);
        const refreshedFallback = refreshedItems[0]?.path;

        if (refreshedFallback) {
          window.history.replaceState({}, "", refreshedFallback);
          setPath(refreshedFallback);
        }
      } catch {
        localStorage.removeItem("token");
        setUser(null);
        window.history.replaceState({}, "", "/");
        setPath("/");
      }
    }
  };

  const navigate = (next) => {
    const [rawPath, search = ""] = String(next || "/").split("?");
    const target = normalizePath(rawPath);
    const route = routeForPath(target);
    const permissions = normalizePermissions(user?.permissions);

    if (!route || !permissions.includes(route.permission)) return;

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

  if (checking) {
    return (
      <>
        <Loader />
        <Toast />
        <div className="auth-loading">
          <div className="card">Checking your session…</div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Loader />
        <Toast />
        <Login onLogin={handleLogin} initialPath={path} />
      </>
    );
  }

  const route = routeForPath(path);
  const permissions = normalizePermissions(user.permissions);
  const navigationItems = getNavigationItems(permissions);
  const Component =
    route?.component || routes[navigationItems[0]?.path]?.component;

  if (!Component) {
    return (
      <div className="auth-loading">
        <div className="card">
          No module is assigned to this account.
        </div>
      </div>
    );
  }

  return (
    <>
      <Loader />
      <Toast />
      <Layout
        user={user}
        path={path}
        navigate={navigate}
        logout={logout}
      >
        <RouteErrorBoundary>
          <Component
            type={route?.type}
            navigate={navigate}
            user={user}
          />
        </RouteErrorBoundary>
      </Layout>
    </>
  );
}
