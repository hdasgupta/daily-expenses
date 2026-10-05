import bcrypt from "bcryptjs";
import { q, withTransaction } from "../db/index.js";
import { userSql } from "../../scripts/sql/userSql.js";
import { findUserWithPermissions, listUsers } from "../models/userModel.js";
import { requiredText } from "../utils/validation.js";
import { validatePassword } from "../utils/password.js";
import { normalizeWhatsAppNumber } from "../utils/whatsapp.js";
import { requestWhatsAppOtp } from "./whatsappService.js";

export async function createUser(data) {
  const fullName = requiredText(data.fullName, "Full name");
  const email = requiredText(data.email, "Email").toLowerCase();
  const role = requiredText(data.role, "Role").toLowerCase();
  validatePassword(data.password, data.confirmPassword);
  const hash = await bcrypt.hash(data.password, 12);
  const result = await q(userSql.create, [fullName, email, hash, role]);
  if (!result.rows[0]) throw new Error("Invalid role");

  const userId = result.rows[0].id;
  const whatsappNumber = normalizeWhatsAppNumber(data.whatsappNumber);

  let whatsappOtpSent = false;
  if (whatsappNumber) {
    await q(userSql.setPendingWhatsApp, [whatsappNumber, userId]);
    await requestWhatsAppOtp(userId, whatsappNumber);
    whatsappOtpSent = true;
  }

  const user = await findUserWithPermissions(userId);
  return { ...user, whatsappOtpSent };
}
export async function updateUser(id, data) {
  const fullName = requiredText(data.fullName, "Full name");
  const email = requiredText(data.email, "Email").toLowerCase();
  const role = requiredText(data.role, "Role").toLowerCase();
  const whatsappNumber = normalizeWhatsAppNumber(data.whatsappNumber);
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

    if (data.whatsappNumber === "") {
      await client.query(userSql.clearWhatsApp, [id]);
      await client.query(userSql.invalidateWhatsAppOtps, [id]);
    } else if (whatsappNumber) {
      const currentResult = await client.query(
        "SELECT whatsapp_number, whatsapp_pending_number FROM public.users WHERE id=$1 FOR UPDATE",
        [id],
      );
      const current = currentResult.rows[0];

      if (current?.whatsapp_number !== whatsappNumber) {
        await client.query(userSql.setPendingWhatsApp, [whatsappNumber, id]);
        await client.query(userSql.invalidateWhatsAppOtps, [id]);
      }
    }

    if (data.password) {
      validatePassword(data.password, data.confirmPassword);
      const hash = await bcrypt.hash(data.password, 12);
      await client.query(userSql.updatePassword, [hash, id]);
    }
  });

  let whatsappOtpSent = false;
  if (whatsappNumber && data.whatsappNumber !== "") {
    const current = await findUserWithPermissions(id);
    if (current?.whatsapp_pending_number === whatsappNumber) {
      const verifiedAlready = current?.whatsapp_number === whatsappNumber && current?.whatsapp_verified_at;
      if (!verifiedAlready) {
        await requestWhatsAppOtp(id, whatsappNumber);
        whatsappOtpSent = true;
      }
    }
  }

  const user = await findUserWithPermissions(id);
  return { ...user, whatsappOtpSent };
}
export async function deleteUser(id) {
  await q(userSql.delete, [id]);
}
export async function getRoles() {
  const result = await q(userSql.roles);
  return result.rows;
}
export { listUsers };
