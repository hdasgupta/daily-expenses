import { withTransaction } from "../db/index.js";
import { parseCsv } from "../utils/csv.js";
import { normalizeForBulkExpense } from "./bulkUploadExpenseParser.js";
import { bulkUploadSql } from "../../scripts/sql/bulkUploadSql.js";
import { expenseSql } from "../../scripts/sql/expenseSql.js";
import { transactionSql } from "../../scripts/sql/schemaSql.js";
import { uploadRemoteProof } from "./proofService.js";
import { buildBulkProofUrls } from "../utils/googleDrive.js";
import { normalizeBulkExpenseRow } from "../utils/bulkCsv.js";

export async function importExpenses(buffer, userId) {
  const rows = parseCsv(buffer);
  if (!rows.length) throw new Error("CSV is empty");
  const header = rows[0].map((v) => String(v).trim().toLowerCase());
  const required = [
    "date",
    "category",
    "item",
    "quantity",
    "unit",
    "price",
    "expense_type",
    "shares",
    "comment",
    "added_by",
    "added_on",
  ];
  for (const field of required) {
    if (!header.includes(field)) throw new Error(`CSV header must contain ${field}`);
  }
  const expected = [
    ...required,
    "total_cost",
    "other_item",
    "proof_google_docs_id",
    "contract_download_url",
  ];
  const aliases = {
    proof_google_docs_id: [
      "proof_google_docs_id",
      "google_drive_image_document_id",
      "google_drive_document_id",
      "google_docs_id",
      "document_id",
    ],
    contract_download_url: [
      "contract_download_url",
      "proof_download_url",
      "google_drive_download_url",
    ],
  };
  const index = {};
  for (const field of expected) {
    const candidates = aliases[field] || [field];
    index[field] = candidates.map((name) => header.indexOf(name)).find((pos) => pos >= 0) ?? -1;
  }
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
        const normalizedRow = normalizeBulkExpenseRow(row, header);
        const input = Object.fromEntries(
          expected.map((field) => [
            field,
            index[field] >= 0 ? (normalizedRow[index[field]] ?? "") : "",
          ]),
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
        const proofUrls = buildBulkProofUrls({
          googleDocsId: input.proof_google_docs_id,
          contractUrl: input.contract_download_url,
        });
        if (proofUrls.length)
          remoteProofs.push({
            expenseId: expense.rows[0].id,
            urls: proofUrls,
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
    let uploaded = false;
    let lastError = null;
    for (const url of proof.urls) {
      try {
        await uploadRemoteProof(proof.expenseId, url);
        uploaded = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!uploaded)
      warnings.push(
        `Row ${proof.rowNumber}: proof URL not uploaded: ${lastError?.message || "download failed"}`,
      );
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
