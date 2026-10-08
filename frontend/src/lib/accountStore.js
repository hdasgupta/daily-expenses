const ACCOUNTS_KEY = "daily-expenses:accounts";
const ACTIVE_ACCOUNT_KEY = "daily-expenses:active-account";

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeAccount(account) {
  if (!account || typeof account !== "object") {
    return null;
  }

  const id = String(account.id || account.email || "").trim().toLowerCase();
  const token = String(account.token || "").trim();

  if (!id || !token) {
    return null;
  }

  return {
    id,
    token,
    email: String(account.email || id).trim(),
    fullName: account.fullName || account.full_name || account.name || "",
    role: String(account.role || "").trim(),
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
  };
}

export function getAccounts() {
  try {
    const parsed = safeParse(localStorage.getItem(ACCOUNTS_KEY) || "[]", []);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeAccount).filter(Boolean);
  } catch {
    return [];
  }
}

function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getActiveAccountId() {
  try {
    return String(localStorage.getItem(ACTIVE_ACCOUNT_KEY) || "").trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

export function setActiveAccountId(id) {
  const normalizedId = String(id || "").trim().toLowerCase();

  if (normalizedId) {
    localStorage.setItem(ACTIVE_ACCOUNT_KEY, normalizedId);
  } else {
    localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  }
}

export function upsertAccount(user, token) {
  const normalizedToken = String(token || "").trim();
  const email = String(user?.email || user?.loginId || "").trim();
  const id = email.toLowerCase();

  if (!id || !normalizedToken) {
    return null;
  }

  const account = normalizeAccount({
    id,
    token: normalizedToken,
    email,
    fullName: user?.fullName || user?.full_name || user?.name || "",
    role: user?.role || "",
    permissions: user?.permissions || [],
  });

  if (!account) {
    return null;
  }

  const accounts = getAccounts().filter((item) => item.id !== account.id);
  accounts.push(account);
  saveAccounts(accounts);
  setActiveAccountId(account.id);

  return account;
}

export function updateAccount(user, token = null) {
  const email = String(user?.email || user?.loginId || "").trim();
  const id = email.toLowerCase();

  if (!id) {
    return null;
  }

  const existing = getAccounts().find((item) => item.id === id);
  const nextToken = String(token || existing?.token || "").trim();

  if (!nextToken) {
    return null;
  }

  const account = normalizeAccount({
    ...existing,
    id,
    token: nextToken,
    email,
    fullName: user?.fullName || user?.full_name || user?.name || existing?.fullName || "",
    role: user?.role || existing?.role || "",
    permissions: user?.permissions || existing?.permissions || [],
  });

  if (!account) {
    return null;
  }

  const accounts = getAccounts().filter((item) => item.id !== id);
  accounts.push(account);
  saveAccounts(accounts);

  return account;
}

export function removeAccount(id) {
  const normalizedId = String(id || "").trim().toLowerCase();
  const accounts = getAccounts().filter((item) => item.id !== normalizedId);

  saveAccounts(accounts);

  if (getActiveAccountId() === normalizedId) {
    const next = accounts[0]?.id || null;
    setActiveAccountId(next);
  }

  return accounts;
}

export function clearAccounts() {
  localStorage.removeItem(ACCOUNTS_KEY);
  localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
}

export function migrateLegacyTokenAccount(user, token) {
  if (getAccounts().length > 0) {
    return getAccounts();
  }

  if (!user || !token) {
    return [];
  }

  upsertAccount(user, token);
  return getAccounts();
}
