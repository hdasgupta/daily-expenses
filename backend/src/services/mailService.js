import http from "node:http";
import https from "node:https";
import { env, DEFAULT_EMAIL_API_URL, DEFAULT_EMAIL_API_KEY } from "../config/env.js";

const isVercel = process.env.VERCEL === "1";
const EMAIL_API_MAX_RETRIES = isVercel ? 1 : 2;
const EMAIL_API_RETRY_DELAYS_MS = isVercel ? [800] : [1500, 4000];
const EMAIL_REQUEST_TIMEOUT_MS = isVercel ? 12000 : 20000;

function sanitizeUrl(rawUrl) {
  const cleaned = String(rawUrl ?? "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim();
  if (!cleaned) return "";
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // Fall through to empty string if invalid URL
  }
  return "";
}

function getCandidateEmailUrls() {
  const configured = sanitizeUrl(env.emailApiUrl);
  const fallback = sanitizeUrl(DEFAULT_EMAIL_API_URL);
  return [...new Set([configured, fallback].filter(Boolean))];
}

function logEmailEvent(event, details = {}) {
  console.log(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtmlTags(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNetworkError(error) {
  if (!error) return "Unknown network error";
  const base = error.message || String(error);
  const cause = error.cause;
  if (cause) {
    const causeMsg = cause.message || cause.code || String(cause);
    if (causeMsg && !base.includes(causeMsg)) {
      return `${base} (${causeMsg})`;
    }
  }
  if (error.code && !base.includes(error.code)) {
    return `${base} (${error.code})`;
  }
  return base;
}

function evaluateEmailApiResponse({ status, statusText, text }) {
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      errorReason: `HTTP ${status}${statusText ? ` ${statusText}` : ""}${
        text ? `: ${String(text).slice(0, 400)}` : ""
      }`,
    };
  }

  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { ok: true };
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed.ok === false ||
          parsed.success === false ||
          String(parsed.status || "").toLowerCase() === "error" ||
          String(parsed.result || "").toLowerCase() === "error" ||
          (typeof parsed.error === "string" && parsed.error.trim().length > 0))
      ) {
        return {
          ok: false,
          errorReason: String(
            parsed.error || parsed.message || parsed.reason || trimmed,
          ).slice(0, 500),
        };
      }
    } catch {
      // Non-JSON text body; continue inspection
    }
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("<!doctype html") || lower.startsWith("<html")) {
    if (
      lower.includes("accounts.google.com/servicelogin") ||
      lower.includes("sign in - google accounts")
    ) {
      return {
        ok: false,
        errorReason:
          "Google Apps Script Web App redirected to Google Sign-In. Ensure the deployment has 'Who has access: Anyone'.",
      };
    }

    const errorMatch = trimmed.match(
      /(Exception:[^<]+|ReferenceError:[^<]+|TypeError:[^<]+|SyntaxError:[^<]+|Script function not found:[^<]+|Authorization is required[^<]*|Limit exceeded:[^<]+)/i,
    );
    if (errorMatch) {
      return {
        ok: false,
        errorReason: `Google Apps Script error: ${errorMatch[1].trim()}`,
      };
    }
  }

  return { ok: true };
}

/**
 * Primary HTTP transport using standard fetch() WITHOUT passing an AbortSignal
 * (passing AbortSignal.timeout() on Vercel's instrumented fetch throws a cross-realm
 * TypeError: fetch failed). Uses Promise.race for timeout protection instead.
 */
