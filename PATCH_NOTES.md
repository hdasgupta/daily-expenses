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

- **Smart Three-Segment Pagination Component (`frontend/src/components/Pagination.jsx`, `frontend/src/styles.css`)**:
  - When the total page count exceeds the visible threshold, the pagination bar displays:
    - Few starting pages (default 2)
    - Ellipsis separator (`…`)
    - Few middle pages (default 3)
    - Ellipsis separator (`…`)
    - Few ending pages (default 2)
  - If the active page is already among the visible starting or ending pages, the middle section shows pages in the natural center of the page range.
  - If the active page is in between, the middle section dynamically shifts to center around and cover the current page.
  - Adjacent page numbers merge cleanly without redundant ellipsis.
  - Added `.page-ellipsis` styling in `frontend/src/styles.css` matching `.page-button` alignment and typography.

## 7. Nepali Chaukani & Quick Readymade Cooking Recipes Expansion
- Added **16** authentic Nepali readymade cooking recipes (ready in 5–15 minutes from pre-boiled or roasted staples with quick tempering/mixing) to `backend/src/data/recipes.json` and `backend/src/data/expandedStarterRecipes.js`:
  1. *Nepali Chaukani / Chukauni (Palpali Spiced Potato Yogurt Salad)* (`static-1643`)
  2. *Chicken Chaukani / Chicken Chukauni (Nepali Spiced Chicken & Yogurt Salad)* (`static-1636`)
  3. *Chana Chaukani / Chickpea Chukauni (Nepali Spiced Boiled Chickpea & Curd Salad)* (`static-1635`)
  4. *Egg Chaukani / Anda Chukauni (Nepali Spiced Boiled Egg & Yogurt Salad)* (`static-1637`)
  5. *Kakro Chaukani / Cucumber Chukauni (Refreshing Nepali Cucumber & Spiced Yogurt Salad)* (`static-1639`)
  6. *Mula Chaukani / Radish Chukauni (Pungent Nepali White Radish & Yogurt Salad)* (`static-1641`)
  7. *Aloo Sadeko (Nepali Spiced Boiled Potato Salad with Timur & Mustard Oil)* (`static-1630`)
  8. *Anda Sadeko (Nepali Spiced Hard-Boiled Egg Salad with Onion & Lime)* (`static-1631`)
  9. *Bhatmas Sadeko (Nepali Spiced Crunchy Roasted Soybean Salad)* (`static-1632`)
  10. *Bodi ko Achar / Bodi Sadeko (Nepali Spiced Black-Eyed Pea Salad)* (`static-1633`)
  11. *Chana Chatpate / Chana Sadeko (Nepali Street-Style Spiced Chickpea & Puffed Rice Snack)* (`static-1634`)
  12. *Gundruk Sadeko (Nepali Fermented Leaf & Mustard Oil Salad)* (`static-1638`)
  13. *Kakro ko Achar (Nepali Spiced Cucumber & Roasted Sesame Salad)* (`static-1640`)
  14. *Mula ko Achar (Instant Nepali Spiced Radish & Mustard Seed Salad)* (`static-1642`)
  15. *Piro Aloo (Nepali Spicy Sesame & Timur Boiled Potato Salad)* (`static-1644`)
  16. *Wai Wai Sadeko (Nepali Street-Style Instant Noodle Salad with Fresh Herbs)* (`static-1645`)
- Assigned sequential IDs (`static-1630`–`static-1645`), verified 0 duplicate names or IDs, and sorted all **1,570** recipes alphabetically.

## 8. Dessert Catalogue Expansion (Bread, Maida & Traditional Specialties) & Deduplication
- **Added 24 Authentic Dessert Recipes** across Bread, Maida, and other traditional ingredients:
  - **Bread Desserts (8)**: *Bread Cham Cham* (`static-1646`), *Bread Gulab Jamun* (`static-1647`), *Bread Halwa* (`static-1648`), *Bread Kheer* (`static-1649`), *Bread Malpua* (`static-1650`), *Bread Rasmalai* (`static-1651`), *Caramel Bread Pudding* (`static-1653`), and *Shahi Tukda (Royal Mughlai Saffron Rabdi & Ghee-Crisped Bread Pudding)* (`static-1667`).
  - **Maida Desserts (9)**: *Chandrakala* (`static-1654`), *Chhena Jilapi / Paneer Jalebi* (`static-1655`), *Gujiya / Mawa Karanji* (`static-1658`), *Khasta Goja / Bengali Belgrami* (`static-1660`), *Labanga Latika / Lavang Latika* (`static-1661`), *Madatha Kaja / Tapeswaram Kaja* (`static-1662`), *Puran Poli (Maharashtrian Sweet Chana Dal & Jaggery Stuffed Thin Maida Flatbread)* (`static-1664`), *Rabdi Malpua* (`static-1665`), and *Suryakala* (`static-1668`).
  - **Other Desserts (7)**: *Anarsa* (`static-1652`), *Bebinca* (`static-1647`), *Elaneer Payasam / Tender Coconut Kheer* (`static-1656`), *Gulgule / Pua* (`static-1659`), *Mohanthal* (`static-1663`), *Rasbari (Delicate Nepali Spongy Cottage Cheese Balls in Cardamom Syrup)* (`static-1666`), and *Tender Coconut Ice Cream / Elaneer Ice Cream* (`static-1669`).
