import { q, withTransaction } from "../db/index.js";
import { reportModelSql } from "../../scripts/sql/reportModelSql.js";

export async function listSelections(userId) {
  const result = await q(reportModelSql.list, [userId]);
  return result.rows;
}
export async function saveSelection(userId, name, config) {
  const result = await q(reportModelSql.save, [userId, name, config]);
  return result.rows[0];
}
export async function deleteSelection(userId, id) {
  await q(reportModelSql.delete, [id, userId]);
}

export async function getShareableUsers(userId, selectionId) {
  const owner = await q(reportModelSql.selectionOwner, [selectionId]);

  if (!owner.rows[0]) {
    const error = new Error("Selection not found");
    error.statusCode = 404;
    throw error;
  }

  if (String(owner.rows[0].user_id) !== String(userId)) {
    const error = new Error("Only the selection owner can manage sharing");
    error.statusCode = 403;
    throw error;
  }

  const result = await q(reportModelSql.shareableUsers, [selectionId, userId]);
  return result.rows;
}

export async function shareSelection(userId, selectionId, userIds) {
  return withTransaction(async (client) => {
    const owner = await client.query(reportModelSql.selectionOwner, [selectionId]);

    if (!owner.rows[0]) {
      const error = new Error("Selection not found");
      error.statusCode = 404;
      throw error;
    }

    if (String(owner.rows[0].user_id) !== String(userId)) {
      const error = new Error("Only the selection owner can manage sharing");
      error.statusCode = 403;
      throw error;
    }

    const normalizedIds = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))];

    if (normalizedIds.length) {
      const valid = await client.query(reportModelSql.validateShareUsers, [
        normalizedIds,
        userId,
        selectionId,
      ]);
      if (valid.rows.length !== normalizedIds.length) {
        const error = new Error("One or more selected users are invalid or disabled");
        error.statusCode = 400;
        throw error;
      }
    }

    await client.query(reportModelSql.deleteShares, [selectionId]);

    for (const sharedUserId of normalizedIds) {
      await client.query(reportModelSql.insertShare, [selectionId, sharedUserId, userId]);
    }

    return normalizedIds.length;
  });
}

export async function unshareSelection(userId, selectionId) {
  const result = await q(reportModelSql.deleteOwnShare, [selectionId, userId]);
  return result.rowCount > 0;
}
