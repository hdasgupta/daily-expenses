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
    return res.status(400).json({
      error: "Email, OTP, password and confirmed password are required",
    });
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
  });
}