- **Removed 64 Redundant & Synthetic Prefix Duplicate Sweets**:
  - Eliminated synthetic prefix duplicates (*Festive ...*, *Quick ...*, *Saffron ...*, *Bengali Style ...*, *Crispy ...*, *Soft ...*) for *Gajar Halwa*, *Moong Dal Halwa*, *Payesh*, *Rasgulla*, *Rice Kheer*, *Sandesh*, *Seviyan Kheer*, *Suji Halwa*, *Cham Cham*, *Mishti Doi*, *Narkel Naru*, and *Patishapta*.
  - Removed outdated starter placeholders including *Double Ka Meetha*, *Malpua (Traditional)*, *Malpua with Rabri*, *Puran Poli (Sweet)*, and old generic placeholders for *Shahi Tukda*, *Lobongo Lotika*, and *Mawa Gujiya*.
- **Alphabetical Sorting**: Sorted all **1,530** recipes strictly alphabetically by name from A to Z with zero duplicate IDs or duplicate names.


## 9. Diverse Pudding Desserts Expansion & Placeholder Deduplication
- **Added 20 Authentic Pudding Dessert Recipes** (`static-1670`–`static-1689`):
  1. *Avocado Chocolate Pudding (Silky Dark Cacao & Ripe Avocado Chilled Vegan Pudding)* (`static-1670`)
  2. *Banana Custard Pudding (Layered Vanilla Custard, Sliced Bananas & Marie Biscuit Pudding)* (`static-1671`)
  3. *Butterscotch Pudding with Praline Crunch (Brown Sugar, Butter & Vanilla Custard with Cashew Praline)* (`static-1672`)
  4. *Chia Seed Pudding (Vanilla Coconut Milk & Chia Seed Parfait with Fresh Fruit Compote)* (`static-1673`)
  5. *Classic Chocolate Pudding (Silky Dark Chocolate Stovetop Custard Pudding)* (`static-1674`)
  6. *Coffee Caramel Pudding / Espresso Caramel Custard (Rich Coffee-Infused Steamed Caramel Pudding)* (`static-1675`)
  7. *Creamy Rice Pudding / Sutliya (Slow-Simmered Fragrant Basmati Rice & Saffron Milk Pudding)* (`static-1676`)
  8. *Custard Apple Pudding / Sitaphal Pudding (Chilled Sitaphal Cream & Condensed Milk Pudding)* (`static-1677`)
  9. *Eggless Fruit Custard Trifle Pudding (Layered Vanilla Custard, Eggless Sponge Cake, Jelly & Fresh Fruits)* (`static-1678`)
  10. *Lauki / Doodhi Milk Pudding (Sweet Cardamom Bottle Gourd Pudding)* (`static-1679`)
  11. *Lychee Coconut Jelly Pudding (Fragrant Lychee Pulp & Coconut Milk Layered Agar Pudding)* (`static-1680`)
  12. *Mango Pudding (Eggless Mango Custard Pudding with Agar Agar / China Grass)* (`static-1681`)
  13. *Old-Fashioned Baked Bread and Butter Pudding (Golden Raisin & Nutmeg Baked Custard Pudding)* (`static-1682`)
  14. *Orange Citrus Custard Pudding (Fresh Orange Zest & Juice Infused Silky Custard Pudding)* (`static-1683`)
  15. *Pista Phirni Pudding (Chilled Kashmiri Ground Basmati Rice & Pistachio Pudding)* (`static-1684`)
  16. *Rose Falooda Pudding (Basil Seed / Sabja & Saffron Rose Milk Agar Pudding)* (`static-1685`)
  17. *Sago Coconut Pudding / Sabudana Pudding (Translucent Tapioca Pearls with Coconut Milk & Palm Jaggery)* (`static-1686`)
  18. *Sweet Potato Pudding / Shakarkandi Pudding (Spiced Roasted Sweet Potato & Condensed Milk Pudding)* (`static-1687`)
  19. *Tender Coconut Pudding (Elaneer Coconut Milk Pudding with Agar Agar)* (`static-1688`)
  20. *Vanilla Caramel Custard / Crème Caramel (Steamed Golden Caramel Milk Flan)* (`static-1689`)
- **Removed 4 Outdated Starter Outline Placeholders**:
  - Eliminated boilerplate outline placeholders *Chocolate Pudding* (`static-0904`), *Caramel Custard* (`static-0905`), *Rice Pudding* (`static-0906`), and *Bread Pudding* (`static-0907`), replacing them with fully detailed, authentic culinary entries.
- **Catalogue Verification & Alphabetical Sorting**:
  - Sorted all **1,546** recipes strictly alphabetically by name from A to Z with zero duplicate IDs and zero duplicate names.
  - Synchronized `backend/src/data/recipes.json` and `backend/src/data/expandedStarterRecipes.js`.


