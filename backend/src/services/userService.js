import bcrypt from "bcryptjs";
import { q, withTransaction } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { findUserWithPermissions, listUsers } from "../models/userModel.js";
import { requiredText } from "../utils/validation.js";
import { validatePassword } from "../utils/password.js";

export async function createUser(data) {
  const fullName = requiredText(data.fullName, "Full name");
  const email = requiredText(data.email, "Email").toLowerCase();
  const role = requiredText(data.role, "Role").toLowerCase();
  validatePassword(data.password, data.confirmPassword);
  const hash = await bcrypt.hash(data.password, 12);
  const result = await q(userSql.create, [fullName, email, hash, role]);
  if (!result.rows[0]) throw new Error("Invalid role");
  return findUserWithPermissions(result.rows[0].id);
}
export async function updateUser(id, data) {
  const fullName = requiredText(data.fullName, "Full name");
  const email = requiredText(data.email, "Email").toLowerCase();
  const role = requiredText(data.role, "Role").toLowerCase();
  await withTransaction(async (client) => {
    const roleResult = await client.query(userSql.roleByName, [role]);
    if (!roleResult.rows[0]) throw new Error("Invalid role");
    await client.query(userSql.update, [
      fullName,
      email,
      roleResult.rows[0].id,
      Boolean(data.isDisabled),
      id,
    ]);
    if (data.password) {
      validatePassword(data.password, data.confirmPassword);
      const hash = await bcrypt.hash(data.password, 12);
      await client.query(userSql.updatePassword, [hash, id]);
    }
  });
  return findUserWithPermissions(id);
}
export async function deleteUser(id) {
  await q(userSql.delete, [id]);
}
export async function getRoles() {
  const result = await q(userSql.roles);
  return result.rows;
}
export { listUsers };
