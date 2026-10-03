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
  // Always ensure the complete permission catalogue exists.
  for (const permission of permissions) {
    await q(bootstrapSql.insertPermission, [permission]);
  }

  // Always ensure all supported roles exist.
  for (const role of Object.keys(rolePermissions)) {
    await q(bootstrapSql.insertRole, [role]);
  }

  // Always repair/complete role-permission mappings.
  // This is intentionally run on every startup so databases created before
  // the permission system was introduced are brought up to date.
  for (const [role, codes] of Object.entries(rolePermissions)) {
    for (const code of codes) {
      await q(bootstrapSql.linkRolePermission, [role, code]);
    }
  }

  // Create the administrator only when the account does not already exist.
  // Existing users and their passwords/roles are preserved.
  const hash = await bcrypt.hash(env.adminPassword, 12);

  await q(bootstrapSql.seedAdmin, [
    env.adminEmail,
    hash,
  ]);
}
