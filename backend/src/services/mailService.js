import { env } from "../config/env.js";

const EMAIL_API_URL = env.emailApiUrl;
const EMAIL_API_KEY = env.emailApiKey;

async function postEmail(payload) {
  if (!EMAIL_API_URL) {
    if (env.nodeEnv !== "production") {
      console.log("[EMAIL API PREVIEW]", JSON.stringify(payload));
    }
    return;
  }

  const response = await fetch(EMAIL_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      apiKey: EMAIL_API_KEY,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      "Email API returned HTTP " +
        response.status +
        (responseText ? ": " + responseText.slice(0, 500) : ""),
    );
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
