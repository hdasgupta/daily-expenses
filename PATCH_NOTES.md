# Scheduler Module Verification & Complete Fixes

## Root Causes Identified & Resolved

1. **Email Delivery Transport (`backend/src/services/mailService.js`)**
   - Restored standard `fetch(targetUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: bodyString, redirect: "follow" })` **without `AbortSignal.timeout(...)`** (using a `Promise.race` timer instead so Vercel's instrumented `fetch` never throws cross-realm `TypeError: fetch failed`), with automatic fallback to `node:https` (`servername: parsedUrl.hostname` for TLS SNI) if `fetch` throws a network error.
   - Added response-body inspection (`evaluateEmailApiResponse`) so JSON error payloads (`{"ok":false}`, `{"status":"error"}`) or Google Apps Script HTML error/sign-in pages are detected and retried rather than falsely marking jobs as `completed`.
   - Ensured `textBody` and `body` are always populated on every report PDF email (`sendReportEmail`, `sendDailyEmailReport`, `sendWeeklyEmailReport`, `sendMonthlyEmailReport`, `sendYearlyEmailReport`, `sendDashboardEmail`) and normalized PDF buffers with `Buffer.from(pdfBuffer).toString("base64")`.

2. **Re-Running Edited Schedules & Clearing False Prior Completions (`backend/src/services/scheduledReportScheduler.js`, `backend/src/services/scheduledReportService.js`)**
   - Added a one-time database migration (`reset_oct_2026_email_runs_v4` in `public.scheduler_migrations`) that resets the `2026-10-16` through `2026-10-19` runs once so today's scheduled emails immediately re-execute and deliver with the fixed email transport.
   - Updated `isAlreadyCompletedOrCoolingDown`, `claimExecution`, and `updateScheduledReportJob` so that whenever a user edits a scheduled report's delivery time (`job.updated_at > row.started_at`), the current period lock is cleared and the updated schedule executes at its newly configured time today.
   - Added missed previous-day catch-up (`resolveDueKeyForJob`) so daily custom scheduled reports created before today whose yesterday run was missed automatically catch up even before today's scheduled time arrives.

3. **Catching Up Missed `23:59` System Scheduled Emails (`backend/scripts/scheduler.js`, `backend/src/services/*EmailReportService.js`)**
   - Previously, `catchUpMissedEmailReports()` only checked `if (dailyHour === 23 && dailyMinute >= 59)` — a single 60-second window at `11:59 PM`. If no request hit the serverless backend at `23:59`, yesterday's `daily-email-report`, `marketing-list-email`, and Saturday's `weekly-email-report` were never executed or caught up the next day.
   - Updated `catchUpMissedEmailReports()` to check and catch up yesterday's `daily-email-report` (`yesterdayKey`), today's `marketing-list-email` (which was due at `23:59` yesterday), and the most recent past Saturday's `weekly-email-report` (`lastPastSaturdayDateKey`) at **any** hour of the day.
   - Changed manager recipient loops in `dailyEmailReportService.js`, `weeklyEmailReportService.js`, `monthlyEmailReportService.js`, and `yearlyEmailReportService.js` from `Promise.all(...)` to sequential `for...of` delivery so Google Apps Script is not hit with concurrent PDF uploads simultaneously.

4. **One-Time Report PDF Emails (`backend/src/services/oneTimeReportEmailService.js`)**
   - Allowed scheduling for the current minute (`timestamp >= Date.now() - 60_000`) since HTML `<input type="time">` has minute resolution, and immediately `await`ed execution if the scheduled time is already due.

5. **Global Background Scheduler Trigger Across All Pages (`backend/src/routes/index.js`, `backend/src/controllers/jobStatusController.js`, `backend/src/services/jobStatusService.js`, `backend/vercel.json`, `frontend/src/App.jsx`, `frontend/src/lib/api.js`, `frontend/src/pages/JobStatus.jsx`)**
   - Added `GET /api/scheduler/tick` and `POST /api/scheduler/tick` (`runSchedulerTick`) so due jobs are executed both via Vercel Cron (`backend/vercel.json` with `maxDuration: 60`) and via a silent 20-second background heartbeat in `frontend/src/App.jsx` while the user is on **any** page (`/report`, `/dashboard`, `/add-expense`, etc.).
   - Updated `frontend/src/lib/api.js` so `silent: true` requests do not trigger the full-screen `"Please wait…"` loader overlay, and updated `frontend/src/pages/JobStatus.jsx` to trigger a silent poll the instant any scheduled job's target timestamp arrives.
