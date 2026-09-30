import jwt from "jsonwebtoken";
import { q } from "./db.js";
export function signUser(user, permissions) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      permissions,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "30d" },
  );
}
export async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer "))
      return res.status(401).json({ error: "Authentication required" });
    req.user = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
export function permit(code) {
  return (req, res, next) => {
    if (req.user?.permissions?.includes(code)) return next();
    res.status(403).json({ error: "Permission denied" });
  };
}
export async function userWithPermissions(id) {
  const r = await q(
    `SELECT u.id,u.email,u.full_name,u.password_hash,u.is_disabled,r.name role,COALESCE(array_agg(p.code) FILTER(WHERE p.code IS NOT NULL),'{}') permissions FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE u.id=$1 GROUP BY u.id,r.name`,
    [id],
  );
  return r.rows[0];
}
