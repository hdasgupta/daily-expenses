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
  "/add-expense": {
    component: Expense,
    permission: "add-expense",
  },
  "/add-survivor": {
    component: Survivors,
    permission: "add-survivor",
  },
  "/add-item": {
    component: CategoriesItems,
    permission: "add-item",
  },
  "/add-unit": {
    component: Units,
    permission: "add-unit",
  },
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
  "/report": {
    component: Reports,
    permission: "report",
  },
  "/dashboard": {
    component: Dashboard,
    permission: "dashboard",
  },
  "/add-user": {
    component: Users,
    permission: "add-user",
  },
  "/job-status": {
    component: JobStatus,
    permission: "job-status",
  },
};

const PERMISSIONS_BY_ROLE = {
  admin: [
    "add-expense",
    "add-survivor",
    "add-item",
    "add-unit",
    "bulk-upload-expenses",
    "bulk-upload-categories-items",
    "report",
    "dashboard",
    "add-user",
    "job-status",
  ],
  manager: [
    "add-expense",
    "report",
    "dashboard",
    "job-status",
  ],
  editor: [
    "add-expense",
  ],
};

function normalizePath(pathname) {
  const cleanPath = String(pathname || "/").split("?")[0];
  const result = cleanPath.replace(/\/+/g, "/").replace(/\/$/, "");
  return result || "/";
}

function normalizePermissions(permissions) {
  if (Array.isArray(permissions)) {
    return permissions
      .flatMap((permission) =>
        typeof permission === "string"
          ? permission.split(",")
          : [],
      )
      .map((permission) => permission.trim())
      .filter(Boolean);
  }

  if (typeof permissions === "string") {
    return permissions
      .split(/[,\s]+/)
      .map((permission) => permission.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeUser(rawUser) {
  if (!rawUser || typeof rawUser !== "object") {
    return null;
  }

  const role = String(rawUser.role || "")
    .trim()
    .toLowerCase();

  let permissions = normalizePermissions(rawUser.permissions);

  /*
   * Some Android/WebView builds can receive an unexpected representation of
   * the PostgreSQL permission array. If permissions are missing but the
   * authenticated backend has supplied a known role, use the role's defined
   * permissions locally.
   *
   * This does NOT grant permissions to an unknown role.
   */
  if (permissions.length === 0 && PERMISSIONS_BY_ROLE[role]) {
    permissions = [...PERMISSIONS_BY_ROLE[role]];
  }

  return {
    ...rawUser,
    role,
    permissions,
  };
}

function routeForPath(path) {
  if (routes[path]) {
    return routes[path];
  }

  if (path.startsWith("/dashboard/report/")) {
    return {
      component: DashboardDetail,
      permission: "dashboard",
    };
  }

  if (path.startsWith("/dashboard/drilldown/")) {
    return {
      component: DashboardDrilldown,
      permission: "dashboard",
    };
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
        .finally(() => {
          setChecking(false);
        });
    }

    return () => {
      window.removeEventListener("popstate", popState);
      window.removeEventListener("app:auth-expired", expired);
    };
  }, []);

  const allowedItems = useMemo(() => {
    return getNavigationItems(
      normalizePermissions(user?.permissions),
    );
  }, [user]);

  useEffect(() => {
    if (checking || !user) {
      return;
    }

    const permissions = normalizePermissions(user.permissions);
    const route = routeForPath(path);

    const allowed =
      route &&
      permissions.includes(route.permission);

    if (allowed) {
      return;
    }

    const fallback = allowedItems[0]?.path;

    if (fallback) {
      window.history.replaceState({}, "", fallback);
      setPath(fallback);
    }
  }, [allowedItems, checking, path, user]);

  const handleLogin = async (nextUser) => {
    let normalizedUser = normalizeUser(nextUser);

    /*
     * Always refresh /me after login.
     *
     * This removes any difference between the object returned by
     * /auth/login and the object used by the authenticated application.
     */
    try {
      const refreshedUser = await api("/me", {
        loadingMessage: "Loading your account…",
        silent: true,
        silentToast: true,
      });

      if (refreshedUser) {
        normalizedUser = normalizeUser(refreshedUser);
      }
    } catch {
      // Keep the successful login response if /me cannot be refreshed.
    }

    setUser(normalizedUser);

    const permissions = normalizePermissions(
      normalizedUser?.permissions,
    );

    const requestedPath = normalizePath(
      window.location.pathname,
    );

    const requestedRoute = routeForPath(requestedPath);

    const requestedAllowed =
      requestedRoute &&
      permissions.includes(requestedRoute.permission);

    const fallback =
      getNavigationItems(permissions)[0]?.path;

    const destination =
      requestedAllowed
        ? requestedPath
        : fallback;

    if (destination) {
      window.history.replaceState({}, "", destination);
      setPath(destination);
    } else {
      /*
       * Do not leave the application on "/" where the component lookup can
       * produce the misleading "No module" screen.
       */
      window.history.replaceState(
        {},
        "",
        "/add-expense",
      );

      setPath("/add-expense");
    }
  };

  const navigate = (next) => {
    const [rawPath, search = ""] =
      String(next || "/").split("?");

    const target = normalizePath(rawPath);
    const route = routeForPath(target);
    const permissions = normalizePermissions(
      user?.permissions,
    );

    if (
      !route ||
      !permissions.includes(route.permission)
    ) {
      return;
    }

    const url = search
      ? `${target}?${search}`
      : target;

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
          <div className="card">
            Checking your session…
          </div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Loader />
        <Toast />

        <Login
          onLogin={handleLogin}
          initialPath={path}
        />
      </>
    );
  }

  const route = routeForPath(path);

  const permissions = normalizePermissions(
    user.permissions,
  );

  const navigationItems =
    getNavigationItems(permissions);

  const fallbackPath =
    navigationItems[0]?.path;

  const Component =
    route?.component ||
    (fallbackPath
      ? routes[fallbackPath]?.component
      : null);

  if (!Component) {
    /*
     * This screen is now diagnostic rather than silently claiming that the
     * account has no module. It also tells us exactly what Android received.
     */
    return (
      <>
        <Loader />
        <Toast />

        <div className="auth-loading">
          <div className="card">
            <h2>No module is assigned to this account.</h2>

            <p>
              Account: {user.email || "unknown"}
            </p>

            <p>
              Role: {user.role || "unknown"}
            </p>

            <p>
              Permissions received:{" "}
              {permissions.length
                ? permissions.join(", ")
                : "none"}
            </p>

            <button
              className="primary"
              type="button"
              onClick={() => {
                localStorage.removeItem("token");
                setUser(null);
                setPath("/");
                window.history.replaceState(
                  {},
                  "",
                  "/",
                );
              }}
            >
              Return to login
            </button>
          </div>
        </div>
      </>
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