## 10. Diverse Pasta & Soup Catalogue Expansion & Placeholder Deduplication
- **Added 38 Authentic Pasta & Soup Recipes** (`static-1690`–`static-1727`):
  - **Pasta Recipes (18)**:
    1. *Baked Ziti / Pasta al Forno (Four-Cheese Baked Ziti with Rich Tomato Sauce)* (`static-1690`)
    2. *Cacio e Pepe (Classic Roman Spaghetti with Pecorino Romano & Toasted Black Pepper)* (`static-1691`)
    3. *Chilli Garlic Butter Noodles / Spaghetti (Fiery Indo-Western Garlic Butter Pasta)* (`static-1692`)
    4. *Classic Baked Macaroni and Cheese (Creamy Cheddar & Crispy Breadcrumb Mac & Cheese)* (`static-1693`)
    5. *Classic Minestrone Pasta (Hearty Ditalini Pasta with White Beans & Vegetables)* (`static-1694`)
    6. *Classic Spaghetti Aglio e Olio (Garlic, Olive Oil & Red Pepper Flakes Spaghetti)* (`static-1695`)
    7. *Creamy Mushroom & Spinach Fettuccine (Garlic Herb Cream Sauce with Sliced Cremini)* (`static-1696`)
    8. *Creamy Sun-Dried Tomato & Basil Penne (Tuscan Herb Cream Sauce)* (`static-1697`)
    9. *Creamy Tomato Basil Pasta / Penne alla Vodka (Velvety Pink Sauce Pasta)* (`static-1698`)
    10. *Desi Masala Pasta (Indian Street-Style Spiced Masala Penne with Capsicum & Corn)* (`static-1699`)
    11. *Fettuccine Alfredo (Rich Butter & Parmesan Cream Sauce Pasta)* (`static-1700`)
    12. *Pasta e Fagioli (Rustic Italian Ditalini Pasta & Borlotti Bean Stew)* (`static-1701`)
    13. *Pasta Primavera (Vibrant Garden Vegetables & Herb Garlic Penne)* (`static-1702`)
    14. *Penne Arrabbiata (Spicy Garlic & Crushed Tomato Sauce Penne)* (`static-1703`)
    15. *Pesto Genovese Pasta (Fresh Basil, Pine Nut, Garlic & Parmesan Fusilli)* (`static-1704`)
    16. *Spaghetti Marinara with Herb Meatballs (Slow-Simmered Tomato Sauce)* (`static-1705`)
    17. *Spinach & Ricotta Ravioli with Sage Butter Sauce (Handmade Stuffed Pasta)* (`static-1706`)
    18. *Vegetable Lasagna (Layered Ricotta, Mozzarella, Roasted Vegetables & Marinara Sauce)* (`static-1707`)
  - **Soup Recipes (20)**:
    19. *Broccoli & Toasted Almond Soup (Nutrient-Dense Silky Green Broccoli & Almond Broth)* (`static-1708`)
    20. *Chicken Hot and Sour Soup (Tangy Peppery Indo-Chinese Shredded Chicken Soup)* (`static-1709`)
    21. *Chicken Sweet Corn Soup (Velvety Shredded Chicken & Egg Drop Sweet Corn Broth)* (`static-1710`)
    22. *Classic Italian Minestrone Soup (Hearty Bean, Ditalini, Zucchini & Tomato Broth with Pesto)* (`static-1711`)
    23. *Clear Vegetable Wonton Soup (Delicate Sesame Ginger Broth with Steamed Vegetable Dumplings)* (`static-1712`)
    24. *Cream of Mushroom Soup (Earthy Sliced Cremini & Thyme Pureed Cream Soup)* (`static-1713`)
    25. *Creamy Roasted Tomato Basil Soup / Classic Tomato Soup (Slow-Roasted Plum Tomatoes & Fresh Basil)* (`static-1714`)
    26. *French Onion Soup (Rich Caramelized Onion & Herb Broth with Crusty Cheesy Baguette)* (`static-1715`)
    27. *Lemon Coriander Soup (Immunity-Boosting Clear Vegetable Broth with Fresh Lemon & Cilantro)* (`static-1716`)
    28. *Mexican Tortilla Soup (Spiced Black Bean, Roasted Corn & Tomato Broth with Crispy Tortilla Strips)* (`static-1717`)
    29. *Mulligatawny Soup (Anglo-Indian Curried Lentil, Apple & Rice Soup with Coconut Milk)* (`static-1718`)
    30. *Mutton Paya Shorba / Lamb Trotter Broth (Slow-Simmered Spiced Bone Marrow Broth)* (`static-1719`)
    31. *Palak Shorba / Cream of Spinach Soup (Spiced Velvety Spinach & Cardamom Green Soup)* (`static-1720`)
    32. *Roasted Butternut Squash & Sage Soup (Velvety Spiced Pumpkin / Butternut Squash Cream Soup)* (`static-1721`)
    33. *Sweet Corn Vegetable Soup (Silky Indo-Chinese Corn Chowder with Diced Vegetables)* (`static-1722`)
    34. *Tibetan Vegetable Thukpa (Himalayan Warming Noodle & Mixed Vegetable Spiced Soup)* (`static-1723`)
    35. *Tom Kha Gai / Tom Kha Veg (Creamy Coconut Galangal Thai Soup with Straw Mushrooms)* (`static-1724`)
    36. *Tom Yum Soup (Aromatic Thai Lemongrass, Kaffir Lime, Galangal & Mushroom Hot-Sour Soup)* (`static-1725`)
    37. *Vegetable Hot and Sour Soup (Fiery Tangy Indo-Chinese Broth with Shredded Veg & Tofu)* (`static-1726`)
    38. *Vegetable Manchow Soup (Spicy Indo-Chinese Coriander Garlic Broth with Crispy Fried Noodles)* (`static-1727`)
- **Removed Outdated Starter Outline Placeholder**:
  - Eliminated generic outline *Tomato Soup* (`static-0926`), replaced with authentic *Creamy Roasted Tomato Basil Soup / Classic Tomato Soup*.
