import bcrypt from "bcryptjs";
import crypto from "crypto";
import { q } from "../db/index.js";
import { authSql } from "../../scripts/sql/authSql.js";
import { signUser } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { findByEmail } from "../models/userModel.js";
import { validatePassword } from "../utils/password.js";
import { sendPasswordOtp } from "./mailService.js";

export async function login(email, password) {
  const user = await findByEmail(email);
  if (!user || user.is_disabled) throw new Error("Invalid credentials");
  if (!(await bcrypt.compare(password, user.password_hash))) throw new Error("Invalid credentials");
  return {
    token: signUser(user),
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
    },
  };
}
export async function requestPasswordReset(email) {
  const user = await findByEmail(email);
  const response = { ok: true };
  if (!user || user.is_disabled) return response;
  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + env.otpTtlMinutes * 60 * 1000);
  await q(authSql.invalidateOtps, [email]);
  await q(authSql.createOtp, [email, otpHash, expiresAt]);
  await sendPasswordOtp(email, otp, env.otpTtlMinutes);
  if (env.exposeOtpInDev && env.nodeEnv !== "production") response.otpPreview = otp;
  return response;
}
export async function resetPassword(email, otp, password, confirmPassword) {
  validatePassword(password, confirmPassword);
  const result = await q(authSql.latestOtp, [email]);
  const record = result.rows[0];
  if (!record || !(await bcrypt.compare(String(otp), record.otp_hash)))
    throw new Error("Invalid or expired OTP");
  const hash = await bcrypt.hash(password, 12);
  await q(authSql.updatePassword, [hash, email]);
  await q(authSql.useOtp, [record.id]);
  return { ok: true };
}
