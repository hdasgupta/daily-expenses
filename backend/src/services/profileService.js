import bcrypt from "bcryptjs";
import { q } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { findUserWithPermissions } from "../models/userModel.js";
import { requiredText } from "../utils/validation.js";
import { validatePassword } from "../utils/password.js";
import { requestWhatsAppOtp, verifyWhatsAppOtp } from "./whatsappService.js";
import { normalizeWhatsAppNumber } from "../utils/whatsapp.js";

export async function updateProfile(userId, data) {
  const fullName = requiredText(data.fullName, "Full name");

  await q(userSql.updateProfileName, [fullName, userId]);

  if (data.whatsappNumber === "") {
    await q(userSql.clearWhatsApp, [userId]);
    await q(userSql.invalidateWhatsAppOtps, [userId]);
  }

  return findUserWithPermissions(userId);
}

export async function changePassword(userId, currentPassword, password, confirmPassword) {
  if (!currentPassword) throw new Error("Current password is required");

  const user = await findUserWithPermissions(userId);
  if (!user || !(await bcrypt.compare(String(currentPassword), user.password_hash))) {
    throw new Error("Current password is incorrect");
  }

  validatePassword(password, confirmPassword);

  const hash = await bcrypt.hash(password, 12);
  await q(userSql.updatePassword, [hash, userId]);

  return { ok: true };
}

export async function requestProfileWhatsAppOtp(userId, whatsappNumber) {
  const normalized = normalizeWhatsAppNumber(whatsappNumber);
  if (!normalized) throw new Error("WhatsApp number is required");
  return requestWhatsAppOtp(userId, normalized);
}

export async function verifyProfileWhatsAppOtp(userId, whatsappNumber, otp) {
  return verifyWhatsAppOtp(userId, whatsappNumber, otp);
}