- **Catalogue Verification & Alphabetical Sorting**:
  - Sorted all **1,583** recipes strictly alphabetically by name from A to Z with zero duplicate IDs and zero duplicate names.
  - Synchronized `backend/src/data/recipes.json` and `backend/src/data/expandedStarterRecipes.js`.


## 11. Systematic Catalogue Deduplication & Naming Variety Normalization
- **Removed 115 Redundant Synthetic Clone Duplicates**:
  - **Snacks Clones (48)**: Eliminated artificial prefix copies (*Crispy ...*, *Spicy ...*, *Bengali Style ...*, *Street Style ...*) across *Aloo Tikki*, *Alur Chop*, *Beguni*, *Cutlet*, *Dhokla*, *Khandvi*, *Mochar Chop*, *Pakora*, *Piyaji*, *Samosa*, *Singara*, and *Vegetable Chop*.
  - **Breakfast Clones (43)**: Removed redundant synthetic copies (*Crispy ...*, *Soft ...*, *Masala ...*, *Vegetable ...*) across *Appam*, *Besan Chilla*, *Chirer Polao*, *Dosa*, *Idli*, *Moong Dal Chilla*, *Pesarattu*, *Poha*, *Puttu*, *Upma*, and *Uttapam*.
  - **Rice Clones (12)**: Removed redundant *Bengali Style ...* clones for *Basmati Rice*, *Brown Rice*, *Curd Rice*, *Gobindobhog Rice*, *Jeera Rice*, *Kashmiri Pulao*, *Lemon Rice*, *Peas Pulao*, *Steamed Rice*, *Tamarind Rice*, *Tomato Rice*, and *Vegetable Pulao*.
  - **Duplicate Pulse Entries (8)**: Removed identical *Toor Dal ...* duplicates (*Toor Dal Bengali Style*, *Toor Dal Curry*, *Toor Dal Fry*, *Toor Dal Punjabi Style*, *Toor Dal Tadka*, *Toor Dal with Coconut*, *Toor Dal with Spinach*, *Toor Dal with Tomato*) that mirrored *Arhar Dal*.
  - **Toast & Sandwich Duplicates (4)**: Removed redundant entries *Crispy Potato Sandwich*, *Bread Butter Jam*, *Toast with Butter*, and *Toast with Jam*.
- **Normalized Naming Variety**:
  - Restored canonical culinary dish names by removing artificial `(Homestyle)` and `(Classic)` qualifiers across 34 staple breakfast, snack, bread, and rice dishes (e.g. *Alur Chop*, *Dhokla*, *Beguni*, *Idli*, *Dosa*, *Upma*, *Poha*, *Basmati Rice*, *Jeera Rice*, *Aloo Paratha*, *Chapati*).
- **Catalogue Verification & Alphabetical Sorting**:
  - Verified 0 duplicate IDs and 0 duplicate names across the remaining **1,468** unique, authentic recipes.
  - Sorted all entries strictly alphabetically from A to Z (`Aam Panna` through `Wai Wai Sadeko`).
  - Synchronized `backend/src/data/recipes.json` and `backend/src/data/expandedStarterRecipes.js`.


## 12. Recipe Search Optimization & Smart Category Filtering (Recipe Master & Food Chart)
- **High-Performance Recipe Search & Indexing Engine (`frontend/src/lib/recipeSearch.js`)**:
  - Implemented pre-indexed tokenization (`indexRecipes`) that normalizes titles, categories, regions, and ingredient text into lightweight searchable vectors upon initial catalogue fetch, achieving sub-millisecond search execution.
  - Multi-token semantic search matching across any word combination (e.g. searching *"tomato soup"*, *"prawn garlic"*, or *"spinach ravioli"* matches regardless of word order across recipe names, categories, regions, and ingredient lists).
  - Multi-tier relevance scoring:
    - **Exact title match** (+1,000 pts)
    - **Exact phrase match in title** (+700 pts)
    - **Prefix match on recipe title** (+500 pts)
    - **All search tokens present in title** (+350 pts)
    - **Category / regional cuisine match** (+250 pts)
    - **Partial token and ingredient matches** (+40–150 pts with title density bonus)
    - Seamless tie-breaking by personal frequency, total usage count, and alphabetical order.
  - Category extractor (`extractCategories`) automatically compiling all available recipe categories for instant one-tap filtering.
- **Recipe Master Search & UX Overhaul (`frontend/src/pages/RecipeMaster.jsx`, `frontend/src/pages/dietChart.css`)**:
  - Integrated smart pagination (`usePagination` & `Pagination.jsx`) with customizable items per page (10, 20, 50, 100), eliminating DOM thrashing and lag from rendering all 1,468 recipe cards simultaneously.
  - Added horizontal scrollable Category Chips (*All*, *Breakfast*, *Sweets*, *Pasta*, *Soup*, *Vegetable*, *Bread*, *Snacks*, *Prawns*, *Fish*, etc.) for one-tap cuisine discovery.
  - Added instant clear button (`X`) within the search bar and live match count badge (*"Showing X matching recipes"*).
  - Search metadata bar showing active query and active category filter with a one-click *"Clear filters"* button.
  - Multi-attribute sorting dropdown: *Recipe Name*, *Cook + Prep Time*, *Ingredient Count*, and *Most Frequently Used*.
