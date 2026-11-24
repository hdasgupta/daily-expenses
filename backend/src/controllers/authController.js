import { q } from "../db/index.js";
import { login, requestPasswordReset, resetPassword } from "../services/authService.js";

export async function loginController(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });
  res.json(await login(email, password));
}

export async function requestResetController(req, res) {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });
  res.json(await requestPasswordReset(email));
}

export async function resetPasswordController(req, res) {
  const { email, otp, password, confirmPassword } = req.body || {};
  if (!email || !otp || !password || !confirmPassword) {
    return res
      .status(400)
      .json({ error: "Email, OTP, password and confirmed password are required" });
  }
  res.json(await resetPassword(email, otp, password, confirmPassword));
}

export function meController(req, res) {
  res.json({
    id: req.user.id,
    fullName: req.user.full_name,
    email: req.user.email,
    role: req.user.role,
    permissions: req.user.permissions,
    lastOpenedPath: req.user.last_opened_path || null,
  });
}

export async function updateLastPageController(req, res) {
  const rawPath = String(req.body?.path || "").trim();
  if (!rawPath || !rawPath.startsWith("/") || rawPath === "/" || rawPath.length > 300) {
    return res.status(400).json({ error: "Valid authenticated path is required" });
  }
  await q(`UPDATE public.users SET last_opened_path = $1 WHERE id = $2`, [rawPath, req.user.id]);
  return res.json({ ok: true, lastOpenedPath: rawPath });
}
