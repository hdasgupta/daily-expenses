# Complete Project Updates (GPS & Frequency Location Auto-Mapping, Recipe Master Expansion, & Scheduler Fixes)

## 1. Automatic GPS & Selection-Frequency Location Mapping
- **Database Schema (`backend/scripts/sql/schemaSql.js`, `backend/src/controllers/marketingController.js`)**:
  - Added `latitude DOUBLE PRECISION` and `longitude DOUBLE PRECISION` to `public.marketing_locations` and created `public.marketing_location_gps_logs` (auto-migrated at runtime via `ensureLocationGpsSchema()`).
- **Backend Location Scoring & GPS Learning (`backend/src/controllers/marketingController.js`, `backend/src/controllers/dietChartController.js`, `backend/src/routes/index.js`)**:
  - `GET /api/marketing-locations?lat=...&lng=...` computes total selection frequency (`usage_count` across `marketing_items`, `food_chart_entries`, and `marketing_location_gps_logs`), per-user selection count (`user_usage_count`), nearby GPS selection frequency within 1.5 km (`nearby_usage_count`), Haversine distance (`distance_km`), `is_nearest`, `is_most_frequent`, and `auto_recommended`.
  - Automatically learns rolling centroid GPS coordinates for locations from `marketing_location_gps_logs` whenever users select or save items at a location with GPS active, and supports explicit coordinate pinning via `POST /api/marketing-locations/track-selection` (`pinLocationCoordinates: true`) or when adding/editing a location.
  - `dietChartController.js` (`listFoodChart`, `addFoodChartEntry`) persists `location_id` on `public.food_chart_entries` and logs GPS coordinates when planning meals.
- **Frontend Automatic Location Tracker & UI (`frontend/src/lib/locationTracker.js`, `frontend/src/pages/MarketingLocations.jsx`, `frontend/src/pages/MarketingList.jsx`, `frontend/src/pages/FoodChart.jsx`, `frontend/src/pages/RecipeMaster.jsx`, `frontend/src/pages/marketing.css`, `frontend/src/pages/dietChart.css`, `frontend/android/app/src/main/AndroidManifest.xml`)**:
  - Automatically pre-selects the highest-scoring location on **Marketing List**, **Food Chart**, and the **Add Ingredient to Marketing List** modals in **Food Chart** and **Recipe Master** using current GPS coordinates + nearby/overall selection frequency.
  - Added **Use current GPS** and **Pin GPS** controls plus `Auto-mapped`, `Nearest (X km)`, and `Most frequent (Xx)` badges on **Add Location** (`MarketingLocations.jsx`), and **Auto GPS** buttons across **Marketing List** and **Food Chart**.
  - Added `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` permissions to `frontend/android/app/src/main/AndroidManifest.xml` for Capacitor Android builds.

## 2. Recipe Master Catalogue Expansion (`backend/src/data/recipes.json`, `backend/src/data/expandedStarterRecipes.js`)
- Merged all **67** recipes from `backend/src/data/expandedStarterRecipes.js` that were previously missing from `backend/src/data/recipes.json` (10 Starters, 1 Boiled Egg, 14 Omelettes, 22 Sandwiches, 8 Bread/Toast items, and 12 Vegetable Bhartas).
- Added **26** additional Indian and Bengali Vegetable Bharta recipes (including *Patol Bharta (Pointed Gourd / Parwal Mash), Aloo Chokha, Ucche Aloo Bharta, Potol Khosa Bharta, Lau Khosa Bharta, Kacha Tomato Bharta, Bhindi Bharta, Dherosh Shorshe Bharta, Kacha Kola Bharta, Kanchkola Khosa Bharta, Pepe Bharta, Jhinge Bharta, Dhundul Bharta, Chichinda Bharta, Tinda Bharta, Kundru Bharta, Gobi Bharta, Bandhakopi Bharta, Borboti Bharta, Matar Bharta, Ol Bharta, Kochur Mukhi Bharta, Gajor Bharta, Beetroot Bharta, Sajne Data Bharta,* and *Echorer Bharta*).
- Preserved all **920** original recipe IDs (`static-0001`–`static-0920`) and assigned sequential IDs (`static-0921`–`static-1013`) to the **93** newly added recipes (**1,013** total recipes, sorted alphabetically by name).

## 3. Scheduler Module & Email Delivery Fixes
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


## 4. Marketing List Bulk Selection Actions ("Remove All" & "Change Date")
- **Bulk Item Action Controls (`frontend/src/pages/MarketingList.jsx`, `frontend/src/pages/marketing.css`)**:
  - Unlocked selection for all pending marketing items on the page (no longer requires both category and location filters to be active).
  - Added **Remove All** button (`marketing-bulk-remove-btn`) that appears when items are selected, opening a confirmation modal displaying the selected item names and permanently deleting all selected pending items.
  - Added **Change Date** button (`marketing-bulk-date-btn`) that appears when items are selected, opening a modal dialog with a date picker to move all selected items to another date.
  - Styled selection toolbars (top & bottom), action buttons, and responsive modal dialogs in `frontend/src/pages/marketing.css`.
