import {
  deleteSelection,
  getShareableUsers,
  listSelections,
  runReport,
  saveSelection,
  shareSelection,
  unshareSelection,
} from "../services/reportService.js";
import { q } from "../db/index.js";
import { buildReportPdf } from "../services/reportPdfService.js";
import { sendReportEmail } from "../services/mailService.js";

export async function query(req, res) {
  res.json(await runReport(req.body || {}));
}
export async function selections(req, res) {
  res.json(await listSelections(req.user.id));
}
export async function save(req, res) {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Selection name is required" });
  res.status(201).json(await saveSelection(req.user.id, name, req.body?.config || {}));
}
export async function remove(req, res) {
  await deleteSelection(req.user.id, req.params.id);
  res.json({ ok: true });
}

export async function shareableUsers(req, res) {
  res.json(await getShareableUsers(req.user.id, req.params.id));
}

export async function share(req, res) {
  const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
  await shareSelection(req.user.id, req.params.id, userIds);
  res.json({ ok: true });
}

export async function unshare(req, res) {
  const removed = await unshareSelection(req.user.id, req.params.id);
  res.json({ ok: true, removed });
}

async function resolveCategoryItemFilterLabels(config) {
  const filters = config?.filters || {};
  const keys = Array.isArray(filters.categoryItems)
    ? [...new Set(filters.categoryItems.map(String))]
    : [];

  if (!keys.length) {
    return [];
  }

  const categoryIds = [
    ...new Set(
      keys
        .map((key) => String(key).split(":")[0])
        .filter((value) => /^\d+$/.test(value)),
    ),
  ];

  if (!categoryIds.length) {
    return keys;
  }

  const result = await q(
    `
      SELECT
        c.id AS category_id,
        c.name AS category,
        i.id AS item_id,
        i.name AS item
      FROM public.categories c
      LEFT JOIN public.items i
        ON i.category_id = c.id
      WHERE c.id = ANY($1::bigint[])
    `,
    [categoryIds],
  );

  const categories = new Map();
  const items = new Map();

  for (const row of result.rows || []) {
    const categoryId = String(row.category_id);
    categories.set(categoryId, row.category);

    if (row.item_id != null) {
      items.set(String(row.item_id), {
        categoryId,
        name: row.item,
      });
    }
  }

  return keys.map((key) => {
    const [categoryId, kind, itemId] = String(key).split(":");
    const categoryName = categories.get(String(categoryId)) || `Category ${categoryId}`;

    if (kind === "item") {
      const item = items.get(String(itemId));
      return `${categoryName} - ${item?.name || `Item ${itemId}`}`;
    }

    return `${categoryName} - ${kind === "other" ? "Other" : "Total"}`;
  });
}

/*
 * PDF/export data is deliberately richer than the on-screen summary.
 * Always fetch the underlying survivor-share detail rows so the PDF can
 * include the requested raw dump, share explanation and proof links even
 * when the visible report is an aggregate summary.
 */
async function buildPdfReport(config) {
  const report = await runReport(config);

  const rawConfig = {
    ...config,
    summarise: false,
    groupBy: ["survivor"],
    sortColumns: (Array.isArray(config.sortColumns) ? config.sortColumns : [])
      .filter((item) => ["date", "category", "item", "survivor"].includes(item?.column))
      .map((item) => ({
        column: item.column,
        direction: item.direction === "desc" ? "desc" : "asc",
      })),
  };

  const rawReport = await runReport(rawConfig);
  const categoryItemLabels = await resolveCategoryItemFilterLabels(config);
  const pdfConfig = {
    ...config,
    filters: {
      ...(config.filters || {}),
      categoryItemLabels,
    },
  };

  return {
    ...report,
    rawRows: rawReport.rows || [],
    rawColumns: rawReport.columns || [],
    pdfConfig,
  };
}

export async function exportPdf(req, res) {
  const config = req.body || {};
  const report = await buildPdfReport(config);
  const pdf = await buildReportPdf(report, report.pdfConfig || config);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="expense-report.pdf"');
  res.send(pdf);
}

export async function emailReport(req, res) {
  const config = req.body || {};
  const report = await buildPdfReport(config);

  if (!report.rows?.length && !report.rawRows?.length) {
    return res.status(400).json({ error: "No report data to email." });
  }

  const pdf = await buildReportPdf(report, report.pdfConfig || config);
  await sendReportEmail(req.user.email, pdf);
  res.json({ ok: true, email: req.user.email });
}
