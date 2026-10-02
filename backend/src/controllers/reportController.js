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

export async function exportPdf(req, res) {
  const report = await runReport(req.body || {});
  const pdf = await buildReportPdf(report, req.body || {});
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="expense-report.pdf"');
  res.send(pdf);
}

export async function emailReport(req, res) {
  const report = await runReport(req.body || {});
  if (!report.rows?.length) {
    return res.status(400).json({ error: "No report data to email." });
  }

  const pdf = await buildReportPdf(report, req.body || {});
  await sendReportEmail(req.user.email, pdf);

  res.json({ ok: true, email: req.user.email });
}