async function sendEmailViaFetch(targetUrl, bodyString, timeoutMs = EMAIL_REQUEST_TIMEOUT_MS) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Email API fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const fetchPromise = (async () => {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
        },
        body: bodyString,
        redirect: "follow",
      });
      const text = await response.text();
      return {
        status: response.status,
        statusText: response.statusText || "",
        text,
      };
    })();

    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rawHttpRequest(
  urlString,
  { method = "GET", headers = {}, body = null, timeoutMs = EMAIL_REQUEST_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(new Error(`Invalid Email API URL: ${urlString}`));
      return;
    }

    const transport = parsedUrl.protocol === "https:" ? https : http;
    const bodyBuffer =
      body != null ? (Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8")) : null;

    const requestHeaders = {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (compatible; DailyExpensesScheduler/2.0)",
      ...headers,
    };

    if (bodyBuffer) {
      requestHeaders["Content-Length"] = String(bodyBuffer.length);
    }

    const req = transport.request(
      parsedUrl,
      {
        method,
        headers: requestHeaders,
        servername: parsedUrl.hostname,
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode || 0,
            statusText: res.statusMessage || "",
            headers: res.headers || {},
            text,
          });
        });
        res.on("error", reject);
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Email API request timed out after ${timeoutMs}ms`));
    });

    req.on("error", reject);

    if (bodyBuffer && bodyBuffer.length > 0) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

async function sendEmailViaNodeHttps(targetUrl, bodyString, timeoutMs = EMAIL_REQUEST_TIMEOUT_MS) {
  let currentUrl = targetUrl;
  let method = "POST";
  let body = bodyString;
  let headers = { "Content-Type": "application/json" };

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await rawHttpRequest(currentUrl, {
      method,
      headers,
      body,
      timeoutMs,
    });

    const { status, statusText, text } = response;
    const location = response.headers?.location;

    if ([301, 302, 303, 307, 308].includes(status) && location) {
      currentUrl = new URL(location, currentUrl).toString();
      if (status === 301 || status === 302 || status === 303) {
        method = "GET";
        body = null;
        headers = {};
      }
      continue;
    }

    return {
      status,
      statusText,
      text,
    };
  }

  throw new Error("Email API exceeded maximum redirects");
}

async function sendEmailHttpRequest(targetUrl, bodyString) {
  let rawResult;
  try {
    rawResult = await sendEmailViaFetch(targetUrl, bodyString, EMAIL_REQUEST_TIMEOUT_MS);
  } catch (fetchErr) {
    logEmailEvent("email_api_fetch_fallback_to_https", {
      url: targetUrl,
      fetchError: formatNetworkError(fetchErr),
    });
    rawResult = await sendEmailViaNodeHttps(targetUrl, bodyString, EMAIL_REQUEST_TIMEOUT_MS);
  }

  const evaluation = evaluateEmailApiResponse(rawResult);
  return {
    ok: evaluation.ok,
    status: rawResult.status,
    statusText: rawResult.statusText,
    text: rawResult.text,
    errorReason: evaluation.errorReason || null,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildPasswordOtpHtml(otp, ttlMinutes) {
  const organizationName = escapeHtml(env.organizationName || "Rehabilitation Center");

  const safeOtp = escapeHtml(otp);
  const safeTtl = escapeHtml(ttlMinutes);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password Reset OTP</title>
</head>
<body
  style="
    margin:0;
    padding:0;
    background:#f4f7fb;
    font-family:Arial,Helvetica,sans-serif;
    color:#1f2937;
  "
>
  <table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="background:#f4f7fb;padding:32px 12px;"
  >
    <tr>
      <td align="center">
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          style="
            max-width:560px;
            background:#ffffff;
            border-radius:14px;
            overflow:hidden;
            border:1px solid #e5e7eb;
            box-shadow:0 4px 18px rgba(15,23,42,0.08);
          "
        >
          <tr>
            <td
              style="
                background:#1f4b99;
                padding:28px 32px;
                text-align:center;
              "
            >
              <div
                style="
                  display:inline-block;
                  padding:8px 14px;
                  border:1px solid rgba(255,255,255,0.35);
                  border-radius:8px;
                  color:#ffffff;
                  font-size:13px;
                  font-weight:bold;
                  letter-spacing:0.5px;
                "
              >
                ${organizationName}
              </div>

              <h1
                style="
                  margin:18px 0 0;
                  color:#ffffff;
                  font-size:24px;
                  line-height:1.3;
                "
              >
                Password Reset
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <p
                style="
                  margin:0 0 16px;
                  font-size:16px;
                  line-height:1.6;
                "
              >
                We received a request to reset the password for your
                <strong>${organizationName}</strong> account.
              </p>

              <p
                style="
                  margin:0 0 24px;
                  font-size:15px;
                  line-height:1.6;
                  color:#4b5563;
                "
              >
                Use the one-time password below to continue with the
                password reset.
              </p>

              <div
                style="
                  margin:0 auto 24px;
                  padding:20px;
                  background:#f3f6fc;
                  border:1px solid #dbe4f3;
                  border-radius:12px;
                  text-align:center;
                "
              >
                <div
                  style="
                    margin-bottom:8px;
                    color:#6b7280;
                    font-size:12px;
                    font-weight:bold;
                    letter-spacing:1px;
                    text-transform:uppercase;
                  "
                >
                  Your OTP
                </div>

                <div
                  style="
                    color:#1f4b99;
                    font-size:32px;
                    font-weight:bold;
                    letter-spacing:8px;
                    line-height:1.2;
                  "
                >
                  ${safeOtp}
                </div>
              </div>

              <div
                style="
                  padding:14px 16px;
                  background:#fff8e8;
                  border-left:4px solid #e0a11a;
                  border-radius:6px;
                  color:#6b4f00;
                  font-size:14px;
                  line-height:1.5;
                "
              >
                This OTP will expire in
                <strong>${safeTtl} minutes</strong>.
              </div>

              <p
                style="
                  margin:24px 0 0;
                  color:#6b7280;
                  font-size:13px;
                  line-height:1.6;
                "
              >
                If you did not request a password reset, you can safely
                ignore this email. Do not share this OTP with anyone.
              </p>
            </td>
          </tr>

          <tr>
            <td
              style="
                padding:20px 32px;
                background:#f8fafc;
                border-top:1px solid #e5e7eb;
                text-align:center;
              "
            >
              <p
                style="
                  margin:0;
                  color:#9ca3af;
                  font-size:12px;
                  line-height:1.5;
                "
              >
                This is an automated email from ${organizationName}.
                Please do not reply to this message.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return undefined;
  return attachments.map((item) => {
    const filename = item.filename || item.name || "report.pdf";
    const mimeType = item.mimeType || item.contentType || "application/pdf";
    let content = item.content;
    if (Buffer.isBuffer(content)) {
      content = content.toString("base64");
    } else if (content instanceof Uint8Array) {
      content = Buffer.from(content).toString("base64");
    } else {
      content = String(content || "");
    }
    return {
      filename,
      name: filename,
      mimeType,
      contentType: mimeType,
      content,
    };
  });
}

export async function postEmail(payload) {
  const recipient = String(payload.to || "").trim();
  const subject = String(payload.subject || "").trim();
  const normalizedAttachments = normalizeAttachments(payload.attachments);
  const attachmentCount = Array.isArray(normalizedAttachments) ? normalizedAttachments.length : 0;
  const candidateUrls = getCandidateEmailUrls();

  if (!recipient) {
    throw new Error("Email recipient (to) is required");
  }

  if (!candidateUrls.length) {
    logEmailEvent("email_api_not_configured", {
      recipient,
      subject,
      attachmentCount,
    });

    if (env.nodeEnv !== "production") {
      console.log("[EMAIL API PREVIEW]", JSON.stringify(payload));
    }

    return;
  }

  const textBody =
    payload.textBody || stripHtmlTags(payload.htmlBody) || subject || "Attached expense report.";
  const htmlBody = payload.htmlBody || `<p>${escapeHtml(textBody)}</p>`;
  const apiKey = env.emailApiKey || DEFAULT_EMAIL_API_KEY;

  const bodyString = JSON.stringify({
    ...payload,
    to: recipient,
    subject,
    htmlBody,
    textBody,
    body: textBody,
    ...(normalizedAttachments ? { attachments: normalizedAttachments } : {}),
    apiKey,
  });

  let lastError = null;

  for (let urlIndex = 0; urlIndex < candidateUrls.length; urlIndex += 1) {
    const targetUrl = candidateUrls[urlIndex];

    for (let attempt = 1; attempt <= EMAIL_API_MAX_RETRIES + 1; attempt += 1) {
      const startedAt = Date.now();

      logEmailEvent("email_api_request_started", {
        recipient,
        subject,
        attachmentCount,
        url: targetUrl,
        attempt,
        maxAttempts: EMAIL_API_MAX_RETRIES + 1,
      });

      try {
        const response = await sendEmailHttpRequest(targetUrl, bodyString);

        if (response.ok) {
          logEmailEvent("email_api_request_succeeded", {
            recipient,
            subject,
            status: response.status,
            responseBody: String(response.text || "").slice(0, 500),
            durationMs: Date.now() - startedAt,
            attempt,
          });
          return;
        }

        const retryable = isRetryableStatus(response.status);
        const hasRetriesRemaining = attempt <= EMAIL_API_MAX_RETRIES;

        logEmailEvent("email_api_request_failed", {
          recipient,
          subject,
          status: response.status,
          statusText: response.statusText,
          errorReason: response.errorReason,
          responseBody: String(response.text || "").slice(0, 1000),
          durationMs: Date.now() - startedAt,
          attempt,
          retryable,
          retriesRemaining: Math.max(EMAIL_API_MAX_RETRIES - attempt + 1, 0),
        });

        lastError = new Error(
          response.errorReason ||
            "Email API returned HTTP " +
              response.status +
              (response.text ? ": " + String(response.text).slice(0, 500) : ""),
        );

        if (!retryable || !hasRetriesRemaining) {
          break;
        }

        const delayMs =
          EMAIL_API_RETRY_DELAYS_MS[Math.min(attempt - 1, EMAIL_API_RETRY_DELAYS_MS.length - 1)];
        await sleep(delayMs);
      } catch (error) {
        const formattedMsg = formatNetworkError(error);
        lastError = new Error(formattedMsg);
        const hasRetriesRemaining = attempt <= EMAIL_API_MAX_RETRIES;

        logEmailEvent("email_api_request_exception", {
          recipient,
          subject,
          durationMs: Date.now() - startedAt,
          error: formattedMsg,
          attempt,
          retryable: hasRetriesRemaining,
          retriesRemaining: Math.max(EMAIL_API_MAX_RETRIES - attempt + 1, 0),
        });

        if (hasRetriesRemaining) {
          const delayMs =
            EMAIL_API_RETRY_DELAYS_MS[Math.min(attempt - 1, EMAIL_API_RETRY_DELAYS_MS.length - 1)];
          await sleep(delayMs);
          continue;
        }
      }
    }
  }

  throw lastError || new Error("Email API request failed");
}

export async function sendPasswordOtp(email, otp, ttlMinutes) {
  const organizationName = env.organizationName || "Rehabilitation Center";

  const text =
    `Your ${organizationName} password reset OTP is ` +
    otp +
    `. It expires in ` +
    ttlMinutes +
    ` minutes.`;

  await postEmail({
    to: email,
    subject: organizationName + " — Password Reset OTP",
    htmlBody: buildPasswordOtpHtml(otp, ttlMinutes),
    textBody: text,
  });
}

export async function sendDashboardEmail(email, pdfBuffer, reportDate) {
  const filename = "expense-dashboard-" + reportDate + ".pdf";

  const text =
    "Attached is the rehabilitation center expense dashboard for " +
    reportDate +
    ". The PDF contains the dashboard expense overview, summary information, and visual report data.";

  await postEmail({
    to: email,
    subject: "Expense Dashboard PDF Attached — Expense Overview & Summary — " + reportDate,
    htmlBody: "<p>" + text + "</p>",
    textBody: text,
    attachments: [
      {
        filename,
        mimeType: "application/pdf",
        content: Buffer.from(pdfBuffer).toString("base64"),
      },
    ],
  });
}

export async function sendDailyEmailReport(email, pdfBuffer, reportDate) {
  const filename = "expense-7-day-report-" + reportDate + ".pdf";

  const text =
    "Attached is the 7-day expense report containing the daily expense chart and summary, survivor pivot chart and data, and the underlying expense details with share information and clickable proof links.";

  await postEmail({
    to: email,
    subject:
      "Expense Report PDF Attached — Daily Expenses & Survivor Details — Last 7 Days — " +
      reportDate,
    htmlBody: "<p>" + text + "</p>",
    textBody: text,
    attachments: [
      {
        filename,
        mimeType: "application/pdf",
        content: Buffer.from(pdfBuffer).toString("base64"),
      },
    ],
  });
}

export async function sendWeeklyEmailReport(email, pdfBuffer, reportDate) {
  const filename = "expense-4-week-report-" + reportDate + ".pdf";

  const text =
    "Attached is the 4-week expense report containing the weekly expense chart and summary, survivor pivot chart and data, and the underlying expense details with share information and clickable proof links.";

  await postEmail({
    to: email,
    subject:
      "Expense Report PDF Attached — Weekly Expenses & Survivor Details — Last 4 Weeks — " +
      reportDate,
    htmlBody: "<p>" + text + "</p>",
    textBody: text,
    attachments: [
      {
        filename,
        mimeType: "application/pdf",
        content: Buffer.from(pdfBuffer).toString("base64"),
      },
    ],
  });
}

export async function sendYearlyEmailReport(email, pdfBuffer, reportDate) {
  const filename = "expense-2-year-report-" + reportDate + ".pdf";

  const text =
    "Attached is the 2-year expense report containing the yearly expense chart and summary, survivor pivot chart and data, and the underlying expense details with share information and clickable proof links.";

  await postEmail({
    to: email,
    subject:
      "Expense Report PDF Attached — Yearly Expenses & Survivor Details — Last 2 Years — " +
      reportDate,
    htmlBody: "<p>" + text + "</p>",
    textBody: text,
    attachments: [
      {
        filename,
        mimeType: "application/pdf",
        content: Buffer.from(pdfBuffer).toString("base64"),
      },
    ],
  });
}

export async function sendMonthlyEmailReport(email, pdfBuffer, reportDate) {
  const filename = "expense-3-month-report-" + reportDate + ".pdf";

  const text =
    "Attached is the 3-month expense report containing the monthly expense chart and summary, survivor pivot chart and data, and the underlying expense details with share information and clickable proof links.";

  await postEmail({
    to: email,
    subject:
      "Expense Report PDF Attached — Monthly Expenses & Survivor Details — Last 3 Months — " +
      reportDate,
    htmlBody: "<p>" + text + "</p>",
    textBody: text,
    attachments: [
      {
        filename,
        mimeType: "application/pdf",
        content: Buffer.from(pdfBuffer).toString("base64"),
      },
    ],
  });
}

export async function sendReportEmail(email, pdfBuffer, options = {}) {
  const reportDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.appTimezone,
  }).format(new Date());

  const filename = "expense-report-" + reportDate + ".pdf";

  const subject =
    options.subject || "Expense Report PDF Attached — Expense Summary & Details — " + reportDate;

  const htmlBody =
    options.htmlBody ||
    "<p>Attached is your expense report PDF containing the scheduled expense summary and detailed expense information.</p>";

  const textBody =
    options.textBody ||
    stripHtmlTags(htmlBody) ||
    "Attached is your expense report PDF containing the scheduled expense summary and detailed expense information.";

  await postEmail({
    to: email,
    subject,
    htmlBody,
    textBody,
    attachments: [
      {
        filename,
        mimeType: "application/pdf",
        content: Buffer.from(pdfBuffer).toString("base64"),
      },
    ],
  });
}

export async function sendDailyPlannedRecipeEmail(email, planDate, sections) {
  const safe = (value) => escapeHtml(value ?? "—");
  const sectionHtml = sections.map((section, index) => {
    const content = section.recipes.length
      ? `<ul style="margin:12px 0 0;padding-left:22px">${section.recipes.map((recipe) => `<li style="padding:5px 0;color:#26364b"><strong>${safe(recipe.name)}</strong>${recipe.category ? ` <span style="color:#64748b">(${safe(recipe.category)})</span>` : ""}<div style="font-size:12px;color:#64748b;margin-top:3px">${safe(recipe.location)} · Serves ${safe(recipe.servings)}</div></li>`).join("")}</ul>`
      : `<div style="margin-top:12px;padding:12px 14px;border-radius:8px;background:#f8fafc;color:#64748b;font-style:italic">No planned recipe under this section.</div>`;
    return `<tr><td style="padding:0 0 14px"><div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden"><div style="background:${index % 2 === 0 ? "#eef4ff" : "#f0fdfa"};padding:13px 16px;color:#17345f;font-size:16px;font-weight:bold">${safe(section.meal)}</div><div style="padding:14px 16px">${content}</div></div></td></tr>`;
  }).join("");
  const htmlBody = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="padding:24px 10px"><div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden"><div style="padding:28px 30px;background:linear-gradient(135deg,#163b70,#287a78);color:#fff"><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.9">${safe(env.organizationName || "Daily Expenses")}</div><h1 style="margin:10px 0 5px;font-size:26px;line-height:1.25">Daily Planned Recipes</h1><div style="font-size:15px;opacity:.95">${safe(planDate)}</div></div><div style="padding:24px 22px"><p style="margin:0 0 20px;line-height:1.6;color:#475569">Here is the food chart planned for today, from breakfast through dinner.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${sectionHtml}</table><div style="margin-top:8px;padding-top:16px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;line-height:1.5">Automatically generated at 6:00 AM India Standard Time. If no recipes are planned for the day, no email is sent.</div></div></div></div></body></html>`;
  const textBody = [`Daily Planned Recipes — ${planDate}`, ...sections.map((section) => `${section.meal}:\n${section.recipes.length ? section.recipes.map((recipe) => `- ${recipe.name} (${recipe.location}; serves ${recipe.servings})`).join("\n") : "No planned recipe under this section."}`)].join("\n\n");
  await postEmail({
    to: email,
    subject: `Daily Planned Recipes — ${planDate}`,
    htmlBody,
    textBody,
  });
}

