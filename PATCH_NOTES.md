Scheduler Module Verification & Fixes

Changed:
- backend/scripts/scheduler.js
- backend/src/controllers/marketingController.js
- backend/src/db/index.js
- backend/src/server.js
- backend/src/services/dailyEmailReportPdfService.js
- backend/src/services/dailyEmailReportService.js
- backend/src/services/jobStatusService.js
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
1. Missing `notifyAdminFailure` import in `scheduledReportScheduler.js` threw `ReferenceError` inside the `catch` block before `finishExecution` could mark failed jobs as `'failed'`, leaving custom scheduled reports (`Daily Survivor vs Category Report`, `Daily Category`, etc.) stuck in `'running'` forever.
2. `Intl.DateTimeFormat("en-US", { hour12: false })` returned `hour = "24"` between `00:00` and `00:59` IST in `scheduledReportScheduler.js` and `scheduler.js`, causing `currentMinutes = 1440+` and triggering all daily scheduled reports prematurely at midnight.
3. Holding `pool.connect()` clients open across PDF generation and HTTP email retries while running due jobs concurrently starved the PostgreSQL connection pool (`DB_POOL_MAX`). Replaced with atomic SQL claims, sequential job execution, and no long-held pooled clients.
4. `markJobStarted` in `scheduler.js` omitted `WHERE scheduled_key IS NOT NULL` in `ON CONFLICT (job_name, scheduled_key)`, failing against the partial unique index `uq_scheduler_job_executions_period`.
5. `monthlyEmailReportCron` (`"59 23 L * *"`) failed `node-cron` validation (`L` is unsupported in `node-cron`); added `L -> 28-31` normalization for `node-cron` plus exact last-day-of-month `nextRunAt` calculation.
6. Added automatic reconciliation of stale `'running'` jobs across `scheduler_job_runs`, `scheduler_job_executions`, and `one_time_report_email_jobs`, plus retry cooldowns and `marketing-list-email` cron scheduling.
7. Configured `pg` DATE type parser (`OID 1082`) and `toIsoDateString` normalization so PostgreSQL `DATE` values are never corrupted by `String(dateObj).slice(0, 10)`, and fixed PDF layout/chunking in `scheduledReportPdfService.js`.
