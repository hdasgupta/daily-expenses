import { Router } from "express";
import multer from "multer";
import * as authController from "../controllers/authController.js";
import * as survivorController from "../controllers/survivorController.js";
import * as masterDataController from "../controllers/masterDataController.js";
import * as expenseController from "../controllers/expenseController.js";
import * as paginationController from "../controllers/paginationController.js";
import * as userController from "../controllers/userController.js";
import * as reportController from "../controllers/reportController.js";
import * as dashboardController from "../controllers/dashboardController.js";
import * as bulkUploadController from "../controllers/bulkUploadController.js";
import * as jobStatusController from "../controllers/jobStatusController.js";
import * as scheduledReportController from "../controllers/scheduledReportController.js";
import { auth, permit, indiaTimezoneOnly } from "../middleware/auth.js";
import { checkDbConnection } from "../db/index.js";

export function createRouter(maxUploadBytes) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes },
  });

  router.get("/health", (req, res) =>
    res.json({
      ok: true,
      status: "alive",
      uptimeSeconds: Math.round(process.uptime()),
      pid: process.pid,
    }),
  );

  router.get("/health/ready", async (req, res) => {
    const startedAt = Date.now();

    if (!req.app.locals.ready) {
      return res.status(503).json({
        ok: false,
        status: req.app.locals.starting ? "starting" : "unavailable",
        error: req.app.locals.startupError || "Backend is still starting",
        uptimeSeconds: Math.round(process.uptime()),
      });
    }

    const db = await checkDbConnection();
    if (!db.ok) {
      return res.status(503).json({
        ok: false,
        status: "database-unavailable",
        error: "Database is temporarily unavailable",
        dbDurationMs: db.durationMs,
        durationMs: Date.now() - startedAt,
      });
    }

    return res.json({
      ok: true,
      status: "ready",
      uptimeSeconds: Math.round(process.uptime()),
      dbDurationMs: db.durationMs,
      durationMs: Date.now() - startedAt,
    });
  });

  router.use(indiaTimezoneOnly);

  router.post("/auth/login", authController.loginController);
  router.post("/auth/request-reset", authController.requestResetController);
  router.post("/auth/reset-password", authController.resetPasswordController);
  router.get("/me", auth, authController.meController);

  router.get("/pagination/:module", auth, paginationController.get);
  router.put("/pagination/:module", auth, paginationController.save);

  router.get("/meta/categories", auth, masterDataController.metaCategories);
  router.get("/meta/units", auth, masterDataController.metaUnits);
  router.get("/meta/items/:categoryId", auth, masterDataController.metaItems);
  router.get("/meta/survivors", auth, survivorController.meta);
  router.get("/pincode/:pincode", auth, survivorController.pincode);

  router.get("/survivors", auth, permit("add-survivor"), survivorController.list);
  router.post("/survivors", auth, permit("add-survivor"), survivorController.create);
  router.put("/survivors/:id", auth, permit("add-survivor"), survivorController.update);
  router.delete("/survivors/:id", auth, permit("add-survivor"), survivorController.remove);

  router.get("/categories", auth, permit("add-item"), masterDataController.categories);
  router.post("/categories", auth, permit("add-item"), masterDataController.addCategory);
  router.put("/categories/:id", auth, permit("add-item"), masterDataController.updateCategory);
  router.delete("/categories/:id", auth, permit("add-item"), masterDataController.removeCategory);
  router.get("/items", auth, permit("add-item"), masterDataController.items);
  router.post("/items", auth, permit("add-item"), masterDataController.addItem);
  router.put("/items/:id", auth, permit("add-item"), masterDataController.updateItem);
  router.delete("/items/:id", auth, permit("add-item"), masterDataController.removeItem);
  router.get("/units", auth, permit("add-unit"), masterDataController.units);
  router.post("/units", auth, permit("add-unit"), masterDataController.addUnit);
  router.put("/units/:id", auth, permit("add-unit"), masterDataController.updateUnit);
  router.delete("/units/:id", auth, permit("add-unit"), masterDataController.removeUnit);

  router.get("/expenses", auth, permit("add-expense"), expenseController.list);
  router.post("/expenses", auth, permit("add-expense"), expenseController.create);
  router.put("/expenses/:id", auth, permit("add-expense"), expenseController.update);
  router.delete("/expenses/:id", auth, permit("add-expense"), expenseController.remove);
  router.post(
    "/expenses/:id/proof",
    auth,
    permit("add-expense"),
    upload.single("proof"),
    expenseController.uploadProof,
  );
  router.get("/expenses/:id/proof-url", auth, permit("add-expense"), expenseController.proofUrl);

  router.post(
    "/bulk-upload/expenses",
    auth,
    permit("bulk-upload-expenses"),
    upload.single("file"),
    bulkUploadController.expenses,
  );
  router.post(
    "/bulk-upload/categories-items",
    auth,
    permit("bulk-upload-categories-items"),
    upload.single("file"),
    bulkUploadController.categoriesItems,
  );

  router.post("/reports/query", auth, permit("report"), reportController.query);
  router.post("/reports/export-pdf", auth, permit("report"), reportController.exportPdf);
  router.post("/reports/email-pdf", auth, permit("report"), reportController.emailReport);
  router.post("/reports/schedule-email", auth, permit("report"), reportController.scheduleEmail);
  router.get("/report-selections", auth, permit("report"), reportController.selections);
  router.post("/report-selections", auth, permit("report"), reportController.save);
  router.delete("/report-selections/:id", auth, permit("report"), reportController.remove);

  router.get("/dashboard/overview", auth, permit("dashboard"), dashboardController.overview);
  router.post("/dashboard/query", auth, permit("dashboard"), dashboardController.queryReport);

  router.get("/job-status", auth, permit("job-status"), jobStatusController.status);
  router.get("/scheduled-reports", auth, permit("job-status"), scheduledReportController.list);
  router.post("/scheduled-reports", auth, permit("job-status"), scheduledReportController.create);
  router.put(
    "/scheduled-reports/:id",
    auth,
    permit("job-status"),
    scheduledReportController.update,
  );
  router.delete(
    "/scheduled-reports/:id",
    auth,
    permit("job-status"),
    scheduledReportController.remove,
  );

  router.get("/roles", auth, permit("add-user"), userController.roles);
  router.get("/users", auth, permit("add-user"), userController.list);
  router.post("/users", auth, permit("add-user"), userController.create);
  router.put("/users/:id", auth, permit("add-user"), userController.update);
  router.delete("/users/:id", auth, permit("add-user"), userController.remove);

  return router;
}