export async function sendMarketingListEmail(email, purchaseDate, items) {
  const safe = (value) => String(value ?? "—").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const rows = items.map((item) => `<tr><td style="padding:12px;border-bottom:1px solid #e5e7eb">${safe(item.category_name || "—")}</td><td style="padding:12px;border-bottom:1px solid #e5e7eb"><b>${safe(item.item_name)}</b></td><td style="padding:12px;border-bottom:1px solid #e5e7eb">${safe(item.quantity ?? "—")} ${safe(item.unit_name || "")}</td><td style="padding:12px;border-bottom:1px solid #e5e7eb">${safe(item.location_name || "—")}</td></tr>`).join("");
  const htmlBody = `<div style="font-family:Arial,sans-serif;background:#f3f6fb;padding:24px;color:#172033"><div style="max-width:760px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #dfe6f0"><div style="background:#1f4b99;color:white;padding:24px 28px"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85">${safe(env.organizationName || "Daily Expenses")}</div><h1 style="margin:10px 0 4px;font-size:26px">Tomorrow's Marketing List</h1><div>${safe(purchaseDate)}</div></div><div style="padding:24px"><p style="color:#475569">Items scheduled for purchase tomorrow are listed below.</p><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="background:#eef3fb;text-align:left"><th style="padding:12px">Category</th><th style="padding:12px">Item</th><th style="padding:12px">Quantity</th><th style="padding:12px">Location</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:22px;color:#64748b;font-size:12px">Automatically generated daily reminder. Please refer to the Marketing List in the application for updates.</p></div></div></div>`;
  await postEmail({to:email,subject:`Marketing List for ${purchaseDate}`,htmlBody,textBody:`Marketing List for ${purchaseDate}: ${items.length} item(s).`});
}
