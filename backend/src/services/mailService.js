import { env } from "../config/env.js";

const EMAIL_API_URL = env.emailApiUrl;
const EMAIL_API_KEY = env.emailApiKey;

const EMAIL_API_MAX_RETRIES = 3;
const EMAIL_API_RETRY_DELAYS_MS = [2000, 5000, 10000];

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

function getRetryAfterMs(response, fallbackMs) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return fallbackMs;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60000);
  }

  const retryDate = Date.parse(retryAfter);
  if (!Number.isNaN(retryDate)) {
    return Math.min(Math.max(retryDate - Date.now(), 0), 60000);
  }

  return fallbackMs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function postEmail(payload, retryOptions = {}) {
  // Common scheduled reports use a long retry window. Other email types retain
  // the existing short retry policy.
  const isCommonScheduledReport = retryOptions.commonScheduledReport === true;
  const maxRetries = isCommonScheduledReport ? 10 : EMAIL_API_MAX_RETRIES;
  const retryDelayMs = isCommonScheduledReport ? 30 * 60 * 1000 : null;
  const recipient = payload.to;
  const subject = payload.subject;
  const attachmentCount = Array.isArray(payload.attachments) ? payload.attachments.length : 0;

  if (!EMAIL_API_URL) {
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

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const startedAt = Date.now();

    logEmailEvent("email_api_request_started", {
      recipient,
      subject,
      attachmentCount,
      url: EMAIL_API_URL,
      attempt,
      maxAttempts: maxRetries + 1,
    });

    try {
      const response = await fetch(EMAIL_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          apiKey: EMAIL_API_KEY,
        }),
      });

      const responseText = await response.text();

      if (response.ok) {
        logEmailEvent("email_api_request_succeeded", {
          recipient,
          subject,
          status: response.status,
          responseBody: responseText.slice(0, 500),
          durationMs: Date.now() - startedAt,
          attempt,
        });

        return;
      }

      const retryable = isCommonScheduledReport || isRetryableStatus(response.status);
      const hasRetriesRemaining = attempt <= maxRetries;

      logEmailEvent("email_api_request_failed", {
        recipient,
        subject,
        status: response.status,
        statusText: response.statusText,
        responseBody: responseText.slice(0, 1000),
        durationMs: Date.now() - startedAt,
        attempt,
        retryable,
        retriesRemaining: Math.max(maxRetries - attempt + 1, 0),
      });

      if (!retryable || !hasRetriesRemaining) {
        throw new Error(
          "Email API returned HTTP " +
            response.status +
            (responseText ? ": " + responseText.slice(0, 500) : ""),
        );
      }

      const fallbackDelay = isCommonScheduledReport
        ? retryDelayMs
        : EMAIL_API_RETRY_DELAYS_MS[Math.min(attempt - 1, EMAIL_API_RETRY_DELAYS_MS.length - 1)];

      const delayMs = isCommonScheduledReport
        ? retryDelayMs
        : getRetryAfterMs(response, fallbackDelay);

      logEmailEvent("email_api_retry_scheduled", {
        recipient,
        subject,
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        delayMs,
        status: response.status,
      });

      await sleep(delayMs);
    } catch (error) {
      const hasRetriesRemaining = attempt <= maxRetries;

      const retryableException = true;

      const isHttpError = String(error?.message || "").startsWith("Email API returned HTTP ");

      if (!isHttpError && hasRetriesRemaining) {
        const delayMs = isCommonScheduledReport
          ? retryDelayMs
          : EMAIL_API_RETRY_DELAYS_MS[Math.min(attempt - 1, EMAIL_API_RETRY_DELAYS_MS.length - 1)];

        logEmailEvent("email_api_request_exception", {
          recipient,
          subject,
          durationMs: Date.now() - startedAt,
          error: error?.message || String(error),
          errorCode: error?.code,
          attempt,
          retryable: retryableException,
          retriesRemaining: maxRetries - attempt + 1,
        });

        logEmailEvent("email_api_retry_scheduled", {
          recipient,
          subject,
          failedAttempt: attempt,
          nextAttempt: attempt + 1,
          delayMs,
          reason: "network_or_request_exception",
        });

        await sleep(delayMs);
        continue;
      }

      if (!isHttpError) {
        logEmailEvent("email_api_request_exception", {
          recipient,
          subject,
          durationMs: Date.now() - startedAt,
          error: error?.message || String(error),
          errorCode: error?.code,
          attempt,
          retryable: false,
          retriesRemaining: 0,
        });
      }

      throw error;
    }
  }
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
    attachments: [
      {
        filename,
        mimeType: "application/pdf",
        content: pdfBuffer.toString("base64"),
      },
    ],
  });
}

