import { Router } from "express";
import { notifyAdminFailure } from "../services/adminAlertService.js";
const router = Router();
function clean(v, n) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, n) : null;
}
router.post("/client-errors", async (req, res) => {
  const b = req.body || {};
  await notifyAdminFailure({
    category: clean(b.category, 100) || "frontend-runtime",
    failureTime: clean(b.failureTime, 80) || new Date().toISOString(),
    failureMessage: clean(b.failureMessage, 4000) || "Unknown client-side error",
    stack: clean(b.stack, 12000),
    path: clean(b.path, 1000),
    method: clean(b.method, 20),
    requestId: clean(b.requestId, 200),
    user:
      clean(b.userEmail, 320) || clean(b.userFullName, 200)
        ? { email: clean(b.userEmail, 320), fullName: clean(b.userFullName, 200) }
        : null,
  });
  res.status(202).json({ ok: true });
});
export default router;
