import { findUserWithPermissions } from "../models/userModel.js";
import { updateProfile, changePassword as changeProfilePassword, requestProfileWhatsAppOtp, verifyProfileWhatsAppOtp } from "../services/profileService.js";

export async function getProfile(req, res) {
  res.json(await findUserWithPermissions(req.user.id));
}

export async function update(req, res) {
  res.json(await updateProfile(req.user.id, req.body || {}));
}

export async function changePassword(req, res) {
  const { currentPassword, password, confirmPassword } = req.body || {};
  res.json(await changeProfilePassword(req.user.id, currentPassword, password, confirmPassword));
}

export async function requestWhatsAppOtp(req, res) {
  res.json(await requestProfileWhatsAppOtp(req.user.id, req.body?.whatsappNumber));
}

export async function verifyWhatsAppOtp(req, res) {
  res.json(
    await verifyProfileWhatsAppOtp(
      req.user.id,
      req.body?.whatsappNumber,
      req.body?.otp,
    ),
  );
}
