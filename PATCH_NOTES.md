Scheduler Module Verification & Fixes (Updated for Vercel Serverless Lifecycle)

Changed:
- backend/scripts/scheduler.js
- backend/src/controllers/marketingController.js
- backend/src/db/index.js
- backend/src/server.js
- backend/src/services/dailyEmailReportPdfService.js
- backend/src/services/dailyEmailReportService.js
- backend/src/services/jobStatusService.js
- backend/src/services/mailService.js
- backend/src/services/monthlyEmailReportPdfService.js
- backend/src/services/monthlyEmailReportService.js
- backend/src/services/oneTimeReportEmailService.js
- backend/src/services/pdfWorkerPool.js
- backend/src/services/scheduledReportPdfService.js
- backend/src/services/scheduledReportScheduler.js
- backend/src/services/scheduledReportService.js
- backend/src/services/weeklyEmailReportPdfService.js
- backend/src/services/weeklyEmailReportService.js
- backend/src/services/yearlyEmailReportPdfService.js
- backend/src/services/yearlyEmailReportService.js
- backend/src/utils/dates.js
- frontend/src/pages/JobStatus.jsx

Summary of root causes fixed:
1. Vercel Serverless CPU freeze on un-awaited `void` jobs: On Vercel (`https://daily-expenses-8pbr.vercel.app`), calling `void processDueScheduledReportJobs()` / `void catchUpMissedEmailReports()` without `await` allowed only sub-300ms jobs (like `Daily planned recipe email` with 0 recipes, `285 ms`) to finish before `res.json(...)` returned. Jobs that generated a PDF and sent email (~2s) were frozen by Vercel mid-flight in `'running'` state, and then marked `'failed: Execution interrupted or timed out before completion'` 5 minutes later. `getJobStatus` now `await`s bounded job execution before returning the HTTP response, and `JobStatus.jsx` automatically chains 1.5s silent polls when `hasMoreDueJobs` is true until all due jobs finish as `'completed'`.
2. Cleanup of interrupted ghost rows: `reconcileStaleScheduledReportRuns()` now removes interrupted ghost records (`Execution interrupted or timed out before completion` or stale `'running'` > 25s) so today's due jobs immediately re-run to `'completed'` and superseded yesterday's (`2026-10-17`) ghost rows no longer show false red `'failed'` badges.
3. Fast execution within serverless limits: Cached S3 presigned URLs per unique `proof_key`, parallelized manager email delivery (`Promise.all`), and added per-request `AbortSignal.timeout` in `mailService.js`.
4. Fixed missing `notifyAdminFailure` import in `scheduledReportScheduler.js`, midnight `hour = "24"` bug (`hourCycle: "h23"`), `ON CONFLICT ... WHERE scheduled_key IS NOT NULL` in `scheduler.js`, `59 23 L * *` monthly cron normalization, `pg` `DATE` (`OID 1082`) type parsing, and PDF pivot table chunking.
