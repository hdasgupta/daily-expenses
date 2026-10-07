import {
  createScheduledReportJob,
  deleteScheduledReportJob,
  listScheduledReportJobs,
  listScheduledReportRecipients,
  updateScheduledReportJob,
} from "../services/scheduledReportService.js";

export async function list(req, res) {
  res.json(
    await listScheduledReportJobs({
      userId: req.user.id,
      isAdmin: req.user.role === "admin",
    }),
  );
}

export async function recipients(req, res) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only administrators can list manager recipients." });
  }

  res.json(await listScheduledReportRecipients());
}

export async function create(req, res) {
  res.status(201).json(await createScheduledReportJob(req.body || {}, req.user));
}

export async function update(req, res) {
  res.json(await updateScheduledReportJob(Number(req.params.id), req.body || {}, req.user));
}

export async function remove(req, res) {
  await deleteScheduledReportJob(Number(req.params.id), req.user);
  res.status(204).send();
}
