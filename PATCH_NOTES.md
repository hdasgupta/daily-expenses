# Complete Project Updates (Scheduler Fixes & Recipe Master Expansion)

## 1. Recipe Master Catalogue Expansion (`backend/src/data/recipes.json`, `backend/src/data/expandedStarterRecipes.js`)
- Merged all **67** recipes from `backend/src/data/expandedStarterRecipes.js` that were previously missing from `backend/src/data/recipes.json` (10 Starters, 1 Boiled Egg, 14 Omelettes, 22 Sandwiches, 8 Bread/Toast items, and 12 Vegetable Bhartas).
- Added **26** additional Indian and Bengali Vegetable Bharta recipes (including *Patol Bharta (Pointed Gourd / Parwal Mash), Aloo Chokha, Ucche Aloo Bharta, Potol Khosa Bharta, Lau Khosa Bharta, Kacha Tomato Bharta, Bhindi Bharta, Dherosh Shorshe Bharta, Kacha Kola Bharta, Kanchkola Khosa Bharta, Pepe Bharta, Jhinge Bharta, Dhundul Bharta, Chichinda Bharta, Tinda Bharta, Kundru Bharta, Gobi Bharta, Bandhakopi Bharta, Borboti Bharta, Matar Bharta, Ol Bharta, Kochur Mukhi Bharta, Gajor Bharta, Beetroot Bharta, Sajne Data Bharta,* and *Echorer Bharta*).
- Preserved all **920** original recipe IDs (`static-0001`–`static-0920`) and assigned sequential IDs (`static-0921`–`static-1013`) to the **93** newly added recipes (**1,013** total recipes, sorted alphabetically by name).

## 2. Scheduler Module & Email Delivery Fixes
1. **Email Transport & Response Verification (`backend/src/services/mailService.js`)**
   - Uses standard `fetch()` **without `AbortSignal.timeout()`** (using a `Promise.race` timeout instead so Vercel's instrumented `fetch` never throws cross-realm `TypeError: fetch failed`), with automatic fallback to `node:https` (including TLS SNI `servername`) if `fetch` throws a network error.
   - Inspects the response body (`evaluateEmailApiResponse`) so Google Apps Script JSON error payloads or HTML error/sign-in pages are surfaced and retried instead of falsely marking runs as `completed`.
   - Populates `textBody`, `body`, and normalized base64 PDF `attachments` across all report email helpers.
2. **Re-Running Edited Schedules & Clearing Prior Runs (`backend/src/services/scheduledReportScheduler.js`, `backend/src/services/scheduledReportService.js`)**
   - Added one-time database migration `reset_oct_2026_email_runs_v4` (`public.scheduler_migrations`) and updated `isAlreadyCompletedOrCoolingDown`, `claimExecution`, and `updateScheduledReportJob` so editing a scheduled report (`job.updated_at > row.started_at`) clears the current period lock and runs at the newly configured time.
   - Added missed previous-day catch-up (`resolveDueKeyForJob`) for daily custom scheduled reports.
3. **Catching Up Missed `23:59` System Reports (`backend/scripts/scheduler.js`, `backend/src/services/*EmailReportService.js`)**
   - Updated `catchUpMissedEmailReports()` to catch up yesterday's missed `daily-email-report`, today's `marketing-list-email`, and the most recent past Saturday's `weekly-email-report` at any hour of the day, and switched recipient loops from `Promise.all` to sequential `for...of` to prevent Google Apps Script concurrency throttling.
4. **One-Time Report PDF Emails (`backend/src/services/oneTimeReportEmailService.js`)**
   - Allowed current-minute scheduling (`timestamp >= Date.now() - 60_000`) and immediately `await`ed execution when due.
5. **Triggering Across All Pages & Vercel Cron (`backend/src/routes/index.js`, `backend/src/controllers/jobStatusController.js`, `backend/src/services/jobStatusService.js`, `backend/vercel.json`, `frontend/src/App.jsx`, `frontend/src/lib/api.js`, `frontend/src/pages/JobStatus.jsx`)**
   - Added `GET`/`POST /api/scheduler/tick` (`runSchedulerTick`), `backend/vercel.json` (`maxDuration: 60` + cron), truly silent background requests in `frontend/src/lib/api.js`, a 20-second silent background heartbeat in `frontend/src/App.jsx` across all authenticated pages, and an exact due-timestamp trigger in `JobStatus.jsx`.
