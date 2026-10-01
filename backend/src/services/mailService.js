import { env } from "../config/env.js";

async function postEmail(payload) {
  if (!env.emailApiUrl) {
    if (env.nodeEnv !== "production") console.log("[EMAIL API PREVIEW]", JSON.stringify(payload));
    return;
  }
  const headers = { "Content-Type": "application/json" };
  if (env.emailApiKey)
    headers[env.emailApiHeader] =
      env.emailApiHeader.toLowerCase() === "authorization"
        ? `Bearer ${env.emailApiKey}`
        : env.emailApiKey;
  const response = await fetch(env.emailApiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Email API returned HTTP ${response.status}`);
}
export async function sendPasswordOtp(email, otp, ttlMinutes) {
  await postEmail({
    type: "password-reset-otp",
    to: email,
    subject: "Rehabilitation Center Expense Tracker password reset OTP",
    text: `Your password reset OTP is ${otp}. It expires in ${ttlMinutes} minutes.`,
    otp,
    expiresInMinutes: ttlMinutes,
  });
}
export async function sendDashboardEmail(email, pdfBuffer, reportDate) {
  await postEmail({
    type: "dashboard-pdf",
    to: email,
    subject: `Expense dashboard - ${reportDate}`,
    text: `Attached is the rehabilitation center expense dashboard for ${reportDate}.`,
    filename: `expense-dashboard-${reportDate}.pdf`,
    contentBase64: pdfBuffer.toString("base64"),
    reportDate,
  });
}