- **Backend Bulk Marketing Routes & Controllers (`backend/src/controllers/marketingController.js`, `backend/src/routes/index.js`)**:
  - `POST /api/marketing-list/remove-bulk`: Atomically deletes all pending items matching the provided `itemIds`.
  - `POST /api/marketing-list/change-date-bulk`: Atomically updates `purchase_date` for all pending items matching the provided `itemIds`.
  - Frontend includes automatic fallback to individual item calls if communicating with an older deployment.

## 5. Recipe Master "Add to Food Chart" Modal & Quick-Action Button
- **Recipe Row Action & Details Modal Integration (`frontend/src/pages/RecipeMaster.jsx`, `frontend/src/pages/dietChart.css`)**:
  - Added a dedicated **Add to Food Chart** button (`<CalendarClock size={18} />`) on every recipe row in Recipe Master as well as inside the full recipe details viewer.
  - Clicking the button opens the **Add recipe to Food Chart** pop-up modal (`AddToFoodChartModal`).
  - **Date**: Defaults to today (IST, via `todayKolkata()`).
  - **Location**: Pre-selects the nearest/most frequently visited GPS-enabled location automatically, showing the auto-mapped match badge, and loads all available marketing locations.
  - **Food Taking Time (Meal Time)**: Provides a dropdown with standard meal slots (*Breakfast (Morning)*, *Lunch (Noon)*, *Evening Snacks (Afternoon / Evening)*, and *Dinner (Night)*), defaulting intelligently based on the current hour of the day.
  - **Submission**: Clicking "Add to Food Chart" posts to `/api/food-chart`, updates local usage metrics, records GPS location tracking, and presents a confirmation toast message.

## 6. Food Chart Duplicate Recipe Entry Prevention & Validation
- **Backend Duplicate Recipe Enforcement (`backend/src/controllers/dietChartController.js`)**:
  - Added strict database validation in `addFoodChartEntry` (`POST /api/food-chart`) to prevent duplicate recipe entries for the same date, meal slot timing (*Breakfast*, *Lunch*, *Evening Snacks*, *Dinner*), and location (using null-safe `location_id IS NOT DISTINCT FROM NULLIF($3, '')::bigint`).
  - Identifies duplicate entries across both recipe ID (`recipe_id` or `recipe_snapshot->>'id'`) and case-insensitive trimmed recipe name (`LOWER(TRIM(recipe_snapshot->>'name'))`).
  - Rejects duplicate attempts with HTTP 409 Conflict: `"<Recipe Name>" is already scheduled for <Meal> on this date and location. Duplicate entries are not allowed for the same timing.`
- **Frontend Food Chart Validation (`frontend/src/pages/FoodChart.jsx`, `frontend/src/pages/dietChart.css`)**:
  - Implemented `isRecipeAlreadyInMeal(recipe, meal)` to detect in real-time whether a recipe is already planned for the active meal timing, date, and location.
  - In the recipe picker modal, recipes already planned for the selected meal timing dynamically display an `Already planned for <Meal>` badge, and their button is disabled as "Added" to prevent duplicate selection.
  - Changing the meal slot dropdown inside the picker modal immediately re-evaluates duplicate states for all recipes.
  - The `add()` function validates client-side before dispatching, displaying immediate warning messages and toast notifications.
- **Frontend Recipe Master Validation (`frontend/src/pages/RecipeMaster.jsx`)**:
  - Connected `AddToFoodChartModal` to catch and display backend conflict messages inline, alerting the user and keeping the modal open so they can choose a different meal timing or date.

- **Fixed `invalid input syntax for type bigint` in Food Chart duplicate check (`backend/src/controllers/dietChartController.js`)**:
  - Replaced unsafe `recipe_id = NULLIF($4, '')::bigint` with string comparison against `recipe_snapshot->>'id'` and `recipe_snapshot->>'name'`, only casting to bigint if the recipe ID is numeric (`/^\d+$/`).
  - Added numeric sanitization for `locationId` so non-numeric values gracefully default to empty/null.

- **Disabled Already Scheduled Food Times in Recipe Master Modal (`frontend/src/pages/RecipeMaster.jsx`)**:
  - `AddToFoodChartModal` dynamically checks planned entries for the selected date and location via `/api/food-chart`.
  - Disables meal time options (*Breakfast*, *Lunch*, *Evening Snacks*, *Dinner*) where the recipe is already scheduled, appending an "— Already scheduled" badge to the option label.
  - Automatically shifts selection to the first available non-scheduled meal time.
  - Displays unavailable meal slots and disables the submission button if all meal times on that date and location already contain the recipe.
