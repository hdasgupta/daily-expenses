import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

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
      reject(reader.error || new Error("Unable to read the downloaded PDF."));
    };

    reader.readAsDataURL(blob);
  });
}

async function openNativePdf(blob) {
  const fileName = `expense-report-${Date.now()}.pdf`;

  const base64 = await blobToBase64(blob);

  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({
    path: fileName,
    directory: Directory.Cache,
  });

  await Share.share({
    title: "Expense Report PDF",
    text: "Expense report PDF",
    files: [uri],
    dialogTitle: "Open expense report",
  });

  /*
   * The file intentionally remains in Cache while Android
   * applications are using it. The operating system may
   * remove cache files automatically when storage is needed.
   */
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
      await openNativePdf(blob);

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

    /*
     * Browser behaviour remains unchanged:
     * download the PDF directly through the
     * browser's normal download mechanism.
     */
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
