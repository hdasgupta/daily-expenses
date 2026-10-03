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

async function postEmail(payload) {
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

  for (let attempt = 1; attempt <= EMAIL_API_MAX_RETRIES + 1; attempt += 1) {
    const startedAt = Date.now();

    logEmailEvent("email_api_request_started", {
      recipient,
      subject,
      attachmentCount,
      url: EMAIL_API_URL,
      attempt,
      maxAttempts: EMAIL_API_MAX_RETRIES + 1,
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

      const retryable = isRetryableStatus(response.status);
      const hasRetriesRemaining = attempt <= EMAIL_API_MAX_RETRIES;

      logEmailEvent("email_api_request_failed", {
        recipient,
        subject,
        status: response.status,
        statusText: response.statusText,
        responseBody: responseText.slice(0, 1000),
        durationMs: Date.now() - startedAt,
        attempt,
        retryable,
        retriesRemaining: Math.max(EMAIL_API_MAX_RETRIES - attempt + 1, 0),
      });

      if (!retryable || !hasRetriesRemaining) {
        throw new Error(
          "Email API returned HTTP " +
            response.status +
            (responseText ? ": " + responseText.slice(0, 500) : ""),
        );
      }

      const fallbackDelay =
        EMAIL_API_RETRY_DELAYS_MS[Math.min(attempt - 1, EMAIL_API_RETRY_DELAYS_MS.length - 1)];
      const delayMs = getRetryAfterMs(response, fallbackDelay);

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
      const hasRetriesRemaining = attempt <= EMAIL_API_MAX_RETRIES;
      const retryableException = true;
      const isHttpError = String(error?.message || "").startsWith("Email API returned HTTP ");

      if (!isHttpError && hasRetriesRemaining) {
        const delayMs =
          EMAIL_API_RETRY_DELAYS_MS[Math.min(attempt - 1, EMAIL_API_RETRY_DELAYS_MS.length - 1)];

        logEmailEvent("email_api_request_exception", {
          recipient,
          subject,
          durationMs: Date.now() - startedAt,
          error: error?.message || String(error),
          errorCode: error?.code,
          attempt,
          retryable: retryableException,
          retriesRemaining: EMAIL_API_MAX_RETRIES - attempt + 1,
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
  const text = "Your password reset OTP is " + otp + ". It expires in " + ttlMinutes + " minutes.";

  await postEmail({
    to: email,
    subject: "Rehabilitation Center Expense Tracker password reset OTP",
    htmlBody: "<p>" + text + "</p>",
  });
}

export async function sendDashboardEmail(email, pdfBuffer, reportDate) {
  const filename = "expense-dashboard-" + reportDate + ".pdf";
  const text = "Attached is the rehabilitation center expense dashboard for " + reportDate + ".";

  await postEmail({
    to: email,
    subject: "Expense dashboard - " + reportDate,
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

export async function sendDailyEmailReport(email, pdfBuffer, reportDate) {
  const filename = "expense-7-day-report-" + reportDate + ".pdf";
  const text =
    "Attached is the 7-day expense report containing the daily bar chart, daily summary, daily survivor summary, and expense data dump.";

  await postEmail({
    to: email,
    subject: "Expense 7-day report - " + reportDate,
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

export async function sendWeeklyEmailReport(email, pdfBuffer, reportDate) {
  const filename = "expense-4-week-report-" + reportDate + ".pdf";
  await postEmail({
    to: email,
    subject: "Expense 4-week report - " + reportDate,
    htmlBody: "<p>Attached is the 4-week expense report.</p>",
    attachments: [{
      filename,
      mimeType: "application/pdf",
      content: pdfBuffer.toString("base64"),
    }],
  });
}

export async function sendYearlyEmailReport(email, pdfBuffer, reportDate) {
  const filename = "expense-12-month-report-" + reportDate + ".pdf";
  await postEmail({
    to: email,
    subject: "Expense 12-month report - " + reportDate,
    htmlBody: "<p>Attached is the 12-month expense report.</p>",
    attachments: [{
      filename,
      mimeType: "application/pdf",
      content: pdfBuffer.toString("base64"),
    }],
  });
}

export async function sendMonthlyEmailReport(email, pdfBuffer, reportDate) {
  const filename = "expense-3-month-report-" + reportDate + ".pdf";
  const text = "Attached is the 3-month expense report containing the monthly bar chart, monthly summary, monthly survivor summary, and expense data dump.";

  await postEmail({
    to: email,
    subject: "Expense 3-month report - " + reportDate,
    htmlBody: "<p>" + text + "</p>",
    attachments: [{
      filename,
      mimeType: "application/pdf",
      content: pdfBuffer.toString("base64"),
    }],
  });
}

export async function sendReportEmail(email, pdfBuffer) {
  const reportDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.appTimezone,
  }).format(new Date());
  const filename = "expense-report-" + reportDate + ".pdf";
  await postEmail({
    to: email,
    subject: "Expense report - " + reportDate,
    htmlBody: "<p>Attached is your expense report.</p>",
    attachments: [
      {
        filename,
        mimeType: "application/pdf",
        content: pdfBuffer.toString("base64"),
      },
    ],
  });
}