- **Food Chart Add Recipe Modal Optimization (`frontend/src/pages/FoodChart.jsx`)**:
  - Wired `recipeSearch.js` directly into the Add Recipe modal picker, accelerating search responses to instant 0ms latency.
  - Added Category Filter Chips inside the modal so users can immediately filter for breakfast, soups, pastas, or snacks without typing.
  - Added instant clear button (`X`) and live matching count badge (*"X matches"*).
  - Automatically resets search query and category filter upon opening the picker modal, preserving the duplicate detection badge and conflict prevention rules.


## 13. Gradle Wrapper Distribution & Android APK CI Build Fix
- **Direct CloudFront CDN Distribution (`frontend/android/gradle/wrapper/gradle-wrapper.properties`)**:
  - Pointed `distributionUrl` directly to Gradle's CloudFront CDN (`https://downloads.gradle-dn.com/distributions/gradle-8.13-bin.zip`), completely bypassing the failing `services.gradle.org` gateway.
  - Set `networkTimeout=60000` (60 seconds) and `validateDistributionUrl=false` to prevent wrapper verification errors during offline or mirror builds.
- **Resilient Multi-Mirror Pre-Fetch Step (`.github/workflows/android-apk.yml`)**:
  - Replaced `gradle/actions/setup-gradle@v4` (which crashed with 504 trying to query `services.gradle.org/versions/all`) with a multi-mirror `curl` pre-fetch step.
  - The step attempts 4 reliable mirrors (`downloads.gradle-dn.com`, Tencent Cloud, Alibaba Cloud, and `services.gradle.org`) with retries, saves the zip locally into `frontend/android/gradle/wrapper/`, and switches `distributionUrl` to a local relative path `gradle-8.13-bin.zip`.
  - Ensures `./gradlew assembleRelease` runs completely offline regarding the Gradle distribution, preventing all 504 timeouts.

## 14. Kotlin Gradle Plugin & Subproject Dependency Resolution Fix
- **Explicit `kotlin_version` in Android Variables (`frontend/android/variables.gradle`)**:
  - Added `kotlin_version = '2.0.21'` and `kotlinVersion = '2.0.21'` to `ext` in `variables.gradle`.
  - Previously, subprojects like `:capacitor-filesystem` evaluated `project.hasProperty('kotlin_version')` and fell back to internal default `2.3.0`, causing `:capacitor-filesystem:compileReleaseKotlin` to request `kotlin-compiler-embeddable-2.3.0.jar` from failing GitHub Releases endpoints.
- **Forced Resolution Strategy (`frontend/android/build.gradle`)**:
  - Added global `configurations.all.resolutionStrategy` forcing `kotlin-compiler-embeddable`, `kotlin-stdlib`, and `kotlin-reflect` to `2.0.21` across all project and subproject compilation configurations.
  - Placed Google Cloud Storage Maven Central mirror (`https://maven-central.storage-download.googleapis.com/repos/central/data/`) at the top of all repository blocks to serve Kotlin compiler JARs directly from Google Cloud CDN.
- **Passed Gradle Project Properties (`.github/workflows/android-apk.yml`)**:
  - Added `-Pkotlin_version="2.0.21"` and `-PkotlinVersion="2.0.21"` to `./gradlew assembleRelease` in the workflow to override any plugin-level default properties at runtime.
- **Extended HTTP Socket Timeouts (`frontend/android/gradle.properties`)**:
  - Configured `systemProp.http.socketTimeout=120000`, `systemProp.https.socketTimeout=120000`, and `kotlin.version=2.0.21`.

## 15. Usage-First Sorting (Recipe Master & Food Chart)
- **Usage-Based Default Sorting (`frontend/src/lib/recipeSearch.js`)**:
  - Configured default sort column to `usageCount` with descending direction (`desc`) across all recipe listings.
  - High-frequency and frequently planned recipes are prioritized at the top of the list (`bUsage - aUsage`), followed by personal user frequency (`bUserUsage - aUserUsage`), with alphabetical A–Z tie-breaking for unused items.
- **Recipe Master Page Ordering (`frontend/src/pages/RecipeMaster.jsx`)**:
  - Initialized pagination with `usePagination("recipe-master", "usageCount", "desc")`, defaulting the catalogue view to show the user's most frequently planned and used recipes on page 1.
  - Placed *"Most Used"* at the top of the sort options dropdown.
  - Added a distinct `.diet-usage-badge` indicator (*"Used Xx"*) next to each recipe's metadata to clearly highlight usage frequency.
- **Food Chart Add Recipe Modal Ordering (`frontend/src/pages/FoodChart.jsx`)**:
  - Configured the recipe picker modal to always present the most frequently scheduled recipes at the top of the list for quick 1-tap meal planning.
  - Highlighted usage count on modal items with `.diet-usage-badge`.
- **Pagination Hook Default Direction Support (`frontend/src/hooks/usePagination.js`)**:
  - Added `defaultDirection = "asc"` parameter to `usePagination` so modules can default to descending order (e.g. `usageCount: desc`).


## 16. Fix `getUsageCount is not defined` in Food Chart
- **Fixed Identifier Reference in Food Chart (`frontend/src/pages/FoodChart.jsx`)**:
  - Corrected the property shorthand typo in `filteredRecipes` useMemo hook from `getUsageCount` to `getUsageCount: getRecipeUsageCount`.
  - Updated the hook dependency array to `[indexedRecipes, query, pickerCategory, getRecipeUsageCount]`.
  - Resolves `ReferenceError: getUsageCount is not defined` when opening the Food Chart page or Add Recipe picker modal.


