import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { findUserWithPermissions } from "../models/userModel.js";

export function signUser(user) {
  return jwt.sign({ id: user.id }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

export async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const decoded = jwt.verify(header.slice(7), env.jwtSecret);
    const user = await findUserWithPermissions(decoded.id);
    if (!user || user.is_disabled) {
      return res.status(401).json({ error: "Account is unavailable" });
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function permit(permission) {
  return (req, res, next) => {
    if (req.user?.permissions?.includes(permission)) return next();
    res.status(403).json({ error: "Permission denied" });
  };
}
