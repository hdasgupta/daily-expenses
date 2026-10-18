import dotenv from "dotenv";

const nodeEnv = process.env.NODE_ENV || "local";
dotenv.config({ path: process.env.ENV_FILE || `.env.${nodeEnv}` });
dotenv.config();

function cleanEnvValue(value, fallback = "") {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim();
  return cleaned || fallback;
}

export const DEFAULT_EMAIL_API_URL =
  "https://script.google.com/macros/s/AKfycbwBFlwZ-xXgjGXg2_jlsek2tm4nkIHuPn9WsOl4HV1onANS3Z7PLGou76Hl-TURuDtE/exec";
export const DEFAULT_EMAIL_API_KEY = "MyEmailApi";

export function loadEnv() {
  const required = ["DATABASE_URL", "JWT_SECRET"];
  if (nodeEnv === "production") {
    for (const key of required)
      if (!process.env[key]) throw new Error(`${key} is required in production`);
  }
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT || 4000),
  databaseUrl: cleanEnvValue(process.env.DATABASE_URL),
  jwtSecret: cleanEnvValue(process.env.JWT_SECRET, "local-only-change-me"),
  jwtExpiresIn: cleanEnvValue(process.env.JWT_EXPIRES_IN, "30d"),
  corsOrigin: cleanEnvValue(process.env.CORS_ORIGIN),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
  s3Endpoint: cleanEnvValue(process.env.AWS_ENDPOINT_URL_S3 || process.env.S3_ENDPOINT),
  s3Region: cleanEnvValue(process.env.AWS_REGION || process.env.S3_REGION, "us-east-2"),
  s3Bucket: cleanEnvValue(process.env.AWS_S3_BUCKET || process.env.S3_BUCKET),
  s3AccessKeyId: cleanEnvValue(process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID),
  s3SecretAccessKey: cleanEnvValue(
    process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY,
  ),
  emailApiUrl: cleanEnvValue(process.env.EMAIL_API_URL, DEFAULT_EMAIL_API_URL),
  emailApiKey: cleanEnvValue(process.env.EMAIL_API_KEY, DEFAULT_EMAIL_API_KEY),
  adminEmail: cleanEnvValue(process.env.ADMIN_EMAIL, "himaghna.dasgupta@gmail.com"),
  adminPassword: cleanEnvValue(process.env.ADMIN_PASSWORD, "Executable@123"),
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
  exposeOtpInDev: String(process.env.OTP_EXPOSE_IN_DEV || "false").toLowerCase() === "true",

  // Common recurring report schedules are fixed here so stale deployment
  // environment values cannot keep the old 06:00 schedules active.
  dailyEmailReportCron: "59 23 * * *",
  dailyEmailReportTimezone: cleanEnvValue(
    process.env.DAILY_EMAIL_REPORT_TIMEZONE,
    "Asia/Kolkata",
  ),
  monthlyEmailReportCron: "59 23 L * *",
  monthlyEmailReportTimezone: cleanEnvValue(
    process.env.MONTHLY_EMAIL_REPORT_TIMEZONE,
    "Asia/Kolkata",
  ),
  weeklyEmailReportCron: "59 23 * * 6",
  weeklyEmailReportTimezone: cleanEnvValue(
    process.env.WEEKLY_EMAIL_REPORT_TIMEZONE,
    "Asia/Kolkata",
  ),
  yearlyEmailReportCron: "59 23 31 12 *",
  yearlyEmailReportTimezone: cleanEnvValue(
    process.env.YEARLY_EMAIL_REPORT_TIMEZONE,
    "Asia/Kolkata",
  ),

  marketingListCronSecret: cleanEnvValue(process.env.MARKETING_LIST_CRON_SECRET),
  marketingListEmailCron: "59 23 * * *",
  marketingListEmailTimezone: "Asia/Kolkata",
  dailyPlannedRecipeCron: "0 6 * * *",
  dailyPlannedRecipeTimezone: "Asia/Kolkata",
  appTimezone: cleanEnvValue(process.env.APP_TIMEZONE, "Asia/Kolkata"),
  organizationName: cleanEnvValue(process.env.ORGANIZATION_NAME, "Rehabilitation Center"),
  organizationLogoUrl: cleanEnvValue(process.env.ORGANIZATION_LOGO_URL),
};