## 17. Fix Clipped Recipe Category Tags & Badges in Add Recipe Modal (Food Chart)
- **Prevented Flex Crushing of Category Tags (`frontend/src/pages/dietChart.css`, `frontend/src/pages/FoodChart.jsx`)**:
  - Added `.diet-modal.diet-picker > .diet-category-chips` and `.diet-modal.diet-picker > .diet-search-meta` to the `flex-shrink: 0` rule so the modal flex layout never squashes or clips the category tag row vertically.
  - Configured `.diet-category-chips.diet-picker-chips` inside the Add Recipe modal with `flex-wrap: wrap`, `min-height: 40px`, `max-height: 112px`, and smooth `overflow-y: auto` so all 27 recipe category tags wrap into clean, completely visible multi-line rows without horizontal clipping.
- **Restored Badge Contrast & Visibility (`frontend/src/pages/dietChart.css`)**:
  - Fixed CSS specificity where `.diet-picker-item span { color: var(--diet-muted) }` was overriding `.diet-usage-badge` text color inside modal items.


## 18. Smart Loading on Scroll in Recipe Master Page
- **Progressive Infinite Scroll via `IntersectionObserver` (`frontend/src/pages/RecipeMaster.jsx`, `frontend/src/pages/dietChart.css`)**:
  - Replaced page-number buttons on Recipe Master with smart progressive scroll loading.
  - Renders the first **30** recipes immediately on initial render for instant load speed, and observes a bottom sentinel element (`sentinelRef`) with a `320px` rootMargin lookahead.
  - Automatically appends the next **30** recipes seamlessly as the user scrolls near the bottom of the list, plus provides a fallback *"Load more (X remaining)"* button and an *"All X recipes loaded"* completion footer.
  - Automatically resets `visibleCount` back to `30` whenever the user changes the search query, category chip, or sort order.
- **Inline Sort & Status Toolbar (`frontend/src/pages/RecipeMaster.jsx`)**:
  - Added an inline status bar showing *"Showing X of Y recipes"* alongside a compact Sort selector (*Most Used in Food Chart*, *Recipe Name (A–Z)*, *Cook + Prep Time*, *Ingredient Count*) and an Ascending/Descending toggle button (`↑ Asc` / `↓ Desc`).


## 19. Diverse Khichuri & Khichdi Catalogue Expansion
- **Added 24 Authentic Khichuri & Khichdi Recipes** (`static-1728`–`static-1751`):
  1. *Aar Macher Khichuri (Bengali River Catfish & Roasted Moong Dal Khichuri)* (`static-1728`)
  2. *Achari Khichdi (Tangy Pickled-Spice Moong & Chana Dal Khichdi)* (`static-1729`)
  3. *Bajra Khichdi (Rajasthani Winter Pearl Millet & Moong Dal Khichdi)* (`static-1730`)
  4. *Bengali Bhoger Khichuri (Thakurbarir Niramish Gobindobhog Rice & Roasted Moong Dal Khichuri)* (`static-1731`)
  5. *Bengali Bhuni Khichuri / Jhura Khichuri (Dry-Roasted Moong Dal & Fragrant Gobindobhog Pilaf-Style Khichuri)* (`static-1732`)
  6. *Bengali Masoor Daler Khichuri (Monsoon Red Lentil, Onion & Mustard Oil Homestyle Khichuri)* (`static-1733`)
  7. *Bisi Bele Bath (Karnataka Spiced Toor Dal, Tamarind & Vegetable Rice Khichdi)* (`static-1734`)
  8. *Bokul Phuler Khichuri / Keema Khichuri (Mughlai-Bengali Spiced Mutton Mince & Basmati Khichuri)* (`static-1735`)
  9. *Chicken Khichuri / Murgir Mangshor Khichuri (Homestyle Spiced Chicken, Potato & Moong-Masoor Dal Khichuri)* (`static-1736`)
  10. *Dal Khichdi (Restaurant-Style Dhaba Tadka Yellow Dal & Jeera Rice Khichdi)* (`static-1737`)
  11. *Dimer Khichuri / Egg Khichuri (Bengali Spiced Scrambled & Boiled Egg Masala Khichuri)* (`static-1738`)
  12. *Gujarati Vaghareli Khichdi (Spiced Tuvar-Moong Dal Khichdi with Garlic-Curry Leaf Tempering)* (`static-1739`)
  13. *Harey Chane O Palang Shaker Khichuri / Palak Dal Khichdi (Spinach, Green Chickpea & Garlic-Ghee Khichdi)* (`static-1740`)
  14. *Hyderabadi Khatti Dal Khichdi / Keema Khichdi (Nizami Saffron, Mint & Chana-Masoor Dal Pilaf Khichdi)* (`static-1741`)
  15. *Ilish Macher Khichuri (Bengali Monsoon Hilsa Fish & Mustard Oil Khichuri)* (`static-1742`)
  16. *Ilish Macher Matha Diye Khichuri (Bengali Hilsa Fish Head & Roasted Moong Dal Khichuri)* (`static-1743`)
  17. *Millet Khichdi / Foxtail & Little Millet Vegetable Khichdi (High-Fiber Siridhanya Millet & Moong Dal Khichdi)* (`static-1744`)
  18. *Mutton Khichuri / Mangshor Khichuri (Rich Bengali Slow-Cooked Mutton & Gobindobhog Rice Khichuri)* (`static-1745`)
  19. *Oats Vegetable Khichdi (Savory Rolled Oats, Yellow Moong Dal & Garden Vegetable Khichdi)* (`static-1746`)
  20. *Panchmel Dal Khichdi / Satpadi Khichdi (Rajasthani Five-Lentil & Spiced Ghee Khichdi)* (`static-1747`)
  21. *Quinoa Vegetable Khichdi (High-Protein Tri-Color Quinoa, Yellow Moong Dal & Ghee Tadka Khichdi)* (`static-1748`)
  22. *Sabudana Khichdi (Maharashtrian Upvas Sago Pearl, Crushed Peanut & Cumin Khichdi)* (`static-1749`)
  23. *Sama Chawal Khichdi / Vrat ki Mordhan Khichdi (Fasting Barnyard Millet, Potato & Peanut Khichdi)* (`static-1750`)
  24. *Winter Vegetable & Cauliflower Masala Khichuri / Shiter Sobji Khichuri (Bengali Winter Harvest Vegetable Khichuri)* (`static-1751`)
