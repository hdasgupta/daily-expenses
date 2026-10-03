const NATIVE_VAULT_NAME = "DailyExpensesCredentialVault";

function getNativeVault() {
  if (typeof window === "undefined") {
    return null;
  }

  const vault = window[NATIVE_VAULT_NAME];

  if (!vault || typeof vault.getPassword !== "function") {
    return null;
  }

  return vault;
}

export function isCredentialVaultAvailable() {
  return Boolean(getNativeVault());
}

export function saveCredential(username, password) {
  const vault = getNativeVault();

  if (!vault || !username || !password) {
    return false;
  }

  try {
    vault.savePassword(String(username), String(password));
    return true;
  } catch {
    return false;
  }
}

export function getSavedCredential() {
  const vault = getNativeVault();

  if (!vault) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const callbackName =
      `__dailyExpensesCredentialCallback_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;

    let completed = false;

    const finish = (credential) => {
      if (completed) {
        return;
      }

      completed = true;

      try {
        delete window[callbackName];
      } catch {
        // Ignore cleanup errors.
      }

      resolve(credential || null);
    };

    window[callbackName] = (result) => {
      if (!result?.success || !result?.credential) {
        finish(null);
        return;
      }

      const username = String(result.credential.username || "");
      const password = String(result.credential.password || "");

      if (!username || !password) {
        finish(null);
        return;
      }

      finish({
        username,
        password,
      });
    };

    try {
      vault.getPassword(callbackName);
    } catch {
      finish(null);
      return;
    }

    window.setTimeout(() => {
      finish(null);
    }, 30000);
  });
}
