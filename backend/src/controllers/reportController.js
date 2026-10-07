import {
  buildReportPdfData,
  deleteSelection,
  getShareableUsers,
  listSelections,
  runReport,
  saveSelection,
  shareSelection,
  unshareSelection,
} from "../services/reportService.js";
import { buildReportPdf } from "../services/reportPdfService.js";
import { sendReportEmail } from "../services/mailService.js";
import {
  removeOneTimeReportEmailJob,
  scheduleOneTimeReportEmail,
} from "../services/oneTimeReportEmailService.js";

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
  await shareSelection(req.user.id, req.params.id, req.body?.userIds || []);
  res.json({ ok: true });
}

export async function unshareMe(req, res) {
  await unshareSelection(req.user.id, req.params.id);
  res.json({ ok: true });
}

async function buildPdfReport(config) {
  return buildReportPdfData(config);
}

export async function exportPdf(req, res) {
  const config = req.body || {};
  const report = await buildPdfReport(config);
  const pdf = await buildReportPdf(report, report.pdfConfig || config);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="expense-report.pdf"');
  res.send(pdf);
}

export async function scheduleEmail(req, res) {
  const job = await scheduleOneTimeReportEmail({
    config: req.body?.config || {},
    scheduledFor: req.body?.scheduledFor,
    name: req.body?.name,
    user: req.user,
    ownerUserId: req.body?.ownerUserId,
  });

  res.status(201).json(job);
}

export async function removeScheduledEmail(req, res) {
  await removeOneTimeReportEmailJob({
    id: req.params.id,
    userId: req.user.id,
    isAdmin: req.user.role === "admin",
  });

  res.json({ ok: true });
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
