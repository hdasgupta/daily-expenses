import {
  deleteSelection,
  listSelections,
  runReport,
  saveSelection,
} from "../services/reportService.js";
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

  return {
    ...report,
    rawRows: rawReport.rows || [],
    rawColumns: rawReport.columns || [],
  };
}

export async function exportPdf(req, res) {
  const config = req.body || {};
  const report = await buildPdfReport(config);
  const pdf = await buildReportPdf(report, config);
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

  const pdf = await buildReportPdf(report, config);
  await sendReportEmail(req.user.email, pdf);
  res.json({ ok: true, email: req.user.email });
}