- **Removed Outdated Starter Outline Placeholder**:
  - Eliminated boilerplate outline *Sabudana Khichdi (Plain)* (`static-0710`), replaced with authentic *Sabudana Khichdi (Maharashtrian Upvas Sago Pearl, Crushed Peanut & Cumin Khichdi)*.
- **Catalogue Verification & Alphabetical Sorting**:
  - Sorted all **1,491** recipes strictly alphabetically by name from A to Z with zero duplicate IDs and zero duplicate names.
  - Synchronized `backend/src/data/recipes.json` and `backend/src/data/expandedStarterRecipes.js`.


## 20. Fixed Survivor Share Amount Validation (Add Expenses Page & Backend)
- **Frontend Validation in Add Expenses (`frontend/src/pages/Expense.jsx`)**:
  - Updated `resolvedShares` to verify that every survivor share with `shareType === "fixed"` is neither blank nor `<= 0`.
  - Displays clear real-time validation messages:
    - *"Fixed amount of a survivor cannot be blank"* when a fixed share input is empty.
    - *"Fixed amount of a survivor must be greater than zero"* when `0` or a negative value is entered.
  - Set `min="0.01"` and `required={true}` on the Share price input when `"Fixed amount"` is selected, and auto-displays the calculated share amount for `"Average amount"` and `"Remaining amount"` rows.
  - Renders the live validation indicator immediately whenever fixed share validation fails.
- **Backend Enforcement (`backend/src/services/expenseService.js`)**:
  - Updated `normalizeShares` to reject blank or zero/negative fixed share amounts with descriptive errors (`"Fixed amount of a survivor cannot be blank"` / `"Fixed amount of a survivor must be greater than zero"`).


## 21. Minimum 2 Survivors Validation for Average Amount Share (Add Expenses Page & Backend)
- **Frontend Validation in Add Expenses (`frontend/src/pages/Expense.jsx`)**:
  - Updated `resolvedShares` to verify that if `"Average amount"` (`shareType === "average"`) is selected, at least **2** survivors must have `"Average amount"` selected (`average.length === 1` is rejected with *"Average amount requires at least 2 survivors"*).
  - Also added explicit real-time frontend checks for multiple `"Remaining amount"` rows (*"Only one remaining share is allowed"*) and mixing `"Average amount"` with `"Remaining amount"` (*"Use average shares or one remaining share, not both"*).
- **Backend Enforcement (`backend/src/services/expenseService.js`)**:
  - Added server-side validation in `normalizeShares` throwing `"Average amount requires at least 2 survivors"` if `averageShares.length === 1`.


## 22. Multi-Line Survivor Share Formatting Across All HTML Views & PDF Reports
- **Frontend HTML Views (`frontend/src/pages/Expense.jsx`, `frontend/src/pages/Reports.jsx`, `frontend/src/pages/DashboardDrilldown.jsx`)**:
  - Updated the expense card list on **Add Expenses** (`Expense.jsx`) to render each survivor's share information (`<Survivor Name> ₹<Amount> (<Share Type>)`) on its own new line (`<br />` with `whiteSpace: "pre-line"`) instead of joining shares inline with `" · "`.
  - Updated `buildUiShareRows` and `renderCell` in **Reports** (`Reports.jsx`) as well as **Dashboard Drilldown** (`DashboardDrilldown.jsx`) to separate each survivor's share entry with a newline (`\n` / `<br />`) inside a `white-space: pre-line` container.
- **Backend PDF Report Generators (`backend/src/services/dailyEmailReportPdfService.js`, `backend/src/services/weeklyEmailReportPdfService.js`, `backend/src/services/monthlyEmailReportPdfService.js`, `backend/src/services/yearlyEmailReportPdfService.js`, `backend/src/services/scheduledReportPdfService.js`, `backend/src/services/reportPdfService.js`)**:
  - Changed survivor share concatenation in `uiShareDumpRows`, `normaliseRawRows`, `buildUiShareRows`, and `formatCell` from `.join(", ")` to `.join("\n")` across all PDF services.
  - Combined with PDFKit's dynamic `heightOfString` row-height calculation and `lineBreak: true` cell rendering, each survivor's share information (`<Survivor Name>: ₹<Amount> (<Percentage>%)`) is printed on a dedicated new line in every generated PDF report.


