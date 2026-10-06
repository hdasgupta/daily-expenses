import { Capacitor } from "@capacitor/core";
import { registerPlugin } from "@capacitor/core";

const FileCache = registerPlugin("FileCache");

const RENDER_API_BASE_URL = "https://daily-expenses-g4ze.onrender.com/api";

function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function getBaseUrl() {
  const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();

  return (configuredBaseUrl || (isNativePlatform() ? RENDER_API_BASE_URL : "/api")).replace(
    /\/$/,
    "",
  );
}

function getClientTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      try {
        const result = String(reader.result || "");

        const commaIndex = result.indexOf(",");

        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(reader.error || new Error("Unable to read the downloaded file."));
    };

    reader.readAsDataURL(blob);
  });
}

function sanitizeFileName(value) {
  return String(value || "file")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extensionFromMimeType(mimeType) {
  const type = String(mimeType || "").toLowerCase();

  if (type.includes("pdf")) return "pdf";
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) {
    return "jpg";
  }
  if (type.includes("webp")) return "webp";

  return "";
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;

    const match = pathname.match(/\.([a-z0-9]+)$/i);

    return match?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}

function buildFileName(fileName, mimeType, url) {
  const safeName = sanitizeFileName(fileName || "expense-proof");

  if (safeName.includes(".")) {
    return safeName;
  }

  const extension = extensionFromMimeType(mimeType) || extensionFromUrl(url) || "pdf";

  return `${safeName}.${extension}`;
}

async function openNativeFile(blob, fileName) {
  const base64 = await blobToBase64(blob);

  await FileCache.cacheAndOpen({
    fileName,
    data: base64,
    mimeType: blob.type || "application/pdf",
  });
}

export async function openRemoteFile(url, fileName = "expense-proof") {
  if (!url) {
    throw new Error("Proof file URL is not available.");
  }

  /*
   * Android / Capacitor:
   *
   * Fetch the remote S3-compatible object,
   * write it into the application's Cache
   * directory, obtain a native content URI,
   * and hand it to Android's share/open sheet.
   */
  if (isNativePlatform()) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Unable to open proof (${response.status}).`);
    }

    const blob = await response.blob();

    const finalFileName = buildFileName(fileName, blob.type, url);

    await openNativeFile(blob, finalFileName);

    return;
  }

  /*
   * Browser:
   *
   * Keep normal browser behaviour.
   */
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function downloadPdf(path, body, loadingMessage = "Preparing PDF report…") {
  const token = localStorage.getItem("token");

  const headers = {
    "Content-Type": "application/json",
    "X-App-Timezone": getClientTimezone(),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  window.dispatchEvent(
    new CustomEvent("app:api:start", {
      detail: {
        message: loadingMessage,
      },
    }),
  );

  try {
    const response = await fetch(`${getBaseUrl()}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();

      let message = `Request failed (${response.status})`;

      try {
        message = JSON.parse(text)?.error || message;
      } catch {
        // Keep the default HTTP error.
      }

      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("app:auth-expired"));
      }

      throw new Error(message);
    }

    const blob = await response.blob();

    if (isNativePlatform()) {
      await openNativeFile(blob, "expense-report.pdf");

      window.dispatchEvent(
        new CustomEvent("app:toast", {
          detail: {
            type: "success",
            message: "Report PDF is ready to open.",
          },
        }),
      );

      return;
    }

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = "expense-report.pdf";

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    window.dispatchEvent(
      new CustomEvent("app:toast", {
        detail: {
          type: "success",
          message: "Report PDF downloaded.",
        },
      }),
    );
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent("app:toast", {
        detail: {
          type: "error",
          message: error?.message || "Unable to download the PDF.",
        },
      }),
    );

    throw error;
  } finally {
    window.dispatchEvent(new CustomEvent("app:api:end"));
  }
}
