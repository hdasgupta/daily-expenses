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

function normalizePermissions(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizePermissions(item));
  }

  if (typeof value === "string") {
    let text = value.trim();

    if (!text) {
      return [];
    }

    /*
     * PostgreSQL array:
     * {add-expense,add-item,report}
     */
    if (text.startsWith("{") && text.endsWith("}")) {
      text = text.slice(1, -1);
    }

    /*
     * JSON array:
     * ["add-expense","report"]
     */
    if (text.startsWith("[") && text.endsWith("]")) {
      try {
        const parsed = JSON.parse(text);

        if (Array.isArray(parsed)) {
          return normalizePermissions(parsed);
        }
      } catch {
        // Continue with string parsing.
      }
    }

    /*
     * PostgreSQL array values may contain quoted items.
     */
    return text
      .split(",")
      .flatMap((item) => {
        const cleaned = item
          .trim()
          .replace(/^["']|["']$/g, "")
          .replace(/^\{|\}$/g, "")
          .trim();

        return cleaned ? [cleaned] : [];
      });
  }

  if (value && typeof value === "object") {
    if (Array.isArray(value.permissions)) {
      return normalizePermissions(value.permissions);
    }

    /*
     * Support objects such as:
     * { "add-expense": true, "report": true }
     */
    const enabled = Object.entries(value)
      .filter(([, enabledValue]) => enabledValue === true)
      .map(([permission]) => permission);

    if (enabled.length) {
      return enabled;
    }
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

  let permissions = normalizePermissions(
    rawUser.permissions,
  );

  if (
    permissions.length === 0 &&
    PERMISSIONS_BY_ROLE[role]
  ) {
    permissions = [
      ...PERMISSIONS_BY_ROLE[role],
    ];
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
  const [rawMe, setRawMe] = useState(null);

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
    window.addEventListener(
      "app:auth-expired",
      expired,
    );

    const token = localStorage.getItem("token");

    if (!token) {
      setChecking(false);
    } else {
      api("/me", {
        loadingMessage: "Checking your session…",
      })
        .then((nextUser) => {
          setRawMe(nextUser);

          const normalized = normalizeUser(nextUser);

          console.log(
            "RAW /me RESPONSE:",
            nextUser,
          );

          console.log(
            "RAW permissions:",
            nextUser?.permissions,
          );

          console.log(
            "NORMALIZED permissions:",
            normalized?.permissions,
          );

          setUser(normalized);
        })
        .catch(expired)
        .finally(() => {
          setChecking(false);
        });
    }

    return () => {
      window.removeEventListener(
        "popstate",
        popState,
      );
      window.removeEventListener(
        "app:auth-expired",
        expired,
      );
    };
  }, []);

  const permissions = useMemo(
    () => normalizePermissions(user?.permissions),
    [user],
  );

  const allowedItems = useMemo(
    () => getNavigationItems(permissions),
    [permissions],
  );

  useEffect(() => {
    if (checking || !user) {
      return;
    }

    const route = routeForPath(path);

    const allowed =
      route &&
      permissions.includes(route.permission);

    if (allowed) {
      return;
    }

    const fallback = allowedItems[0]?.path;

    if (fallback) {
      window.history.replaceState(
        {},
        "",
        fallback,
      );
      setPath(fallback);
    }
  }, [
    allowedItems,
    checking,
    path,
    permissions,
    user,
  ]);

  const handleLogin = async (nextUser) => {
    let normalizedUser =
      normalizeUser(nextUser);

    try {
      const refreshedUser = await api("/me", {
        loadingMessage:
          "Loading your account…",
        silent: true,
        silentToast: true,
      });

      if (refreshedUser) {
        setRawMe(refreshedUser);
        normalizedUser =
          normalizeUser(refreshedUser);

        console.log(
          "LOGIN /me RESPONSE:",
          refreshedUser,
        );

        console.log(
          "LOGIN normalized permissions:",
          normalizedUser?.permissions,
        );
      }
    } catch {
      // Keep the successful login response.
    }

    setUser(normalizedUser);

    const nextPermissions =
      normalizePermissions(
        normalizedUser?.permissions,
      );

    const requestedPath = normalizePath(
      window.location.pathname,
    );

    const requestedRoute =
      routeForPath(requestedPath);

    const requestedAllowed =
      requestedRoute &&
      nextPermissions.includes(
        requestedRoute.permission,
      );

    const fallback =
      getNavigationItems(nextPermissions)[0]
        ?.path;

    const destination =
      requestedAllowed
        ? requestedPath
        : fallback;

    if (destination) {
      window.history.replaceState(
        {},
        "",
        destination,
      );
      setPath(destination);
    }
  };

  const navigate = (next) => {
    const [rawPath, search = ""] =
      String(next || "/").split("?");

    const target = normalizePath(rawPath);
    const route = routeForPath(target);

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
    setRawMe(null);
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

  const fallbackPath =
    allowedItems[0]?.path;

  const Component =
    route?.component ||
    (fallbackPath
      ? routes[fallbackPath]?.component
      : null);

  /*
   * Temporary diagnostic screen.
   *
   * This lets us see exactly what Android received
   * from /me if the permission list is still empty.
   */
  if (!Component) {
    return (
      <>
        <Loader />
        <Toast />

        <div className="auth-loading">
          <div
            className="card"
            style={{
              maxWidth: "900px",
              margin: "20px auto",
            }}
          >
            <h2>
              Navigation diagnostic
            </h2>

            <p>
              The application received the
              following user data:
            </p>

            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontSize: "12px",
                textAlign: "left",
                padding: "12px",
                borderRadius: "8px",
                background:
                  "rgba(127,127,127,0.12)",
              }}
            >
              {JSON.stringify(
                rawMe,
                null,
                2,
              )}
            </pre>

            <h3>
              Normalized permissions
            </h3>

            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontSize: "12px",
                textAlign: "left",
                padding: "12px",
                borderRadius: "8px",
                background:
                  "rgba(127,127,127,0.12)",
              }}
            >
              {JSON.stringify(
                permissions,
                null,
                2,
              )}
            </pre>

            <h3>
              Navigation items
            </h3>

            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontSize: "12px",
                textAlign: "left",
                padding: "12px",
                borderRadius: "8px",
                background:
                  "rgba(127,127,127,0.12)",
              }}
            >
              {JSON.stringify(
                allowedItems.map(
                  (item) => ({
                    path: item.path,
                    permission:
                      item.permission,
                  }),
                ),
                null,
                2,
              )}
            </pre>

            <button
              className="primary"
              type="button"
              onClick={() => {
                localStorage.removeItem(
                  "token",
                );
                setUser(null);
                setRawMe(null);
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
