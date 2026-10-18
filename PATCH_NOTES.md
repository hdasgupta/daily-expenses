Scheduler Module Verification & Fixes (Updated for Native HTTPS Email Transport & Vercel Serverless)

Changed:
- backend/scripts/scheduler.js
- backend/src/config/env.js
- backend/src/controllers/marketingController.js
- backend/src/db/index.js
- backend/src/server.js
- backend/src/services/adminAlertService.js
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
- backend/src/services/storageService.js
- backend/src/services/weeklyEmailReportPdfService.js
- backend/src/services/weeklyEmailReportService.js
- backend/src/services/yearlyEmailReportPdfService.js
- backend/src/services/yearlyEmailReportService.js
- backend/src/utils/dates.js
- frontend/src/pages/JobStatus.jsx

Summary of root causes fixed:
1. `fetch failed` in `mailService.js` and `adminAlertService.js`:
   - Node's `undici`-based `fetch()` throws `TypeError: fetch failed` when `AbortSignal.timeout(...)` crosses realm boundaries on Vercel serverless, when `process.env.EMAIL_API_URL` contains quotes/newlines/spaces, when reusing stale keep-alive sockets across serverless container freezes, or when following Google Apps Script's cross-origin `302` redirect (`script.google.com` -> `script.googleusercontent.com/macros/echo`) after `doPost(e)` sends the email.
   - Replaced `fetch()` in `mailService.js` and `adminAlertService.js` with a native `node:https` client (`agent: false` for fresh sockets, explicit `301`/`302`/`303`/`307`/`308` redirect handling for Google Apps Script `macros/echo`, URL sanitization in `env.js`, and automatic fallback to the canonical Google Apps Script URL).
   - Updated `scheduledReportScheduler.js`, `scheduler.js`, and `oneTimeReportEmailService.js` to immediately clear/retry any rows that previously failed with `fetch failed`.
2. Vercel Serverless CPU freeze on un-awaited `void` jobs: `getJobStatus` awaits bounded due-job execution before returning the HTTP response, and `JobStatus.jsx` chains 1.5s silent polls when `hasMoreDueJobs` is true until all due jobs complete.
3. Fixed missing `notifyAdminFailure` import in `scheduledReportScheduler.js`, midnight `hour = "24"` bug (`hourCycle: "h23"`), `ON CONFLICT ... WHERE scheduled_key IS NOT NULL` in `scheduler.js`, `59 23 L * *` monthly cron normalization, `pg` `DATE` (`OID 1082`) type parsing, and PDF pivot table chunking.
