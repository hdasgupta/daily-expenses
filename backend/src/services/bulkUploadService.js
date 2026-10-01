import { withTransaction } from "../db/index.js";
import { parseCsv } from "../utils/csv.js";
import { normalizeForBulkExpense } from "./bulkUploadExpenseParser.js";
import { bulkUploadSql } from "../../scripts/sql/bulkUploadSql.js";
import { expenseSql } from "../../scripts/sql/expenseSql.js";
import { transactionSql } from "../../scripts/sql/schemaSql.js";
import { uploadRemoteProof } from "./proofService.js";

export async function importExpenses(buffer, userId) {
  const rows = parseCsv(buffer);
  if (!rows.length) throw new Error("CSV is empty");
  const header = rows[0].map((v) => String(v).trim().toLowerCase());
  const expected = [
    "date",
    "category",
    "item",
    "other_item",
    "quantity",
    "unit",
    "price",
    "total_cost",
    "expense_type",
    "shares",
    "comment",
    "added_by",
    "added_on",
    "proof_google_docs_id",
    "contract_download_url",
  ];
  for (const field of expected) {
    if (field === "total_cost") continue;
    if (!header.includes(field)) throw new Error(`CSV header must contain ${field}`);
  }
  const index = Object.fromEntries(header.map((name, pos) => [name, pos]));
  let imported = 0,
    skipped = 0;
  const errors = [];
  const warnings = [];
  const remoteProofs = [];
  await withTransaction(async (client) => {
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row.some((v) => String(v || "").trim())) continue;
      try {
        let normalizedRow = row.slice();
        if (
          header[0] === "date" &&
          normalizedRow.length >= 3 &&
          /^\d{4}$/.test(String(normalizedRow[0])) &&
          /^\d{1,2}$/.test(String(normalizedRow[1])) &&
          /^\d{1,2}$/.test(String(normalizedRow[2]))
        )
          normalizedRow = [
            `${normalizedRow[0]},${normalizedRow[1]},${normalizedRow[2]}`,
            ...normalizedRow.slice(3),
          ];
        const input = Object.fromEntries(
          expected.map((field) => [field, normalizedRow[index[field]] ?? ""]),
        );
        await client.query(transactionSql.savepoint);
        const data = await normalizeForBulkExpense(client, input, userId);
        const expense = await client.query(bulkUploadSql.insertExpense, [
          data.date,
          data.categoryId,
          data.itemId,
          data.otherItem,
          data.quantity,
          data.unitId,
          data.totalCost,
          data.expenseType,
          data.comment,
          userId,
          input.added_by || null,
          input.added_on || null,
        ]);
        for (const share of data.shares)
          await client.query(bulkUploadSql.insertShare, [
            expense.rows[0].id,
            share.survivorId,
            share.shareType,
            share.amount,
          ]);
        await client.query(expenseSql.setBulkSource, [
          input.proof_google_docs_id || null,
          input.contract_download_url || null,
          expense.rows[0].id,
        ]);
        const proofUrl =
          input.contract_download_url ||
          (input.proof_google_docs_id
            ? `https://docs.google.com/document/d/${encodeURIComponent(input.proof_google_docs_id)}/export?format=pdf`
            : "");
        if (proofUrl)
          remoteProofs.push({
            expenseId: expense.rows[0].id,
            url: proofUrl,
            rowNumber: rowIndex + 1,
          });
        if (data.skippedSurvivors.length)
          warnings.push(
            `Row ${rowIndex + 1}: unknown survivors skipped: ${data.skippedSurvivors.join(", ")}`,
          );
        imported += 1;
        await client.query(transactionSql.releaseSavepoint);
      } catch (error) {
        skipped += 1;
        errors.push(`Row ${rowIndex + 1}: ${error.message}`);
        await client.query(transactionSql.rollbackSavepoint);
        await client.query(transactionSql.releaseSavepoint);
      }
    }
  });
  for (const proof of remoteProofs) {
    try {
      await uploadRemoteProof(proof.expenseId, proof.url);
    } catch (error) {
      warnings.push(`Row ${proof.rowNumber}: proof URL not uploaded: ${error.message}`);
    }
  }
  return { imported, skipped, errors, warnings };
}

export async function importCategoriesItems(buffer) {
  const rows = parseCsv(buffer);
  if (!rows.length) throw new Error("CSV is empty");
  let categories = 0,
    items = 0;
  await withTransaction(async (client) => {
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    for (let column = 0; column < width; column += 1) {
      const categoryName = String(rows[0]?.[column] || "").trim();
      if (!categoryName) continue;
      const category = await client.query(bulkUploadSql.categoryUpsert, [categoryName]);
      categories += 1;
      const categoryId = category.rows[0].id;
      for (let row = 1; row < rows.length; row += 1) {
        const itemName = String(rows[row]?.[column] || "").trim();
        if (!itemName) continue;
        await client.query(bulkUploadSql.itemIgnore, [categoryId, itemName]);
        items += 1;
      }
    }
  });
  return { categories, items };
}