export async function sendDailyEmailReport(email, pdfBuffer, reportDate, options = {}) {
  const filename = "expense-7-day-report-" + reportDate + ".pdf";

  const text =
    "Attached is the 7-day expense report containing the daily expense chart and summary, survivor pivot chart and data, and the underlying expense details with share information and clickable proof links.";

  await postEmail(
    {
      to: email,
      subject:
        "Expense Report PDF Attached — Daily Expenses & Survivor Details — Last 7 Days — " +
        reportDate,
      htmlBody: "<p>" + text + "</p>",
      attachments: [
        {
          filename,
          mimeType: "application/pdf",
          content: pdfBuffer.toString("base64"),
        },
      ],
    },
    options,
  );
}

export async function sendWeeklyEmailReport(email, pdfBuffer, reportDate, options = {}) {
  const filename = "expense-4-week-report-" + reportDate + ".pdf";

  const text =
    "Attached is the 4-week expense report containing the weekly expense chart and summary, survivor pivot chart and data, and the underlying expense details with share information and clickable proof links.";

  await postEmail(
    {
      to: email,
      subject:
        "Expense Report PDF Attached — Weekly Expenses & Survivor Details — Last 4 Weeks — " +
        reportDate,
      htmlBody: "<p>" + text + "</p>",
      attachments: [
        {
          filename,
          mimeType: "application/pdf",
          content: pdfBuffer.toString("base64"),
        },
      ],
    },
    options,
  );
}

export async function sendYearlyEmailReport(email, pdfBuffer, reportDate, options = {}) {
  const filename = "expense-2-year-report-" + reportDate + ".pdf";

  const text =
    "Attached is the 2-year expense report containing the yearly expense chart and summary, survivor pivot chart and data, and the underlying expense details with share information and clickable proof links.";

  await postEmail(
    {
      to: email,
      subject:
        "Expense Report PDF Attached — Yearly Expenses & Survivor Details — Last 2 Years — " +
        reportDate,
      htmlBody: "<p>" + text + "</p>",
      attachments: [
        {
          filename,
          mimeType: "application/pdf",
          content: pdfBuffer.toString("base64"),
        },
      ],
    },
    options,
  );
}

export async function sendMonthlyEmailReport(email, pdfBuffer, reportDate, options = {}) {
  const filename = "expense-3-month-report-" + reportDate + ".pdf";

  const text =
    "Attached is the 3-month expense report containing the monthly expense chart and summary, survivor pivot chart and data, and the underlying expense details with share information and clickable proof links.";

  await postEmail(
    {
      to: email,
      subject:
        "Expense Report PDF Attached — Monthly Expenses & Survivor Details — Last 3 Months — " +
        reportDate,
      htmlBody: "<p>" + text + "</p>",
      attachments: [
        {
          filename,
          mimeType: "application/pdf",
          content: pdfBuffer.toString("base64"),
        },
      ],
    },
    options,
  );
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

  await postEmail({
    to: email,
    subject,
    htmlBody,
    attachments: [
      {
        filename,
        mimeType: "application/pdf",
        content: pdfBuffer.toString("base64"),
      },
    ],
  });
}
