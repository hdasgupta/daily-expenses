import bcrypt from "bcryptjs";
import { q } from "../db/index.js";
import { env } from "../config/env.js";
import { bootstrapSql } from "../../scripts/sql/bootstrapSql.js";

const permissions = [
  "add-expense",
  "add-survivor",
  "add-item",
  "add-unit",
  "bulk-upload-expenses",
  "bulk-upload-categories-items",
  "report",
  "dashboard",
  "add-user",
  "job-status",
];
const rolePermissions = {
  admin: permissions,
  editor: ["add-expense"],
  manager: ["add-expense", "report", "dashboard", "job-status"],
};

export async function seedApplication() {
  for (const permission of permissions) await q(bootstrapSql.insertPermission, [permission]);
  for (const role of Object.keys(rolePermissions)) await q(bootstrapSql.insertRole, [role]);
  for (const [role, codes] of Object.entries(rolePermissions)) {
    for (const code of codes) await q(bootstrapSql.linkRolePermission, [role, code]);
  }
  const hash = await bcrypt.hash(env.adminPassword, 12);
  await q(bootstrapSql.seedAdmin, [env.adminEmail, hash]);
}
