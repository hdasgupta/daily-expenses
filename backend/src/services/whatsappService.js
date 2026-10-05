import crypto from "crypto";
import bcrypt from "bcryptjs";
import { WaAPI } from "@waapiapp/sdk";
import { q } from "../db/index.js";
import { env } from "../config/env.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { normalizeWhatsAppNumber, whatsappChatId } from "../utils/whatsapp.js";

const OTP_PURPOSE = "whatsapp-verification";

function getClient() {
  if (!env.waapiToken) {
    throw new Error("WAAPI_TOKEN is not configured");
  }

  if (!env.waapiInstanceId) {
    throw new Error("WAAPI_INSTANCE_ID is not configured");
  }

  return new WaAPI({
    token: env.waapiToken,
    instanceId: env.waapiInstanceId,
  });
}

export async function sendWhatsAppMessage(phoneNumber, message) {
  const client = getClient();
  await client.sendMessage({
    chatId: whatsappChatId(phoneNumber),
    message,
  });
}

function createOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

export async function requestWhatsAppOtp(userId, phoneNumber) {
  const normalized = normalizeWhatsAppNumber(phoneNumber);
  if (!normalized) throw new Error("WhatsApp number is required");

  const existing = await q(userSql.findVerifiedWhatsAppOwner, [normalized, userId]);
  if (existing.rows[0]) {
    throw new Error("This WhatsApp number is already verified for another user");
  }

  const recent = await q(userSql.latestWhatsAppOtp, [userId]);
  if (recent.rows[0]) {
    const elapsed = Date.now() - new Date(recent.rows[0].created_at).getTime();
    if (elapsed < env.whatsappOtpResendCooldownSeconds * 1000) {
      throw new Error(
        `Please wait ${env.whatsappOtpResendCooldownSeconds} seconds before requesting another OTP`,
      );
    }
  }

  const otp = createOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + env.whatsappOtpTtlMinutes * 60 * 1000);

  await q(userSql.invalidateWhatsAppOtps, [userId]);
  await q(userSql.setPendingWhatsApp, [normalized, userId]);
  await q(userSql.createWhatsAppOtp, [
    userId,
    normalized,
    otpHash,
    expiresAt,
    OTP_PURPOSE,
  ]);

  await sendWhatsAppMessage(
    normalized,
    `Your Daily Expenses WhatsApp verification code is ${otp}. It expires in ${env.whatsappOtpTtlMinutes} minutes. Do not share this code.`,
  );

  return {
    ok: true,
    whatsappNumber: normalized,
    expiresInMinutes: env.whatsappOtpTtlMinutes,
  };
}

export async function verifyWhatsAppOtp(userId, phoneNumber, otp) {
  const normalized = normalizeWhatsAppNumber(phoneNumber);
  const code = String(otp || "").trim();

  if (!normalized || !/^\d{6}$/.test(code)) {
    throw new Error("A valid WhatsApp number and 6-digit OTP are required");
  }

  const result = await q(userSql.latestWhatsAppOtpForNumber, [userId, normalized, OTP_PURPOSE]);
  const record = result.rows[0];

  if (!record) throw new Error("Invalid or expired OTP");

  if (Number(record.attempts) >= env.whatsappOtpMaxAttempts) {
    throw new Error("Too many incorrect OTP attempts. Please request a new OTP");
  }

  const matches = await bcrypt.compare(code, record.otp_hash);

  if (!matches) {
    await q(userSql.incrementWhatsAppOtpAttempts, [record.id]);
    throw new Error("Invalid or expired OTP");
  }

  const resultOwner = await q(userSql.findVerifiedWhatsAppOwner, [normalized, userId]);
  if (resultOwner.rows[0]) {
    throw new Error("This WhatsApp number is already verified for another user");
  }

  await q(userSql.markWhatsAppOtpUsed, [record.id]);
  await q(userSql.setVerifiedWhatsApp, [normalized, userId]);

  return { ok: true, whatsappNumber: normalized, whatsappVerifiedAt: new Date().toISOString() };
}
