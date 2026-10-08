import dotenv from "dotenv";

const nodeEnv = process.env.NODE_ENV || "local";
dotenv.config({ path: process.env.ENV_FILE || `.env.${nodeEnv}` });
dotenv.config();

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
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "local-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "30d",
  corsOrigin: process.env.CORS_ORIGIN || "",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
  s3Endpoint: process.env.AWS_ENDPOINT_URL_S3 || process.env.S3_ENDPOINT || "",
  s3Region: process.env.AWS_REGION || process.env.S3_REGION || "us-east-2",
  s3Bucket: process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || "",
  s3AccessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "",
  s3SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "",
  emailApiUrl:
    process.env.EMAIL_API_URL ||
    "https://script.google.com/macros/s/AKfycbwBFlwZ-xXgjGXg2_jlsek2tm4nkIHuPn9WsOl4HV1onANS3Z7PLGou76Hl-TURuDtE/exec",
  emailApiKey: process.env.EMAIL_API_KEY || "MyEmailApi",
  adminEmail: process.env.ADMIN_EMAIL || "himaghna.dasgupta@gmail.com",
  adminPassword: process.env.ADMIN_PASSWORD || "Executable@123",
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
  exposeOtpInDev: String(process.env.OTP_EXPOSE_IN_DEV || "false").toLowerCase() === "true",

  // Common recurring report schedules are fixed here so stale deployment
  // environment values cannot keep the old 06:00 schedules active.
  dailyEmailReportCron: "59 23 * * *",
  dailyEmailReportTimezone: process.env.DAILY_EMAIL_REPORT_TIMEZONE || "Asia/Kolkata",
  monthlyEmailReportCron: "59 23 * * *",
  monthlyEmailReportTimezone: process.env.MONTHLY_EMAIL_REPORT_TIMEZONE || "Asia/Kolkata",
  weeklyEmailReportCron: "59 23 * * 6",
  weeklyEmailReportTimezone: process.env.WEEKLY_EMAIL_REPORT_TIMEZONE || "Asia/Kolkata",
  yearlyEmailReportCron: "59 23 31 12 *",
  yearlyEmailReportTimezone: process.env.YEARLY_EMAIL_REPORT_TIMEZONE || "Asia/Kolkata",

  appTimezone: process.env.APP_TIMEZONE || "Asia/Kolkata",
  organizationName: process.env.ORGANIZATION_NAME || "Rehabilitation Center",
  organizationLogoUrl: process.env.ORGANIZATION_LOGO_URL || "",
};
