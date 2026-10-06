import { getJobStatus } from "../services/jobStatusService.js";

export async function status(req, res) {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 10);
  const search = String(req.query.search || "");
  const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
  res.json(await getJobStatus({ page, pageSize, search, userId: req.user.id, isAdmin }));
}
