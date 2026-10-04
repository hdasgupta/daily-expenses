import { env } from "../config/env.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stackText(value) {
  return String(value || "No stack trace was provided.");
}

export async function sendAdminFailureAlert(details = {}) {
  const recipient = env.adminEmail;

  if (!recipient) {
    console.error("Admin failure alert skipped: ADMIN_EMAIL is not configured");
    return;
  }

  if (!env.emailApiUrl) {
    console.error("Admin failure alert skipped: EMAIL_API_URL is not configured");
    return;
  }

  const category = details.category || "application-failure";
  const subject = `Daily Expenses — ${category} failure`;
  const failureTime = details.failureTime || new Date().toISOString();
  const failureMessage = details.failureMessage || "Unknown failure";
  const stack = stackText(details.stack);
  const user = details.user || {};

  const userSection =
    user.fullName || user.email
      ? `<p><strong>User:</strong> ${escapeHtml(user.fullName || "Unknown")}${
          user.email ? ` (${escapeHtml(user.email)})` : ""
        }</p>`
      : "<p><strong>User:</strong> Not authenticated / unavailable</p>";

  const schedulerSection = details.schedulerType
    ? `<p><strong>Scheduler type:</strong> ${escapeHtml(details.schedulerType)}</p>`
    : "";

  const customSchedulerSection = details.schedulerName
    ? `<p><strong>Scheduler name:</strong> ${escapeHtml(details.schedulerName)}</p>
       <p><strong>Created by:</strong> ${escapeHtml(details.schedulerOwnerName || "Unknown")}$
         {details.schedulerOwnerEmail ? ` (${escapeHtml(details.schedulerOwnerEmail)})` : ""}</p>
       <p><strong>Schedule:</strong> ${escapeHtml(details.schedulerSchedule || "Unknown")}</p>`
    : "";

  const requestSection = details.path
    ? `<p><strong>Request:</strong> ${escapeHtml(details.method || "")}
       ${escapeHtml(details.path)}</p>`
    : "";

  const htmlBody = `
    <h2>Daily Expenses failure alert</h2>
    <p><strong>Failure category:</strong> ${escapeHtml(category)}</p>
    ${schedulerSection}
    ${customSchedulerSection}
    ${userSection}
    ${requestSection}
    <p><strong>Failure time:</strong> ${escapeHtml(failureTime)}</p>
    <p><strong>Failure message:</strong> ${escapeHtml(failureMessage)}</p>
    <p><strong>Error stack trace:</strong></p>
    <pre style="white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(stack)}</pre>
  `.trim();

  const textBody = [
    "Daily Expenses failure alert",
    `Failure category: ${category}`,
    details.schedulerType ? `Scheduler type: ${details.schedulerType}` : null,
    details.schedulerName ? `Scheduler name: ${details.schedulerName}` : null,
    details.schedulerOwnerName ? `Created by: ${details.schedulerOwnerName}` : null,
    details.schedulerOwnerEmail ? `Creator email: ${details.schedulerOwnerEmail}` : null,
    details.schedulerSchedule ? `Schedule: ${details.schedulerSchedule}` : null,
    user.fullName ? `User full name: ${user.fullName}` : null,
    user.email ? `User email: ${user.email}` : null,
    details.method && details.path ? `Request: ${details.method} ${details.path}` : null,
    `Failure time: ${failureTime}`,
    `Failure message: ${failureMessage}`,
    "Error stack trace:",
    stack,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(env.emailApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: recipient,
      subject,
      htmlBody,
      textBody,
      apiKey: env.emailApiKey,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Admin failure alert email API returned HTTP ${response.status}${
        responseText ? `: ${responseText.slice(0, 500)}` : ""
      }`,
    );
  }
}

export async function notifyAdminFailure(details = {}) {
  try {
    await sendAdminFailureAlert(details);
  } catch (error) {
    console.error("Failed to send admin failure alert", {
      message: error?.message || String(error),
      stack: error?.stack,
    });
  }
}