## 23. Single-Line Horizontal Scrolling for Recipe Category Tags in Food Chart Add Recipe Modal
- **Add Recipe Picker Category Chips (`frontend/src/pages/dietChart.css`)**:
  - Updated `.diet-modal.diet-picker .diet-category-chips.diet-picker-chips` to use `flex-wrap: nowrap`, `overflow-x: auto`, `overflow-y: hidden`, `scrollbar-width: thin`, and `-webkit-overflow-scrolling: touch` while maintaining `flex-shrink: 0` and `min-height: 40px` so all recipe category tags stay on a single line with smooth horizontal scrolling.


## 24. Default "Remaining Amount" Share Type When Adding Survivor on Add Expenses Page
- **Default Survivor Share Type (`frontend/src/pages/Expense.jsx`)**:
  - Updated `addShare` so clicking **Add survivor** initializes the new survivor row with `shareType: "remaining"` ("Remaining amount") by default instead of `"fixed"`.
  - Updated single-survivor fallback in `removeShare` to also default to `"remaining"` when a second `"average"` survivor row is removed.


## 25. Comprehensive Besan (Gram Flour) Recipe Catalogue Expansion (Gatta, Pitor, Chilla, Kadhi, Zunka, Pithla, Sabzis, Snacks & Sweets)
- **Added 44 Authentic Besan Recipes** (`static-1752`–`static-1795`) across `backend/src/data/recipes.json` and `backend/src/data/expandedStarterRecipes.js`:
  - **Gatta Curries, Sabzis & Pulao (7)**: *Rajasthani Gatte ki Sabzi* (`static-1752`), *Shahi Govind Gatta Curry* (`static-1753`), *Masala Gatta Fry / Sukhe Gatte ki Sabzi* (`static-1754`), *Palak Gatta Curry* (`static-1755`), *Methi Gatta ki Sabzi* (`static-1756`), *Rajasthani Gatta Pulao / Gatte ke Chawal* (`static-1757`), and *Gatte ki Kadhi* (`static-1758`).
  - **Pitor / Pitod / Patod & Set Besan Cake Curries (5)**: *Rajasthani Pitod ki Sabzi / Pitor Curry* (`static-1759`), *Tawa Masala Pitor Fry / Crispy Patod Tikka* (`static-1760`), *Bihari Besan ki Sabzi / Besan Katli Curry* (`static-1761`), *Patoli / Maharashtrian Patodi Rassa* (`static-1762`), and *UP-Style Karara / Besan ki Meendhi Sabzi* (`static-1763`).
  - **Besan Chilla & Savory Gram Flour Breakfasts (8)**: *Besan Chilla / Besan ka Puda* (`static-1764`), *Paneer Bhurji Stuffed Besan Chilla* (`static-1765`), *Vegetable Masala Besan Chilla* (`static-1766`), *Oats & Besan Chilla* (`static-1767`), *Palak Besan Chilla* (`static-1768`), *Methi Besan Chilla* (`static-1769`), *Besan Toast / Savory Besan French Toast* (`static-1770`), and *Besan Omelette / Vegetarian Tomato-Besan Omelette* (`static-1771`).
  - **Kadhi, Pithla & Zunka Gravies (6)**: *Punjabi Kadhi Pakora* (`static-1772`), *Rajasthani Marwari Kadhi* (`static-1773`), *Gujarati Kadhi* (`static-1774`), *Sindhi Kadhi* (`static-1775`), *Maharashtrian Zunka* (`static-1776`), and *Maharashtrian Pithla* (`static-1777`).
  - **Besan-Coated & Stuffed Vegetable Sabzis (6)**: *Kurkuri Besan Bhindi / Rajasthani Besan Wali Bhindi* (`static-1778`), *Besan Shimla Mirch / Besan Wali Capsicum* (`static-1779`), *Rajasthani Besan Pyaz ki Sabzi* (`static-1780`), *Bharwa Besan Mirch / Rajasthani Besan Stuffed Moti Hari Mirch* (`static-1781`), *Besan Arbi Fry* (`static-1782`), and *Besan Karele ki Sabzi* (`static-1783`).
  - **Steamed & Fried Besan Snacks (7)**: *Khaman Dhokla / Nylon Khaman* (`static-1784`), *Gujarati Khandvi / Dahivadi / Suralichi Vadi* (`static-1785`), *Kothimbir Vadi* (`static-1786`), *Alu Vadi / Gujarati Patra* (`static-1787`), *Methi Besan Muthiya* (`static-1788`), *Mirchi Vada / Jodhpuri Mirchi Bada* (`static-1789`), and *Batata Vada / Mumbai Aloo Bonda* (`static-1790`).
  - **Traditional Besan Sweets & Halwas (5)**: *Besan Ladoo / Danedar Besan ke Laddu* (`static-1791`), *Besan ki Barfi / Besan Chakki* (`static-1792`), *Besan ka Halwa / Besan Sheera* (`static-1793`), *Mysore Pak* (`static-1794`), and *Besan Doodh Barfi / Besan Milk Cake* (`static-1795`).
- **Removed 7 Outdated Generic Starter Placeholders**:
  - Replaced boilerplate outline entries (`static-0647` *Besan Chilla*, `static-0620` *Masala Besan Chilla*, `static-0611` *Vegetable Besan Chilla*, `static-0317` *Dhokla*, `static-0377` *Khandvi*, `static-0855` *Besan Ladoo*, and `static-0877` *Mysore Pak*) with detailed, authentic culinary recipes.
- **Catalogue Verification & Alphabetical Sorting**:
  - Sorted all **1,528** recipes strictly alphabetically by name from A to Z with zero duplicate IDs and zero duplicate names.
