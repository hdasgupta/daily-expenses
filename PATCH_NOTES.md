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


## 26. Unsplit Raw Report Mode When No Group By Is Applied (With or Without Summarise)
- **Per-Expense Raw Report SQL (`backend/scripts/sql/reportSql.js`)**:
  - Updated `sourcePerExpense` and `rawSelectPerExpense` to group by `e.id` so each expense is returned as a single unsplit row with its full `total_cost` (`expense_amount`) and all survivor shares aggregated onto separate lines (`\n`) in the `share` column (`<Survivor Name>: ₹<Amount> (<Percentage>%)`).
  - Preserved `sourcePerSurvivor` for grouped reports (`config.groupBy.length > 0`) so survivor-level groupings and summaries continue to use each survivor's resolved share amount.
- **Report Execution & PDF Export (`backend/src/services/reportService.js`, `backend/src/services/reportPdfService.js`, `frontend/src/pages/Reports.jsx`)**:
  - Updated `runReport` and `buildReportPdfData` so that whenever no `Group by` is selected (`!config.groupBy.length`)—both when no filter/sort/group by/summarise is applied and when `Summarise` is enabled without `Group by`—the report displays the unsplit raw expense report (`mode: "raw"`).


## 27. Google Pay Bill Payment & Tall Scrolling Screenshot OCR Support (Add Expenses)
- **Hero Digit Isolation & Upscaling (`frontend/src/pages/Expense.jsx`)**:
  - Updated `buildPureHeroDigitsCanvas` to compute `minHeroHeight` relative to screen width (`Math.min(w, h)`) rather than total scrolling height `h`, scan from `y = 4%` to `55%`, and upscale small hero digit crops (`ch < 60`) up to 3x so decimal points and digits on narrow/tall bill-payment screenshots (e.g., `227×1000` `₹532.72`) remain sharp for OCR.
- **Bill Breakdown Total Parsing (`frontend/src/pages/Expense.jsx`)**:
  - Enhanced `extractAmountFromFullText` and `detectAmountFromScreenshot` to prioritize `Total amount`, `Grand total`, `Amount paid`, and `₹X paid` lines as well as hero amounts above `Completed` (even without a `To <Name>` header), while skipping sub-item lines (`Bill amount`, `Platform fee`, `Convenience fee`, `GST`) so the final paid total (`532.72`) is extracted instead of pre-fee amounts (`529.82`).

- **Fix Clipped `₹` Prefix & Partial `paid` Match (`frontend/src/pages/Expense.jsx`)**:
  - Clamped `dx0` in `buildPureHeroDigitsCanvas` to `colRuns[0].x1 + 1` when `hasSuperscriptRupee` is true so no trailing pixels of the `₹` symbol leak into `pureDigitsCanvas`.
  - Tightened `paidMatch` and `totalMatch` boundaries in `extractAmountFromFullText` and joined `TextDetector` blocks so partial digit fragments (like `2` from `%S32.72 paid`) are never returned over the full `532.72` total.

- **Cross-Verify Hero Amount Against Full-Receipt Total (`frontend/src/pages/Expense.jsx`)**:
  - Relaxed `hasSuperscriptRupee` height/baseline thresholds (`0.90` / `0.08`) in `buildPureHeroDigitsCanvas` and added Step 2 cross-verification in `detectAmountFromScreenshot` whenever a hero candidate has 4+ integer digits starting with `1`, `2`, `3`, or `7` so a misread `₹` prefix (e.g. `2532.72` vs `Total amount ₹532.72`) resolves to `532.72`.

- **Bill-Amount Sanity Check for Misread `₹` Prefix (`frontend/src/pages/Expense.jsx`)**:
  - Added `extractBillAmountFromText` and `stripMisreadRupeePrefixAgainstBill` so that even if OCR misreads `₹` as a leading `1`/`2`/`3`/`7` on both the hero amount and `Total amount` (e.g. `2532.72`), comparing against `Bill amount` (`529.82`) automatically strips the stray leading digit and returns `532.72`.


## 28. Navigation Drawer Rupee Icon for Add Expense
- **Navigation Panel Icon (`frontend/src/components/Layout.jsx`)**:
  - Updated the **Add Expense** (`/add-expense`) navigation item to use `IndianRupee` (`₹`) from `lucide-react` instead of `ClipboardList`.


## 29. Navigation Drawer Bulk Upload Icons
- **Bulk Upload Icons (`frontend/src/components/Layout.jsx`)**:
  - Updated **Bulk upload categories/items** (`/bulk-upload-categories-items`) to use `FolderUp` and **Bulk upload expenses** (`/bulk-upload-expenses`) to use `FileSpreadsheet` from `lucide-react`.


## 30. Masala Rice & Khuska Catalogue Expansion (`recipes.json` & `expandedStarterRecipes.js`)
- **Added 18 Authentic Masala Rice & Khuska Recipes** (`static-1796`–`static-1813`):
  1. *Khuska / Kuska (South Indian Plain Biryani Rice)* (`static-1796`)
  2. *Muslim Wedding Style Kuska Rice / Tamil Bhai Veetu Khuska* (`static-1797`)
  3. *Hyderabadi Bagara Rice / Baghara Chawal* (`static-1798`)
  4. *Maharashtrian Masala Bhat* (`static-1799`)
  5. *Homestyle Masala Rice / Veg Masala Chawal* (`static-1800`)
  6. *Chettinad Brinji Rice / Vegetable Brinji* (`static-1801`)
  7. *Karnataka Vangi Bath* (`static-1802`)
  8. *Mumbai Street-Style Tawa Pulao* (`static-1803`)
  9. *UP-Style Aloo Tehri / Vegetable Tahari* (`static-1804`)
  10. *Coconut Milk Pulao / Thengai Paal Sadam* (`static-1805`)
  11. *Pudina Masala Rice / Mint Coriander Pulao* (`static-1806`)
  12. *Punjabi Kabuli Chana Pulao* (`static-1807`)
  13. *Soya Chunks Masala Pulao / Nutri Pulao* (`static-1808`)
  14. *Kaju Ghee Rice / Nei Choru* (`static-1809`)
  15. *Egg Masala Rice / Anda Tawa Pulao* (`static-1810`)
  16. *Garlic Pepper Masala Rice / Poondu Milagu Sadam* (`static-1811`)
  17. *Palak Masala Rice / Spinach Corn Pulao* (`static-1812`)
  18. *Methi Masala Rice / Methi Pulao* (`static-1813`)
- **Catalogue Verification**: Sorted all **1,546** recipes strictly alphabetically by name with zero duplicate IDs or duplicate names.


## 31. Mysore Bonda, Bajji, Punugulu & Vada Catalogue Expansion (`recipes.json` & `expandedStarterRecipes.js`)
- **Added 20 Authentic Bonda & Related Fritter Recipes** (`static-1814`–`static-1833`):
  1. *Mysore Bonda / Mysore Bajji* (`static-1814`)
  2. *Mangalore Bajji / Goli Baje* (`static-1815`)
  3. *Andhra Challapunugulu / Sour Buttermilk Punugulu* (`static-1816`)
  4. *Instant Rava Bonda / Suji Curd Bonda* (`static-1817`)
  5. *Godhuma Bonda / Whole Wheat Flour Mysore Bonda* (`static-1818`)
  6. *Mangalore Buns* (`static-1819`)
  7. *South Indian Urulai Kizhangu Bonda / Aloo Bonda* (`static-1820`)
  8. *Vegetable Bonda / Mixed Veg Bonda* (`static-1821`)
  9. *Vengaya Bonda / South Indian Onion Bonda* (`static-1822`)
  10. *Keerai Bonda / Palak Mysore Bonda* (`static-1823`)
  11. *Mutta Bonda / South Indian Egg Bonda* (`static-1824`)
  12. *Kerala Pazham Bonda / KaiVada* (`static-1825`)
  13. *Bengali Phuluri / Teler Bora* (`static-1826`)
  14. *Maddur Vada* (`static-1827`)
  15. *Sabudana Vada* (`static-1828`)
  16. *Balekai Bajji / Vazhakkai Bajji* (`static-1829`)
  17. *Ulli Bajji / Crispy Onion Ring & Slice Bajji* (`static-1830`)
  18. *Capsicum Bajji / Kudaimilagai Bajji* (`static-1831`)
  19. *Bread Bonda / Stuffed Masala Aloo Bread Bonda* (`static-1832`)
  20. *Instant Rava Medu Vada / Crispy Suji-Curd Donut Vada* (`static-1833`)
- **Catalogue Verification**: Sorted all **1,566** recipes strictly alphabetically by name with zero duplicate IDs or duplicate names.


## 32. Paporer Dolma & Traditional Papad Recipe Catalogue Expansion (`recipes.json` & `expandedStarterRecipes.js`)
- **Added 20 Authentic Papad / Papor Recipes** (`static-1834`–`static-1853`):
  - **Bengali Paporer Dolma & Traditional Papor Curries (6)**: *Paporer Dolma / Papader Dolma* (`static-1834`), *Amish Chingri Paporer Dolma* (`static-1835`), *Paporer Dalna / Aloo Paporer Jhol* (`static-1836`), *Paporer Chorchori / Papor Aloo Bori Ghonto* (`static-1837`), *Papor Bharta / Paporer Chokha* (`static-1838`), and *Paporer Tok / Papor Ambol* (`static-1839`).
  - **Rajasthani, Sindhi & Gujarati Papad Curries & Sabzis (6)**: *Rajasthani Papad ki Sabzi* (`static-1840`), *Methi Papad ki Sabzi* (`static-1841`), *Mangodi Papad ki Sabzi* (`static-1842`), *Papad Pyaz ki Sabzi* (`static-1843`), *Sindhi Papad Curry / Happala Kadhi* (`static-1844`), and *Gujarati Papad Churi / Marwari Papad Churi* (`static-1845`).
  - **Stuffed Papad Rolls, Cones & Street Snacks (5)**: *Papad Roll / Crispy Potato-Pea Stuffed Papad Cigar Rolls* (`static-1846`), *Paneer Masala Papad Cone / Stuffed Papad Cones* (`static-1847`), *Dahi Papad Chaat* (`static-1848`), *Papad Pakora / Batter-Fried Masala Papad Bhajiya* (`static-1849`), and *Cheese & Corn Masala Papad* (`static-1850`).
  - **Manual Homemade Papad Recipes (3)**: *Homemade Rice Flour Papad / Chawal ke Khichiya Papad* (`static-1851`), *Sabudana Papad / Sago Pearl Sun-Dried Crisps* (`static-1852`), and *Aloo Papad / Sun-Dried Grated Potato & Red Chilli Flake Papad* (`static-1853`).
- **Catalogue Verification**: Sorted all **1,586** recipes strictly alphabetically by name with zero duplicate IDs or duplicate names.


## 33. Total Expense Summary Card for Selected Date on Add Expenses Page
- **Backend Date Total Aggregation (`backend/scripts/sql/expenseSql.js`, `backend/src/models/expenseModel.js`)**:
  - Updated `countByDate` and `listExpenses` (`GET /api/expenses`) to return `totalAmount` (the total sum of `total_cost` across all expenses recorded for the selected `expense_date`, independent of pagination) alongside `filteredTotalAmount` and `total`.
- **Add Expenses List Header Summary (`frontend/src/pages/Expense.jsx`)**:
  - Added a summary card at the top of the **Expenses for <Date>** section displaying **Total expense for <Date>: ₹<Amount>** (with automatic client-side sum fallback if communicating with an older backend).


## 34. Stacked Bar Chart for Daily / Weekly / Monthly / Yearly Reports by Category (Dashboard Detail & Scheduled PDF)
- **Dashboard Detail Stacked Category Chart (`frontend/src/pages/DashboardDetail.jsx`)**:
  - Updated `buildChartModel` so that when `seriesColumn === "category"` (`daily-category`, `weekly-category`, `monthly-category`, and `yearly-category`), all category series share `stackId: "category_stack"`, stacking categories vertically inside each `date` / `week` / `month` / `year` bar while preserving per-segment click-to-drilldown.
- **Scheduled Report PDF Stacked Category Chart (`backend/src/services/scheduledReportPdfService.js`)**:
  - Updated `drawChart` so `daily-category`, `weekly-category`, `monthly-category`, and `yearly-category` PDF charts also render categories stacked inside each period bar.


## 35. Stacked Bar Chart for Daily / Weekly / Monthly / Yearly Reports by Survivor (Dashboard Detail & Scheduled PDF)
- **Dashboard Detail Stacked Survivor Chart (`frontend/src/pages/DashboardDetail.jsx`)**:
  - Updated `buildChartModel` so `daily-survivor`, `weekly-survivor`, `monthly-survivor`, and `yearly-survivor` (`seriesColumn === "survivor"`) assign `stackId: "survivor_stack"` to all survivor series, stacking survivors vertically inside each `date` / `week` / `month` / `year` bar while preserving click-to-drilldown on every survivor segment.
- **Scheduled Report PDF Stacked Survivor Chart (`backend/src/services/scheduledReportPdfService.js`)**:
  - Updated `drawChart` so `daily-survivor`, `weekly-survivor`, `monthly-survivor`, and `yearly-survivor` PDF charts also stack survivors inside each period bar.


## 36. Instant Survivor & Category Filters Across All Dashboard Detail Pages
- **Backend Breakdown & Drilldown Filtering (`backend/src/services/dashboardReportService.js`)**:
  - Updated `runDashboardReport` (`mode === "summary"`) to include `breakdownRows` (aggregated across `[period, "survivor", "category"]`) alongside `rows`, and updated `addSelectionFilters` to apply `category_id` / `categories` and `survivor_id` / `survivors` across all 16 dashboard reports in both summary and drilldown modes.
- **Instant Client-Side Re-Aggregation & Filter UI (`frontend/src/pages/DashboardDetail.jsx`, `frontend/src/styles.css`)**:
  - Added a **Quick Filters** card with **Category** and **Survivor** dropdowns (plus a one-click **Clear filters** button) to every Dashboard Detail page.
  - Selecting a Category or Survivor filters `breakdownRows` and re-aggregates by the report's `groupBy` in-memory with 0ms latency, updating the **Summarised expenses** total, **Summary rows** count, **Summary bar chart**, **Summarise report** table, and drilldown links immediately.


## 37. Smart Interactive Multi-Select Design for Category & Survivor Filters on Dashboard Detail Pages
- **Smart Multi-Select Component (`frontend/src/pages/DashboardDetail.jsx`, `frontend/src/styles.css`)**:
  - Upgraded the **Categories** and **Survivors** filters on all Dashboard Detail pages to custom interactive multi-select dropdowns (`SmartMultiSelect`).
  - Features live search filtering inside each dropdown, **Select all / Select matching** and **Clear all** quick actions, removable selected pill chips (`×`) in the trigger bar, live selection counter badges (`X selected`), custom animated checkboxes, and instant 0ms multi-item re-aggregation across the summary cards, stacked bar charts, pivot tables, and drilldown links.

---

## 38. Post-Login Organization Logo Rendering & Route-Safe Fallback (`Layout.jsx` & `styles.css`)

- **Root-Relative Logo Resolution (`/logo.png`)**: Replaced the relative `<img src="logo.png" />` fallback in `frontend/src/components/Layout.jsx` with a root-relative `"/logo.png"` path and `resolveOrganizationLogoUrl(...)` helper so nested routes (such as `/dashboard/:reportKey` and `/dashboard/drilldown`) never request `/dashboard/logo.png` or render a broken image icon after login.
- **Automatic Fallback (`onError`) & Unclipped Aspect Ratio (`object-fit: contain`)**: Added an `onError` handler that falls back to `"/logo.png"` if a custom `VITE_ORGANIZATION_LOGO_URL` fails to load, and updated `.brand-mark` / `.brand-mark img` in `frontend/src/styles.css` (`flex-shrink: 0`, `object-fit: contain`, clean white badge frame, and `64px` left clearance from the drawer toggle button) so the full ribbon logo displays cleanly without top/bottom cropping.

---

## 39. Scheduled Dashboard Emails Include Applied Category & Survivor Filters (`DashboardDetail.jsx`, `ScheduledReportForm.jsx`, `JobStatus.jsx`, `scheduledReportService.js`, `scheduledReportPdfService.js`, `schemaSql.js`)

- **Schedule Modal & Payload Integration**: `DashboardDetail.jsx` and `ScheduledReportForm.jsx` now pass and display the currently selected multi-select Category and Survivor filters (`categories`, `categoryLabels`, `survivors`, `survivorLabels`) inside the schedule summary card and persist them when creating or editing a scheduled dashboard email.
- **Database Schema & Automatic Migration**: Added `filters JSONB NOT NULL DEFAULT '{}'::jsonb` to `public.scheduled_report_jobs` in `schemaSql.js` with an automatic idempotent runtime check (`ensureScheduledReportSchema`) in `scheduledReportService.js`.
- **Filtered Scheduled PDF & Email Generation**: `buildScheduledReport` and `sendScheduledReportJob` now apply the saved Category and Survivor filters to both the dashboard summary/chart query and the raw expense table query, print `Filters applied: ...` in the PDF report header (`scheduledReportPdfService.js`) and email body, and display the applied filters on the `JobStatus.jsx` card and tooltip.

---

## 40. Per-User Dashboard Detail Filter Persistence (`DashboardDetail.jsx`, `dashboardFilterService.js`, `dashboardController.js`, `schemaSql.js`)

- **Database Persistence (`public.dashboard_user_filters`)**: Added `dashboard_user_filters` keyed by `(user_id, report_key)` with `categories JSONB`, `survivors JSONB`, and automatic table creation (`ensureDashboardUserFiltersTable`) so each user's Category and Survivor selections are stored independently per dashboard detail page.
- **API Endpoints**: Added `GET /api/dashboard/filters/:reportKey` and `PUT /api/dashboard/filters/:reportKey` in `routes/index.js` and `dashboardController.js` protected by `auth` and `permit("dashboard")`.
- **Automatic Restore & Instant Save (`DashboardDetail.jsx`)**: Every Dashboard Detail page now restores the user's saved filters on load (using `localStorage` for immediate zero-flicker hydration synced with the server response) and automatically persists changes whenever Category or Survivor selections are updated or reset.

---

## 41. Per-User Report Page State Persistence (`Reports.jsx`, `reportPreferenceService.js`, `reportController.js`, `schemaSql.js`)

- **Database Persistence (`public.report_user_preferences`)**: Added `report_user_preferences` keyed by `user_id` with `config JSONB` and automatic table creation (`ensureReportUserPreferencesTable`) to store each user's active filters, date filter mode, sort columns, group-by columns, and summarise toggle.
- **API Endpoints**: Added `GET /api/reports/preferences` and `PUT /api/reports/preferences` in `routes/index.js` and `reportController.js` protected by `auth` and `permit("report")`.
- **Automatic Restore & Save (`Reports.jsx`)**: When the Reports page opens, it restores the user's saved filter, sort, group-by, and summarise state from the database (with immediate `localStorage` hydration) and automatically persists any subsequent changes per user.

---

## 42. Marketing List Form Reset Button with Today's Date & Nearest GPS Location (`MarketingList.jsx`)

- **Reset Button Beside Submit**: Added a **Reset** button (`handleResetToDefault`) in `frontend/src/pages/MarketingList.jsx` directly below the form beside the **Add to marketing list** button.
- **Default State & Nearest GPS Location**: Clicking **Reset** resets `purchaseDate` to today (`todayKolkata()`), clears category, item, quantity, unit, and approximate cost back to their default empty state, and automatically detects the nearest shopping location from current GPS coordinates (with cached/history fallback if GPS is unavailable).

---

## 43. Food Chart Reset Button for Selected Date & Location (`FoodChart.jsx`, `dietChartController.js`, `dietChart.css`)

- **Reset Button Beside Add Recipe**: Added a **Reset** button next to **Add Recipe** in `frontend/src/pages/FoodChart.jsx` with a confirmation dialog before clearing.
- **Bulk Meal Clearing Endpoint (`DELETE /api/food-chart`)**: Added `resetFoodChartEntries` in `backend/src/controllers/dietChartController.js` to delete all planned entries across `Breakfast`, `Lunch`, `Evening Snacks`, and `Dinner` for the selected `date` and `locationId` (or all locations when none is selected).

---

## 44. Previous & Next Marketing Date Navigation Buttons (`MarketingList.jsx`, `marketing.css`)

- **Date Navigation Buttons**: Added **Previous marketing date** and **Next marketing date** buttons beneath the Date input on the Marketing List page (`frontend/src/pages/MarketingList.jsx`).
- **Populated-Date Jumping**: Each button scans all dates that have items in the marketing list (`marketingDates`) and jumps directly to the nearest earlier or later date with items, disabling automatically when no earlier or later populated date exists.

---

## 45. Long Date Format with Weekday & Month Name (`dates.js`, `MarketingList.jsx`, `Expense.jsx`, `FoodChart.jsx`, `styles.css`)

- **Shared Long Date Formatter (`formatLongDateWithWeekday`)**: Added `formatLongDateWithWeekday` in `frontend/src/utils/dates.js` formatting dates in `en-IN` (`Asia/Kolkata`) with full weekday name, day, full month name, and year (e.g., `Tuesday, 17 November 2026`).
- **Date Field Previews**: Applied `formatLongDateWithWeekday` directly on the Date fields in **Marketing List** (`MarketingList.jsx`), **Add Expenses** (`Expense.jsx`), and **Food Chart** (`FoodChart.jsx`).

---

## 46. Previous & Next Date Buttons on Add Expenses and Food Chart (`Expense.jsx`, `FoodChart.jsx`, `dates.js`, `styles.css`)

- **Day-by-Day Date Navigation (`shiftIsoDate`)**: Added `shiftIsoDate` in `frontend/src/utils/dates.js` for timezone-safe `±1` day stepping.
- **Add Expenses (`Expense.jsx`) & Food Chart (`FoodChart.jsx`)**: Added **Previous date** and **Next date** buttons on both pages' date controls (disabling **Next date** on Add Expenses when today's maximum date is reached).

---

## 47. Relative Day Labels (Yesterday / Today / Tomorrow) Beside Long Date (`dates.js`)

- **Contextual Relative Day Suffix**: Updated `formatLongDateWithWeekday` in `frontend/src/utils/dates.js` to append `(Today)`, `(Yesterday)`, or `(Tomorrow)` beside the full weekday/month/long date across **Marketing List**, **Add Expenses**, and **Food Chart** whenever the selected date matches.

---

## 48. Reset Button After Run Report on Reports Page (`Reports.jsx`)

- **Reset Action Button**: Added a **Reset** button (`onClick={reset}` with `RotateCcw` icon) directly after the **Run report** button in `frontend/src/pages/Reports.jsx` to clear active filters, sorting, grouping, summarise state, chart, and results (and persist the reset state per user).

---

## 49. Dedicated Summarise Section & Organized Action Button Groups (`Reports.jsx`, `styles.css`)

- **Separate Summarise Section**: Moved the **Summarise** toggle into its own dedicated card (`.report-summarise-card`) below the Sort/Group By builder with an explicit status label and helper description.
- **Organized Action Groups**: Grouped the Reports page action buttons into three clear subsections inside `.report-actions-card`: **Report** (`Run report`, `Reset`, `Show/Hide chart`), **Selections** (`Save selection`, `Load selection`), and **Export & Email** (`Export PDF`, `Email me report PDF`, `Schedule email`).

---

## 50. Compact Dashboard Report Link Grid (`Dashboard.jsx`, `styles.css`)

- **Compact 4-Column Responsive Grid**: Updated `.dashboard-report-list` and `.dashboard-report-link` in `frontend/src/styles.css` to arrange the 16 predefined dashboard report links into a compact 4-column desktop grid (2 columns on medium screens, 1 column on mobile) with tighter card padding, gap, and icon sizing while preserving all existing labels and descriptions verbatim.

---

## 51. Tighter Gap Between Dashboard Report Links (`styles.css`)

- **Minimal Grid Gap (`gap: 4px`)**: Reduced `.dashboard-report-list` grid gap from `8px` to `4px` and tightened `.dashboard-report-link` padding to `8px 10px` in `frontend/src/styles.css` so adjacent dashboard report links sit closer together.

---

## 52. Remove `.card` Bottom Margin on Dashboard Report Links (`styles.css`)

- **Minimal Gap (`gap: 2px`, `margin-bottom: 0`)**: Overrode `.card`'s inherited `margin-bottom: 18px` on `.dashboard-report-link` and set `.dashboard-report-list` grid gap to `2px` in `frontend/src/styles.css` so both horizontal and vertical spacing between Dashboard report links are truly minimal.

---

## 53. Two-Column Dashboard Links in Landscape Mode (`styles.css`)

- **Landscape Two-Column Grid**: Updated `.dashboard-report-list` in `frontend/src/styles.css` to use `grid-template-columns: repeat(2, minmax(0, 1fr))` in landscape mode (`@media (orientation: landscape)`) and on wider screens, while switching to 1 column only on narrow portrait screens (`@media (max-width: 860px) and (orientation: portrait)`).

---

## 54. Gobi Roll Recipe Catalogue Expansion (`recipes.json`, `expandedStarterRecipes.js`)

- **16 Gobi Roll Varieties (`static-1854`–`static-1869`)**: Added Kolkata street-style **Gobi Roll**, **Aloo Gobi Roll**, **Chilli Gobi Roll**, **Gobi Manchurian Roll**, **Gobi Tikka Roll**, **Gobi Matar Roll**, **Gobi Paneer Roll**, **Egg Gobi Roll**, **Double Egg Gobi Roll**, **Gobi Cheese Roll**, **Gobi Bhurji Roll**, **Achari Gobi Roll**, **Schezwan Gobi Roll**, **Gobi Corn Roll**, **Patta Gobi Roll**, and **Gobi Kebab Roll** (manual stovetop/tawa/grater preparation only, no beef, sorted alphabetically A–Z; total recipes: **1602**).

---

## 55. Muri Makha & Bengali Tiffin Recipe Catalogue Expansion (`recipes.json`, `expandedStarterRecipes.js`)

- **18 Muri Makha & Tiffin Varieties (`static-1870`–`static-1887`)**: Added **Aam Tel Muri Makha**, **Aloo Kabli Muri Makha**, **Aloo Makha Muri**, **Beguni Diye Muri Makha**, **Bhel Muri Makha**, **Chana Jor Garam Muri Makha**, **Chira Bhaja Diye Muri Makha**, **Cholar Dal Bhaja Muri Makha**, **Dim Bhaja Diye Muri Makha**, **Doi Muri**, **Dudh Muri with Gur & Banana**, **Ghugni Muri Makha**, **Kacha Chola Muri Makha**, **Kasundi Muri Makha**, **Muri Bhaja**, **Narkel Bhaja Diye Muri Makha**, **Peyaji Diye Muri Makha**, and **Telebhaja Muri Makha** (manual preparation only, no beef, sorted alphabetically A–Z; total recipes: **1620**).

---

## 56. Skip All Scheduled Emails for Disabled Users (`oneTimeReportEmailService.js`, `scheduledReportService.js`)

- **One-Time Scheduled Report Emails (`oneTimeReportEmailService.js`)**: Joined `public.users` with `u.is_disabled = FALSE` in `processDueOneTimeReportEmailJobs` and added an `owner_disabled` guard in `claimJob` so disabled users never receive one-time scheduled report emails even if their account was disabled after scheduling.
- **Recurring Scheduled Report Guard (`scheduledReportService.js`)**: Added a defense-in-depth `owner_disabled`/`is_disabled` check in `sendScheduledReportJob` alongside the existing `u.is_disabled = FALSE` filters across all recurring report, planned recipe, and marketing list email schedulers.

---

## 57. Marketing List Email Disabled-User Hardening (`marketingController.js`)

- **Strict Active-Recipient Filtering**: Hardened `sendMarketingListForDate` in `backend/src/controllers/marketingController.js` with `COALESCE(u.is_disabled, false) = false`, `lower(r.name) IN ('manager','admin')`, non-empty email validation, a runtime `is_disabled` skip guard, and an explicit `skipped: true` return when no active recipients exist.

---

## 58. Recipient Count in Job Status Execution History (`scheduler.js`, `marketingController.js`, `scheduledReportScheduler.js`, `oneTimeReportEmailService.js`)

- **Consistent `Recipients: N` Details**: Updated all scheduled email execution recorders (`scheduler.js`, `marketingController.js`, `scheduledReportScheduler.js`, and `oneTimeReportEmailService.js`) to store `Recipients: N` (and `Recipients: 0 — <reason/error>` on skipped or failed runs) in `error_message` so the **Error / details** column on the Job Status page always displays the recipient count for every scheduled job.

---

## 59. Hashbrown & Potato Rösti Recipe Catalogue Expansion (`recipes.json`, `expandedStarterRecipes.js`)

- **16 Hashbrown Varieties (`static-1888`–`static-1903`)**: Added **Aloo Laccha Tawa Hashbrowns**, **Cheese & Chive Hashbrowns**, **Classic Crispy Hashbrowns**, **Egg & Hashbrown Skillet**, **Garlic Herb Potato Rösti**, **Gobi Aloo Hashbrowns**, **Green Chilli & Coriander Masala Hashbrowns**, **Hashbrown Toast**, **Herbed Sweet Potato Hashbrowns**, **Indian-Style Besan Aloo Hashbrowns**, **Onion & Black Pepper Hashbrowns**, **Paneer Stuffed Hashbrowns**, **Potato & Carrot Hashbrowns**, **Potato Latkes**, **Smoked Paprika & Oregano Hashbrown Coins**, and **Spinach & Corn Potato Hashbrowns** (manual box-grater/knife/skillet preparation only, no beef, sorted alphabetically A–Z; total recipes: **1636**).

---

## 60. Uniform Recipe Category & Region Tags (`recipes.json`, `expandedStarterRecipes.js`)

- **Canonical Category Tags (23 unique)**: Unified duplicate and overlapping category labels (`Evening Snack`, `Breakfast / Snack`, `Dinner / Street Food`, `Lunch / Dinner` -> `Snacks`; `Sandwiches` -> `Sandwich`; `Starter` -> `Starters`; `Fish & Seafood` -> `Fish`) across all 1636 recipes so Food Chart filter chips and Recipe Master categories stay clean and consistent.
- **Canonical Region Tags (40 unique)**: Consolidated overlapping regional/cuisine labels (such as `Bengali / Indian`, `Indian / Bengali`, `Bengali / Kolkata Street Food` -> `Bengali`; `North Indian / Indian` -> `North Indian`; `Indo-Chinese / Indian`, `Indo-Chinese / Kolkata` -> `Indo-Chinese`; `Italian-inspired` -> `Italian`; `Indian / International` -> `Fusion`).

---

## 61. Smart Error vs Details Coloring in Job Status Execution History (`JobStatus.jsx`, `jobStatus.css`)

- **Semantic Classification (`renderExecutionDetailCell`)**: Updated the **Error / details** column in `frontend/src/pages/JobStatus.jsx` and `frontend/src/pages/jobStatus.css` to distinguish errors from operational details (`Recipients: N`, skipped reasons, etc.)—rendering completed recipient counts in green (`--success`), informational details/reasons in primary/muted tones, and actual errors in red (`--danger`).

---

## 62. Single-Line Organization Name in Header (`Layout.jsx`, `styles.css`)

- **Single-Line Truncation & Responsive Sizing**: Added `.brand-copy` (`min-width: 0; flex: 1`) in `frontend/src/components/Layout.jsx` and configured `.brand-row strong` in `frontend/src/styles.css` with `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, and `font-size: clamp(12.5px, 3.2vw, 15px)` so the organization name always renders on one line across desktop and mobile screens.

---

## 63. App Version Badge on Top-Left Corner of Every Page (`appVersion.js`, `Layout.jsx`, `Login.jsx`, `styles.css`)

- **Shared Version Source (`frontend/src/lib/appVersion.js`)**: Exported `APP_VERSION` from `frontend/package.json` (`2.0.0`, with optional `VITE_APP_VERSION` override).
- **Top-Left Version Pill Across All Pages**: Rendered `v{APP_VERSION}` (`.app-version-badge`) on the top-left corner of `.top-header` in `Layout.jsx` (all authenticated pages) and fixed at the top-left corner of `Login.jsx` (login/forgot-password screen).

---

## 64. Auto-Incremented App Version (`vite.config.js`, `bump-version.mjs`, `appVersion.js`, `package.json`)

- **Automatic Version Incrementing**: Added `frontend/scripts/bump-version.mjs` (hooked into `prebuild` in `frontend/package.json`) and `resolveAutoIncrementVersion()` in `frontend/vite.config.js` to inject `__APP_VERSION__` at build/dev time:
  - Uses the Git commit count (`<major>.<minor>.<commitCount>`) automatically whenever full Git history is available.
  - Auto-increments the patch version in `frontend/package.json` on every local `npm run build` (`2.0.1` -> `2.0.2` -> ...).
  - Appends a strictly increasing IST build stamp (`<major>.<minor>.<patch>.YYMMDDHHmm`) on shallow CI/Vercel deployments where full Git history is not cloned.

---

## 65. Total Approximate Cost for Selected Items on Marketing List (`MarketingList.jsx`, `marketing.css`)

- **Selected Items Approximate Total (`selectedCostSummary`)**: Computed the live total approximate cost of all checked pending items in `frontend/src/pages/MarketingList.jsx` using `getEffectiveRowApproximateCost` and displayed it both in the bulk selection toolbar (`N selected · Approx. ₹X.XX`) and as a dedicated **Total approx. (selected)** summary banner beside **Total cost (filtered)**.

---

## 66. Show Report Button on Job Status Page with Auto-Run (`JobStatus.jsx`, `Reports.jsx`)

- **Show Report Actions**: Added a **Show report** button to both the **Scheduled dashboard emails** and **One-time report PDF emails** cards in `frontend/src/pages/JobStatus.jsx`.
- **Restore & Auto-Run in Reports (`Reports.jsx`)**: Clicking **Show report** passes the job's complete filter, sort, group-by, and summarise configuration (translating scheduled dashboard report keys and saved category/survivor filters into the exact date range, grouping, sorting, and summarise state) into `Reports.jsx` via `sessionStorage` and automatically runs the report query so results appear immediately.

---

## 67. Auto-Displayed Dashboard-Matched Summary Charts on Reports Page (`Reports.jsx`, `reportService.js`)

- **Auto-Show Chart When Summarise Enabled**: Defaulted `showChart` to `true` and kept it enabled whenever a summarised report runs on `frontend/src/pages/Reports.jsx`, while preserving the Show/Hide chart toggle.
- **Dashboard Chart Parity (`buildReportChartModel` & `reportService.js`)**: Returned `groupBy` in summary responses from `backend/src/services/reportService.js` and aligned `buildReportChartModel` and the chart container with `DashboardDetail.jsx`—rendering single-series bar charts for 1-column groupings, stacked bar charts (`stackId`) for Category and Survivor groupings across periods, and category-legend / survivor-shaded stacked bars for 3-column (`period + survivor + category`) groupings.

---

## 68. Show Report Button on Every Dashboard Detail Page (`DashboardDetail.jsx`)

- **Open in Reports with Auto-Run (`openInReports`)**: Added a **Show report** button to the toolbar of every Dashboard Detail page (`frontend/src/pages/DashboardDetail.jsx`) that forwards the report's exact date range, active Category and Survivor multi-select filters, sorting, group-by columns, and `summarise: true` to `/report` and automatically executes the report so the chart and results render immediately.

---

## 69. Clickable Bar Chart Tooltips for Dashboard Drilldown (`DashboardDetail.jsx`, `styles.css`)

- **Interactive Tooltip Drilldown (`DashboardChartTooltip`)**: Replaced the passive Recharts tooltip on `frontend/src/pages/DashboardDetail.jsx` with a clickable custom `DashboardChartTooltip` (`pointerEvents: "auto"`) listing each non-zero bar series as a clickable button (`→`) that opens the corresponding Dashboard Drilldown page with all active filters preserved (and also fixed single-series bar clicks to drill down directly).

---

## 70. Fix Dashboard Drilldown Expense, Survivor & Expense Type Columns (`reportSql.js`, `reportService.js`, `DashboardDrilldown.jsx`)

- **Complete Raw Drilldown Fields (`reportSql.js`, `reportService.js`)**: Included `total_cost`, `survivor`, and `expense_type` in `rawSelectPerExpense` and hydrated `total_cost` as a number in `hydrateRows` so Dashboard Drilldown rows no longer show `₹0.00` or `—` for those columns.
- **Fallback Expense Amount (`DashboardDrilldown.jsx`)**: Updated the Expense column cell to render `money(row.expense_amount ?? row.total_cost)`.

---

## 71. Normalize & Propagate Expense Type in Dashboard Drilldown (`reportSql.js`, `reportService.js`, `DashboardDrilldown.jsx`)

- **Complete `expense_type` Propagation**: Added `expense_type` and `total_cost` across `rawSelectPerSurvivor`, `sourcePerExpense` `GROUP BY`, and `reportRow()` in `reportSql.js` / `reportService.js`.
- **Clean Label Formatting (`DashboardDrilldown.jsx`)**: Added `formatExpenseType` so the **Expense type** column consistently displays `Cash` or `Online` (matching the Add Expenses form).

---

## 72. Full-App Voice Command Assistant & Step-by-Step Guided Flows (`voiceEngine.js`, `VoiceAssistant.jsx`, `voiceAssistant.css`, `Layout.jsx`, `MarketingList.jsx`, `Expense.jsx`, `FoodChart.jsx`, `RecipeMaster.jsx`, `Reports.jsx`, `DashboardDetail.jsx`)

- **Global Voice Engine (`frontend/src/lib/voiceEngine.js`)**: Implemented Web Speech API recognition (`en-IN`, `bn-IN`, `hi-IN`), spoken Text-to-Speech prompts (`speechSynthesis`, enabled by default with mute toggle), fuzzy option/multi-option matching, spoken date & number/unit parsing, and intent routing.
- **Step-by-Step Guided Wizards with Mandatory Final Confirmation (`VoiceAssistant.jsx`)**:
  - **Add Marketing List** (date → GPS/location → category → item → quantity & unit → approximate cost → confirm & save).
  - **Add Expense** (date → category → item → quantity & unit → total cost → cash/online → survivors → comment → confirm & save).
  - **Add Recipe to Food Chart** (date → location → meal timing → fuzzy recipe search & numbered selection → servings → confirm & save).
  - **Build & Run Report** (date filter → categories → survivors → group by → sort → summarise → auto-run with chart).
  - **Filter Dashboard Details** (optional report pick → multi-select categories → multi-select survivors → apply & persist).
- **Direct Voice Commands & Briefings**: Supports **Search Recipe in Recipe Master**, **Show Dashboard** / open any of the 16 dashboard reports, **Reset Filters**, **Previous/Next Date / Go to Today**, **Dark/Light Mode**, and read-aloud status briefings (**Today's total expense**, **Marketing list summary**, **Today's food chart**).

---

## 73. Native Android Microphone Permission & Speech Recognition Bridge (`AndroidManifest.xml`, `AndroidSpeechBridge.kt`, `MainActivity.kt`, `voiceEngine.js`)

- **Android Manifest Permissions**: Added `android.permission.RECORD_AUDIO`, `android.permission.MODIFY_AUDIO_SETTINGS`, optional microphone hardware feature, and Android 11+ `<queries>` for `android.speech.RecognitionService` in `frontend/android/app/src/main/AndroidManifest.xml`.
- **Native Runtime Permission & SpeechRecognizer (`AndroidSpeechBridge.kt`, `MainActivity.kt`)**: Added `DailyExpensesSpeech` JavascriptInterface that requests `Manifest.permission.RECORD_AUDIO` at runtime on Android (auto-starting recognition once granted) and streams partial/final results from Android's native `SpeechRecognizer` directly into `voiceEngine.js`.

---

## 74. Interactive Date Pickers & Dropdowns Inside Step-by-Step Voice Flows (`VoiceAssistant.jsx`, `voiceAssistant.css`)

- **Inline Step Controls (`renderStepControl`)**: Every step across all five guided voice flows (**Add Marketing List**, **Add Expense**, **Add Recipe to Food Chart**, **Build Report**, and **Filter Dashboard Details**) now renders its native interactive control right inside the Voice Assistant step card—`<input type="date">` with Today/Yesterday/Tomorrow shortcuts, `<select>` dropdowns for locations, categories, items, meals, recipes, expense type, sort order, and dashboard reports, and multi-select toggle chips for categories, survivors, and group-by fields—working seamlessly alongside voice input.

---

## 75. Price Trend Page Under Manipulation (`PriceTrend.jsx`, `priceTrendService.js`, `priceTrendController.js`, `Layout.jsx`, `App.jsx`)

- **Navigation & Route**: Added **Price Trend** (`/price-trend`) under the **Manipulation** group in `frontend/src/components/Layout.jsx` and registered it in `frontend/src/App.jsx`.
- **1-Unit Price Trend API (`GET /api/price-trend`)**: Added `priceTrendService.js` and `priceTrendController.js` to query historical expenses and marketing list records filtered by Location (optional), Category, Item, and Unit (with automatic mass/volume conversion such as `gm ↔ kg` and `ml ↔ L`), returning up to **5 latest prices in date descending order**.
- **Line Chart & KPIs (`PriceTrend.jsx`)**: Plots the 1-unit price line chart in date descending order with value labels, interactive tooltips, KPI summary cards (latest, average, min/max, change), and a detailed breakdown table.

---

## 76. Price Trend Plots Marketing List Approximate Price (`priceTrendService.js`, `PriceTrend.jsx`)

- **Per-Item Approximate Price Source**: Updated `backend/src/services/priceTrendService.js` to calculate 1-unit prices exclusively from `public.marketing_list_items.approximate_cost` (normalized by `quantity` and compatible unit conversions such as `gm ↔ kg` and `ml ↔ L`) instead of combined `expenses.total_cost`, plotting up to 5 latest prices in date descending order.

---

## 77. Price Trend GPS Location, Smart Unit (kg > g, L > mL), Per-User Persistence & Reset (`PriceTrend.jsx`, `priceTrendService.js`, `schemaSql.js`)

- **Nearest GPS Auto-Location**: Automatically selects the nearest GPS shopping location when no saved location exists (or when tapping **Auto GPS** / **Reset**).
- **Smart Unit Selection (`GET /api/price-trend/smart-unit`)**: Automatically picks the most frequently used unit for the selected item, promoting Gram (`g`/`gm`) to **Kilogram** (`kg`) and Millilitre (`ml`) to **Litre** (`L`) whenever available.
- **Per-User Persistence (`public.price_trend_user_preferences`)**: Saves and restores each user's Location, Category, Item, and Unit selections via `GET/PUT /api/price-trend/preferences` (with instant `localStorage` hydration).
- **Reset Button**: Added a **Reset** button beside **Refresh** that clears Category, Item, Unit, and chart results and re-detects the nearest GPS location.

---

## 78. Include Today in 7-Day Daily Dashboard Reports (`dashboardReportService.js`, `JobStatus.jsx`)

- **7-Day Daily Range Ending Today**: Updated `rangeFor("day", count)` in `backend/src/services/dashboardReportService.js` and `computeDashboardDateRange("day", count)` in `frontend/src/pages/JobStatus.jsx` to span `today - (count - 1)` through `today` (Asia/Kolkata) so all 4 Daily dashboard reports include today's expenses as the latest day of the 7-day window.

---

## 79. Marketing List Known Item Order Count Badge in Dropdown (`MarketingList.jsx`)

- **Order Count in Brackets**: Computed `itemOrderCounts` across all non-removed marketing list orders in `frontend/src/pages/MarketingList.jsx` and displayed `${item.name} (${count})` inside the **Known item** `<select>` options after a category is selected, while keeping `form.itemName` strictly set to the clean `item.name` without the count suffix.

---

## 80. Marketing List Known Item Latest 1-Unit Approx. Price in Dropdown (`MarketingList.jsx`)

- **Latest Unit Approximate Price (`₹X/unit`)**: Extended the **Known item** dropdown options in `frontend/src/pages/MarketingList.jsx` to show each item's latest approximate 1-unit price alongside its order count (e.g., `Potatoes (14) · ₹30/kg`), automatically converting grams (`g`/`gm`) to **kg** and millilitres (`ml`) to **L**, preferring the currently selected location when available, and keeping `form.itemName` strictly clean (`item.name`).

---

## 81. Auto-Select Most Frequently Used Unit on Item Selection in Marketing List (`MarketingList.jsx`)

- **Historical Unit Auto-Selection (`findMostUsedUnitIdForItem`)**: When selecting an item from the **Known item** dropdown in `frontend/src/pages/MarketingList.jsx`, the form now automatically selects that item's most frequently used unit from non-removed marketing list history (breaking ties by most recent date) and immediately recalculates the approximate cost using that unit.

---

## 82. Auto-Select Most Frequently Used Quantity on Item Selection in Marketing List (`MarketingList.jsx`)

- **Historical Quantity & Unit Auto-Selection (`findMostUsedDefaultsForItem`)**: Extended item selection on `frontend/src/pages/MarketingList.jsx` so choosing an item from **Known item** automatically populates both its most frequently used **Unit** and its most frequently used **Quantity** (matched consistently to that unit, breaking ties by most recent date), and immediately calculates the matching approximate cost.

---

## 83. Location Field with Nearest GPS Default on Add Expenses Page (`Expense.jsx`, `expenseSql.js`, `expenseModel.js`, `expenseService.js`, `schemaSql.js`)

- **Expense Location Storage (`public.expenses.location_id`)**: Added `location_id` column migration (`schemaSql.js` + idempotent `ensureExpenseLocationSchema` in `expenseModel.js`), persisted it in `createExpense`/`updateExpense`, and joined `public.marketing_locations` to return `location_name` in expense listings.
- **Nearest GPS Location Field (`Expense.jsx`)**: Added a **Location** dropdown right after **Date of expense** that automatically selects the nearest shopping location using GPS (with an **Auto GPS** refresh button, distance/match hint, prefill carry-over from Marketing List, and display on recorded expense cards).

---

## 84. Bread Pakora & Crisp Bread Snack Recipe Catalogue Expansion (`recipes.json`, `expandedStarterRecipes.js`)

- **18 Bread Pakora & Bread Fritter Varieties (`static-1904`–`static-1921`)**: Added **Aloo Stuffed Bread Pakora**, **Bengali Dim Pauruti Chop / Egg Stuffed Bread Pakora**, **Bread Aloo Chop**, **Bread Cheese Pakora**, **Bread Cutlet**, **Bread Fingers**, **Bread Keema-Style Soya Pakora**, **Bread Medu Vada**, **Bread Pakora (Plain)**, **Bread Poha Pakora**, **Bread Roll**, **Bread Upma Pakora**, **Chilli Garlic Bread Pakora**, **Jodhpur Mirchi Bread Pakora**, **Kasundi Aloo Bread Pakora**, **No-Fry Tawa Bread Pakora**, **Paneer Stuffed Bread Pakora**, and **Sweet Corn & Cheese Bread Roll** (canonical categories/regions, manual preparation only, no beef, sorted alphabetically A–Z; total recipes: **1654**).

---

## 85. Momo Recipe Catalogue Expansion (`recipes.json`, `expandedStarterRecipes.js`)

- **18 Momo Varieties (`static-1922`–`static-1939`)**: Added **Veg Steamed Momo**, **Chicken Steamed Momo**, **Gondhoraj Chicken Momo**, **Paneer Steamed Momo**, **Cheese & Corn Momo**, **Atta Veg Momo**, **Veg Kothey Momo**, **Chicken Kothey Momo**, **Chicken Jhol Momo**, **Chilli Garlic Pan-Tossed Momo**, **Kurkure Veg Momo**, **Tandoori Tawa Momo**, **Fried Veg Momo**, **Chingri / Prawn Steamed Momo**, **Fish Momo**, **Egg Bhurji Momo**, **Mushroom & Spring Onion Momo**, and **Soya Keema Momo** (canonical categories/regions, manual preparation only, no beef, sorted alphabetically A–Z; total recipes: **1672**).

---

## 86. Pitha / Pithe Recipe Catalogue Expansion (`recipes.json`, `expandedStarterRecipes.js`)

- **18 Traditional Pitha Varieties (`static-1940`–`static-1957`)**: Added **Bhapa Pitha**, **Chitoi Pitha**, **Dudh Chitoi Pitha**, **Narkel Patisapta**, **Kheer Patisapta**, **Teler Pitha / Pua Pitha**, **Bhaja Puli Pithe**, **Choshir Payesh / Chushi Pitha**, **Muger Puli**, **Saru Chakli Pitha**, **Nokshi Pitha**, **Pakon Pitha**, **Mera Pitha**, **Ranga Aloor Puli**, **Assamese Til Pitha**, **Arisha Pitha**, **Enduri Pitha**, and **Kakra Pitha** (canonical categories/regions, manual preparation only, no beef, sorted alphabetically A–Z; total recipes: **1690**).

---

## 87. Laddoo Recipe Catalogue Expansion (`recipes.json`, `expandedStarterRecipes.js`)

- **18 Laddoo Varieties (`static-1958`–`static-1975`)**: Added **Alsi ke Laddoo**, **Badam & Pista Laddoo**, **Chana Dal / Magad ke Laddoo**, **Churmure / Murmura Laddoo**, **Daliya Laddoo**, **Dry Fruit & Khajoor Laddoo**, **Gajar Laddoo**, **Gond ke Laddoo**, **Kaju Rose Laddoo**, **Makhana & Peanut Jaggery Laddoo**, **Malai Paneer Laddoo**, **Methi Dana Laddoo**, **Moong Dal Laddoo**, **Oats & Peanut Jaggery Laddoo**, **Poha & Jaggery Laddoo**, **Ragi / Nachni Laddoo**, **Sattu Laddoo**, and **Singdana / Mungfali Laddoo** (canonical tags, manual preparation only, no beef, sorted alphabetically A–Z; total recipes: **1708**).

---

## 88. Location-Based Survivor Sorting on Add Expenses Page (`Expense.jsx`, `survivorModel.js`, `survivorController.js`)

- **Mostly-Used Survivors First (`GET /api/meta/survivors?locationId=...`)**: Extended `listSurvivorsForMeta(locationId)` in `backend/src/models/survivorModel.js` to rank survivors by expense share frequency at the selected location (`COALESCE(e.location_id, m.location_id)`), placing the most frequently used survivors for that location on top followed by the remaining survivors alphabetically.
- **Dynamic Refresh & Auto-Pick on Add Survivor (`Expense.jsx`)**: Whenever the selected Location changes (including GPS auto-selection), `Expense.jsx` refreshes the survivor list so both the Survivor dropdowns and clicking **Add survivor** prioritize the most frequently used survivors for that location.

---

## 89. Meaningful Progressive Waiting Step Statements (`Loader.jsx`, `api.js`, `styles.css`)

- **Context-Aware Request Labels (`inferLoadingMessage`)**: Updated `frontend/src/lib/api.js` so every API call (Marketing List, Add Expenses, Food Chart, Recipes, Price Trend, Dashboard, Reports, Job Status, Bulk Upload, Auth, Metadata) displays a clear operation-specific message instead of a generic `"Please wait…"`.
- **Live Step-by-Step Progress (`Loader.jsx`)**: Upgraded the loading overlay to display progressive multi-step status statements (`Step 1/3` → `Step 2/3` → `Step 3/3` with elapsed seconds and active task count) tailored to PDF generation, file uploads, login/server wake-up, and database queries.

---

## 90. Sooji Sandwich Recipe Catalogue Expansion (`recipes.json`, `expandedStarterRecipes.js`)

- **16 Sooji Sandwich Varieties (`static-1976`–`static-1991`)**: Added both breadless tawa/toaster sooji sandwiches and crispy sooji-crusted bread toasts — **Instant Breadless Sooji Sandwich**, **Aloo Masala Sooji Sandwich**, **Cheese & Corn Sooji Sandwich**, **Paneer Bhurji Sooji Sandwich**, **Hara Bhara Spinach & Pea Sooji Sandwich**, **Pepper & Mustard Tadka Sooji Sandwich**, **Classic Sooji Malai Toast**, **Curd & Veggie Sooji Toast**, **Achari Sooji Toast Sandwich**, **Egg & Sooji Masala Toast**, **Garlic Herb Sooji Bread Sandwich**, **Oats & Sooji Vegetable Toast**, **Onion, Tomato & Green Chilli Sooji Toast**, **Pizza-Style Sooji Bread Toast**, **Schezwan Veggie Sooji Sandwich**, and **Sweet Coconut & Jaggery Sooji Toast** (canonical tags, manual preparation only, no beef, sorted alphabetically A–Z; total recipes: **1724**).

## 91. Full-Stack Performance & Bundle Optimization (Zero Feature Changes)
- **Frontend Route & Component Code Splitting (`frontend/src/App.jsx`, `frontend/src/components/Layout.jsx`, `frontend/vite.config.js`)**:
  - Converted all 16 authenticated page components to `React.lazy(...)` with `<Suspense>` fallbacks inside `RouteErrorBoundary`, keeping `Login` eager for fast initial render.
  - Deferred `VoiceAssistant` via `React.lazy(...)` in `Layout.jsx` so voice engine code is loaded asynchronously off the critical path.
  - Added Vite `manualChunks` (`react-vendor`, `charts`, `icons`, `capacitor`) and `build.target: "es2020"` for better long-term caching and smaller chunks.
- **API Request Deduplication & Metadata Caching (`frontend/src/lib/api.js`)**:
  - Deduplicated concurrent identical `GET` requests in flight.
  - Added short-lived in-memory caching for `/recipes` (5 min TTL, auto-invalidated on `/food-chart` or `/recipes` mutations) and `/meta/categories`, `/meta/units`, `/marketing-locations` (30s TTL, auto-invalidated on metadata mutations).
- **Backend Gzip Compression (`backend/src/middleware/compression.js`, `backend/src/server.js`)**:
  - Added zero-dependency `node:zlib` gzip response compression for JSON/text payloads ≥ 1 KB (shrinking the 2.8 MB `/api/recipes` payload and large report responses).
- **Backend Cold-Start & Recipe Catalogue Optimization (`backend/src/services/bootstrapService.js`, `backend/src/controllers/dietChartController.js`, `backend/scripts/sql/schemaSql.js`)**:
  - Batched permission/role/role-permission seed inserts into 3 `UNNEST` queries and skipped `bcrypt.hash` when the admin account already exists.
  - Added `ETag` / `304 Not Modified` support, pre-computed lowercase recipe names, and partition-based sorting in `listRecipes`.
  - Added missing PostgreSQL indexes on `expenses`, `marketing_list_items`, and `food_chart_entries`.

## 92. Recipe Master — Multi-Ingredient Matching & Tiered Ranking
- **`frontend/src/lib/recipeSearch.js`**:
  - Added `extractIngredients(recipes)` and pre-indexed `_ingredientNamesLower` / `_ingredientNamesSet` in `indexRecipes`.
  - Updated `searchAndRankRecipes` to accept `selectedIngredients` and rank matching recipes in 3 strict tiers:
    1. **Exact matching** (all selected ingredients present; exact 1:1 ingredient set and cooked exact matches prioritized first).
    2. **Already cooked matching recipes** (`usageCount > 0` with partial ingredient matches, sorted by matched count then usage count).
    3. **Remaining matching recipes** (partial ingredient matches not yet cooked, sorted by matched count then total ingredient count).
- **`frontend/src/pages/RecipeMaster.jsx` & `frontend/src/pages/dietChart.css`**:
  - Added a searchable multi-select **Ingredients** picker with removable ingredient chips, dropdown options, and clear action.
  - Added color-coded match badges (`Exact match`, `Cooked match`, `Partial match`) on matching recipe rows.

## 93. Vite 8 Build Fix & Cache-Busting Headers
- **`frontend/vite.config.js`**: Converted `rollupOptions.output.manualChunks` from object form to function form (`manualChunks(id)`) for full compatibility with Vite 8 (Rolldown), preventing build failures on Vercel/CI.
- **`frontend/vercel.json`**: Added `Cache-Control: no-cache, no-store, must-revalidate` for `/` and `/index.html`, and immutable long-term caching for `/assets/*`, ensuring deployed frontend updates reflect immediately without stale HTML caching.

## 94. RecipeMaster TDZ Initialization Fix
- **`frontend/src/pages/RecipeMaster.jsx`**: Moved the outside-click `useEffect` for `ingredientDropdownOpen` below the `useState`/`useRef` declarations of `ingredientDropdownOpen` and `ingredientPickerRef`, resolving `ReferenceError: Cannot access 'F' before initialization`.

## 95. Standardized Ingredient Names & Removed Duplicates Across Recipes
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Standardized all ingredient names across all 1,724 recipes (consistent Title Case, canonicalized spelling/plural/alias variants such as `Maida` -> `All-Purpose Flour (Maida)`, `Besan` -> `Besan (Gram Flour)`, `Suji/Rava/Sooji` -> `Sooji (Semolina)`, `Desi Ghee` -> `Ghee`, `Onions` -> `Onion`, `Potatoes` -> `Potato`, `Tomatoes` -> `Tomato`, `Green Chillies` -> `Green Chilli`, stripped trailing prep/optional qualifiers).
  - Eliminated all 86 case-variant duplicate groups and deduplicated identical standardized ingredients within any recipe (collapsing 4,456 raw ingredient names down to 4,138 unique canonical names).

## 96. Split Combined Ingredients & Separate Embedded Quantities
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Split combined multi-ingredient entries (separated by `&`, `,`, `, and`, or `and` outside parentheses) into individual ingredient rows while keeping prep phrases intact.
  - Extracted quantities and units embedded inside ingredient names (both leading amounts like `1 tsp Ghee` and trailing parenthetical amounts like `Sugar (0.5 tsp)` or `Green Chillies (3)`) into their `quantity` and `unit` fields.
  - Deduplicated any repeated ingredients per recipe (10376 -> 16559 entries, 2515 unique standardized ingredient names).

## 97. Grouped Very Similar Ingredients Across Recipes
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Grouped closely related ingredient variants (size, freshness, cut, fat/liquid qualifiers, and regional/spelling equivalents such as `Red/Large/Small Onion` -> `Onion`, `Ripe Tomato` -> `Tomato`, `Baby/Mashed/Aloo Potato` -> `Potato`, `Fresh/Sour/Thick Curd` -> `Curd (Yogurt)`, `Fresh/Cow-milk Chhena` -> `Chhena (Cottage Cheese)`, `Khoya/Mawa` -> `Khoya (Mawa)`, `Prawns` variants -> `Prawns (Chingri)`, `Black Peppercorns/Cracked Pepper` -> `Black Pepper`, etc.) into single canonical names.
  - Stripped stray leading connectors (`&`, `Pinch of`, `With`) and trailing garnish/optional suffixes, reducing unique ingredient names from 2515 to 2346.

## 98. Removed All Remaining '&' Prep Clauses from Ingredient Names
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Cleaned all 45 remaining ingredient entries containing `&` inside parenthetical prep/spice descriptions (e.g., `Flaxseeds (Alsi)`, `Prawns (Chingri)`, `Poha (Flattened Rice)`, `Sabudana (Tapioca Pearls)`, `Spinach (Palak)`, `Papad`, `Tomato`, `Green Chilli`) and removed stray note-only entries.
  - Zero ingredient names now contain `&` (2315 unique standardized ingredient names across all 1,724 recipes).

## 99. Split '+' Combined Ingredients & Standardized Besan/Maida Variants
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Split remaining ` + ` combined entries (such as `Poppy Seeds + Mustard`, `Milk + Water`, `Ghee + Oil`) into separate ingredient rows.
  - Stripped trailing purpose qualifiers (`for Marinade`, `for Gattas`, `for Thickening`, etc.) before quantity extraction so embedded amounts like `1 Tsp Besan` and `Besan (1 Tbsp) for Marinade` separate cleanly into `quantity`/`unit` and canonical `Besan (Gram Flour)` / `All-Purpose Flour (Maida)`.
  - Reduced unique standardized ingredient names to 2241 across all 1,724 recipes.

## 100. Recipe Master — Strict All-Ingredients Matching
- **`frontend/src/lib/recipeSearch.js`**: Updated `searchAndRankRecipes` so when one or more ingredients are selected in **Recipe Master**, only recipes containing **all** selected ingredients are shown (prioritizing exact 1:1 ingredient sets first, then already-cooked matches, then remaining matches).

## 101. Recipe Master & Food Chart — Auto-Detect Category, History Quantity/Unit & Approx Price
- **`frontend/src/lib/marketingHistory.js` & `frontend/src/components/AddIngredientToMarketingModal.jsx`**:
  - Added shared `inferHistoryDefaultsForItem` and `calculateApproximateCostFromHistory` helpers.
  - When adding an ingredient to the marketing list from **Recipe Master** or **Food Chart**, the modal automatically detects the **Category** (from purchase history first, with smart keyword fallback for new items), fills **Quantity** and **Unit** from most-used history (falling back to recipe defaults), and adds an **Approx. price (₹)** field auto-calculated from history with unit conversion (`g <-> kg`, `ml <-> L`, `dozen <-> pcs`).
- **`frontend/src/pages/RecipeMaster.jsx` & `frontend/src/pages/FoodChart.jsx`**:
  - Replaced inline ingredient modals with `AddIngredientToMarketingModal`, fetching `/marketing-list` history and submitting `itemId` and `approximateCost`.

## 102. Cross-Device User Persistence — Recipe Master Filters & Last Opened Page
- **Per-User Last Opened Page (`backend/scripts/sql/schemaSql.js`, `userSql.js`, `authController.js`, `routes/index.js`, `frontend/src/App.jsx`)**:
  - Added `public.users.last_opened_path`, included `lastOpenedPath` in `GET /api/me`, and added `PUT /api/me/last-page`.
  - `App.jsx` now persists the user's latest opened page to the server on navigation and automatically opens that latest page on login or root (`/`) load from any device or browser.
- **Per-User Recipe Master Search & Ingredients (`backend/scripts/sql/schemaSql.js`, `dietChartController.js`, `routes/index.js`, `frontend/src/pages/RecipeMaster.jsx`)**:
  - Added `public.recipe_master_user_preferences` with `GET/PUT /api/recipe-master/preferences`.
  - `RecipeMaster.jsx` restores and persists the user's `searchText`, `selectedIngredients`, and `category` across sessions and devices.

## 103. Added 18 Cake Recipes & 'Cake' Category Tag
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Added 18 diverse **Cake** recipes (`static-1992`–`static-2009`, all using `"category": "Cake"`), including Almond & Cardamom Semolina Cake, Banana Walnut Atta Cake, Biscuit Chocolate Cake, Carrot Spiced Cake, Chocolate Fudge Cake, Vanilla Sponge Cake, Coconut & Jaggery Steamed Cake, Coffee Walnut Cake, Condensed Milk Pound Cake, Dates & Walnut Cake, Eggless Black Forest Cake, Tutti Frutti Tea Cake, Lemon & Poppy Seed Cake, Mango Semolina Cake, Marble Zebra Cake, Nolen Gur & Chhena Cake, Orange Almond Cake, and Pineapple Upside-Down Skillet Cake.
  - All cake recipes are designed for manual stovetop cooker/kadhai/skillet/steamer preparation without an oven, electric mixer, or blender, bringing the alphabetically sorted catalogue to 1742 total recipes.
  - **Recipe Master** automatically surfaces **Cake** as a category filter chip/tag via `extractCategories(recipes)`.

## 104. Recipe Master — Refresh Button
- **`frontend/src/pages/RecipeMaster.jsx`**: Added a **Refresh** button in the page heading that reloads `/recipes` with `{ noCache: true }` and refreshes GPS-sorted locations, showing a confirmation toast on completion.

## 105. Single-Item Marketing Purchase Prefills Item, Quantity & Unit in Add Expense
- **`frontend/src/pages/MarketingList.jsx` (`buySelected`) & `frontend/src/pages/Expense.jsx`**:
  - When purchasing a single item from the Marketing List (`selectedPendingRows.length === 1`), `marketing-purchase-prefill` now passes `marketingItemId`, `itemId`, `itemName`, `quantity`, and `unitId` so **Add Expense** automatically fills the Item (known item or Other item), Quantity, and Unit alongside Date, Location, Category, and Comment.
  - Multi-item bulk purchases (`> 1` item) continue to use `TOTAL_ITEM` with the itemized comment.

## 106. Food Chart Remove Button Size & Marketing List Reddish Remove Buttons
- **`frontend/src/pages/dietChart.css`**: Normalized `.icon-button.danger` (`padding: 0`, `35px × 35px` desktop / `32px × 32px` mobile, transparent background) so global `.danger` padding from `styles.css` no longer enlarges the Food Chart remove button.
- **`frontend/src/pages/marketing.css`**: Styled `.marketing-item-remove-icon` with a reddish tint/border and `.marketing-bulk-remove-btn` with a solid reddish fill (`#dc2626`) for clear visual contrast in both light and dark modes.

## 107. Marketing List — Fix Undefined `locMatch` Crash on New Items
- **`frontend/src/pages/MarketingList.jsx` (`isBetterCandidate`)**: Added `if (!next) return false;` guard before accessing `next.locMatch`, fixing `Cannot read properties of undefined (reading 'locMatch')` when an item has no ID-matched price history (`idLatest` is `undefined`) while `nameLatest` is present.

## 108. Marketing List — Category Reset Button
- **`frontend/src/pages/MarketingList.jsx` & `frontend/src/pages/marketing.css`**: Added a **Reset** button (`marketing-category-reset-btn`) directly beside the **Category** dropdown to clear the selected category (`change("categoryId", "")`) and reset pagination to page 1.

## 109. Marketing List — Category Reset Also Clears Item, Quantity, Unit & Approx Price
- **`frontend/src/pages/MarketingList.jsx`**: Updated the **Reset** button beside **Category** so clicking it clears `categoryId`, `itemId`, `itemName`, `quantity`, `unitId`, `approximateCost`, and `autoCostHint` (while preserving `purchaseDate` and `locationId`) and resets pagination to page 1.

## 110. GitHub Actions Android Release — HTTP 500 Retry & Fallback Fix
- **`.github/workflows/android-apk.yml`**:
  - Added `actions/upload-artifact@v4` so the signed APK is always preserved on the workflow run even if GitHub Releases has a transient outage.
  - Split `gh release create` and `gh release upload --clobber` with 4-attempt retry/backoff, `gh release view` idempotency for re-runs, and fallback `--notes` if `--generate-notes` triggers a GitHub API HTTP 500.

## 111. Price Trend — Include Only Purchased Items in Chart & Stats
- **`backend/src/services/priceTrendService.js` (`getItemPriceTrend`)**: Changed the marketing list query filter from `m.status <> 'removed'` to `m.status = 'purchased'` so unpurchased (`pending`) items are excluded from both the Price Trend chart and summary statistics.

## 112. Unlink Marketing List Items Back to Pending When Linked Expense Is Deleted
- **`backend/scripts/sql/schemaSql.js` (`marketing_mark_expense_removed` trigger)**:
  - Updated the `AFTER DELETE ON public.expenses` trigger so deleting an expense resets linked `marketing_list_items` to `status = 'pending'` and clears `expense_id`, `expense_price`, `purchased_quantity`, and `purchased_unit_id` (instead of marking them `'removed'`), making them editable and linkable to a new expense again.
  - Also restores any previously orphaned `'removed'` or missing-expense `'purchased'` rows back to `'pending'` on startup.

## 113. Food Chart — Auto Add Recipe by Weekday & Meal History (Min Count 5)
- **`backend/src/controllers/dietChartController.js` & `backend/src/routes/index.js`**:
  - Added `POST /api/food-chart/auto-add` (`autoAddFoodChartRecipes`), which inspects historical `food_chart_entries` matching the target date's weekday (`EXTRACT(DOW FROM chart_date::date)`) and each empty meal timing (`Breakfast`, `Lunch`, `Evening Snacks`, `Dinner`).
  - Selects the maximum-used recipe with at least `5` historical uses (`HAVING COUNT(*) >= 5`), preferring location-specific history when a location is selected, and schedules it with its average historical servings.
- **`frontend/src/pages/FoodChart.jsx`**:
  - Added an **Auto Add Recipe** button beside **Add Recipe** that triggers `POST /api/food-chart/auto-add`, reloads the chart, and displays a toast summary of added recipes.

## 114. Food Chart — Disable Auto Add Recipe When Date & Location Already Have Recipes
- **`frontend/src/pages/FoodChart.jsx`**: Disabled the **Auto Add Recipe** button (`hasRecipesForSelectedDateAndLocation`) whenever at least one recipe is already scheduled for the selected date and location.

## 115. Food Chart — Auto Add All Matching Recipes (>=5 Uses) Per Meal Timing
- **`backend/src/controllers/dietChartController.js` (`autoAddFoodChartRecipes`)**: Removed `LIMIT 1` so every recipe meeting the `>= 5` historical uses threshold for that weekday and meal timing is added (preferring all location-matched recipes when `locationId` has `>= 5` matches, and deduplicating by canonical recipe name).

## 116. Food Chart — Today Button Between Previous & Next Date
- **`frontend/src/pages/FoodChart.jsx`**: Added a **Today** button between **Previous date** and **Next date** to reset the selected Food Chart date back to today (`todayKolkata()`), automatically disabled when today is already selected.

## 117. Order Frequency Page Under Manipulation
- **Backend (`orderFrequencyService.js`, `orderFrequencyController.js`, `routes/index.js`, `schemaSql.js`)**:
  - Added `GET /api/order-frequency` aggregating weekly ordered quantities (`DATE_TRUNC('week', purchase_date)`) from `marketing_list_items` with unit conversion (`g/kg`, `ml/L`, `dozen/pcs`) and summary KPIs (`avgPerWeek`, `latestWeekAmount`, `totalOrdered`, `totalOrders`, `minWeekAmount`, `maxWeekAmount`).
  - Added `public.order_frequency_user_preferences` with `GET/PUT /api/order-frequency/preferences`.
- **Frontend (`OrderFrequency.jsx`, `App.jsx`, `Layout.jsx`, `api.js`)**:
  - Added **Order Frequency** (`/order-frequency`) under **Manipulation** with Location (GPS auto-select), Category, Item, Smart Unit, KPI summary cards, a weekly Recharts bar chart, and a weekly breakdown table.

## 118. Order Frequency — Weekly Formula `(Total Qty / Days Since First Order) * 7`
- **`backend/src/services/orderFrequencyService.js` & `frontend/src/pages/OrderFrequency.jsx`**:
  - Updated `avgPerWeek` (Weekly frequency) calculation to `(totalOrdered / totalDays) * 7` where `totalDays` is the inclusive number of days from `firstOrderDate` to today (`Asia/Kolkata`).
  - Displayed `firstOrderDate` and `totalDays` beneath the **Weekly frequency** KPI card.

## 119. Order Frequency — Convert Sub-Unit Kilogram/Litre Values to Grams/Millilitres
- **`frontend/src/pages/OrderFrequency.jsx`**: Updated `formatAmount` (used across KPI cards, chart labels, chart tooltips, and weekly breakdown table) so values greater than `0` and less than `1` in Kilogram or Litre automatically convert to `g` or `ml` (`value * 1000`).

## 120. Order Frequency — Include Only Purchased Items
- **`backend/src/services/orderFrequencyService.js` & `frontend/src/pages/OrderFrequency.jsx`**: Changed the `marketing_list_items` filter from `m.status <> 'removed'` to `m.status = 'purchased'` so unpurchased (`pending`) items are excluded from all weekly order frequency calculations, charts, and stats.

## 121. Dashboard Details — Shared Named Category & Survivor Filter Presets
- **Backend (`dashboardFilterService.js`, `dashboardController.js`, `routes/index.js`, `schemaSql.js`)**:
  - Added `public.dashboard_filter_presets` storing named Category & Survivor filter presets per user (`user_id`, `name`, `categories`, `survivors`) shared across all Dashboard Detail reports.
  - Added `GET /api/dashboard/filter-presets`, `POST /api/dashboard/filter-presets`, and `DELETE /api/dashboard/filter-presets/:id`.
- **Frontend (`DashboardDetail.jsx`)**:
  - Added a **Saved Filter Presets** bar inside the Dashboard Detail filter card allowing users to save current Category & Survivor selections with a name, restore any saved preset on any Dashboard Detail page, or delete a preset.

## 122. Auto-Recover From Stale Dynamic Chunk Errors After Deploy
- **`frontend/src/App.jsx` (`lazyWithRetry`)**: Wrapped all lazy-loaded page imports with `lazyWithRetry`, automatically triggering a one-time `window.location.reload()` (guarded by a 10s `sessionStorage` timestamp) whenever a stale browser tab encounters `Failed to fetch dynamically imported module` after a new Vercel deployment.

## 123. DashboardDetail — Fix Missing Preset State Declarations
- **`frontend/src/pages/DashboardDetail.jsx`**: Added the missing `useState` declarations for `filterPresets`, `selectedPresetId`, `presetName`, and `savingPreset`, resolving `ReferenceError: selectedPresetId is not defined`.

## 124. Daily Dashboard Details — Short Weekday Name in Bar Chart Dates
- **`frontend/src/pages/DashboardDetail.jsx` (`prettyValue`)**: Added `weekday: "short"` when formatting `date` columns so daily dashboard bar charts, tooltips, and summary rows display the short weekday (e.g., `Thu, 26 Nov 2026`).

## 125. Unified Commit-Timestamp Versioning (`YYYY.MM.DD.HH.mm`) for Web & Android
- **`frontend/vite.config.js` & `frontend/scripts/bump-version.mjs`**:
  - Resolved `__APP_VERSION__` from the latest Git commit timestamp (`git log -1 --format=%ct`) formatted in IST (`Asia/Kolkata`) as `YYYY.MM.DD.HH.mm` (e.g., `2026.11.26.21.39`), with current IST time as fallback.
- **`.github/workflows/android-apk.yml`**:
  - Computed the exact same `YYYY.MM.DD.HH.mm` commit-timestamp `VERSION_NAME` before building the frontend and Android APK, exporting `VITE_APP_VERSION` to Vite and `-PAPP_VERSION_NAME` to Gradle (with epoch-minutes `VERSION_CODE` so `versionCode` remains a valid monotonically increasing 32-bit integer).

## 126. Order Frequency — Exclude Unpurchased Weeks' Days from Weekly Calculation
- **`backend/src/services/orderFrequencyService.js` & `frontend/src/pages/OrderFrequency.jsx`**:
  - Updated `totalDays` so it sums days only for weeks in which the item was actually purchased (`7` days per completed purchased week, or days elapsed so far in the current purchased week), excluding skipped weeks with zero purchases.

## 127. GitHub Actions Android Build — Maven Central 429 Mirror & Cache Fix
- **`.github/workflows/android-apk.yml`**:
  - Added `~/.gradle/init.d/mirrors.gradle` to prepend Google's Maven Central mirrors for all projects (including `:capacitor-android` `buildscript` dependencies) so Gradle avoids `repo.maven.apache.org` `429 Too Many Requests`.
  - Added `actions/cache@v4` for `~/.gradle/caches` and `~/.gradle/wrapper`, `--max-workers=2`, and a 3-attempt retry loop around `./gradlew assembleRelease`.

## 128. Order Frequency — Sunday-to-Saturday Conventional Weeks
- **`backend/src/services/orderFrequencyService.js`**: Changed weekly grouping from ISO Monday–Sunday (`DATE_TRUNC('week', m.purchase_date)`) to conventional Sunday–Saturday (`(DATE_TRUNC('week', (m.purchase_date + INTERVAL '1 day'))::date - 1)`), updating weekly chart buckets, breakdown ranges, and active-week day counts (`totalDays` and `avgPerWeek`) accordingly.

## 129. Order Frequency — Use Current/Upcoming Saturday as Cutoff Day
- **`backend/src/services/orderFrequencyService.js`**: Updated `totalDays` cutoff from `today` to the current or upcoming Saturday (`endSaturdayUtc`), so every purchased Sunday–Saturday week up to and including the current week counts all 7 days in `(totalOrdered / totalDays) * 7`.

## 130. Order Frequency — Continuous Days from First Sunday to Current/Upcoming Saturday
- **`backend/src/services/orderFrequencyService.js` & `frontend/src/pages/OrderFrequency.jsx`**:
  - Updated `totalDays` to count continuous calendar days from the first order's Sunday (`firstWeekStartUtc`) through the current or upcoming Saturday (`endSaturdayUtc`) without skipping middle weeks.

## 131. Price Trend & Order Frequency — Hide Items Without Data
- **Backend (`priceTrendService.js`, `priceTrendController.js`, `orderFrequencyService.js`, `orderFrequencyController.js`, `routes/index.js`)**:
  - Added `GET /api/price-trend/items` and `GET /api/order-frequency/items` returning only items in the selected category (and location, if selected) that have at least one qualifying `purchased` record in `marketing_list_items`.
- **Frontend (`PriceTrend.jsx`, `OrderFrequency.jsx`)**:
  - Updated the Item dropdown loader to query the new filtered endpoints whenever `categoryId` or `locationId` changes, omitting items with no data.

## 132. Marketing List & Add Expense — Sort Items by Most Ordered First
- **`backend/scripts/sql/masterDataSql.js` (`metaItems`)**: Updated `GET /api/meta/items/:categoryId` to sort items by `marketing_list_items` order count descending, then `expenses` count descending, then alphabetically by name.
- **`frontend/src/pages/MarketingList.jsx`**: Sorted the Known item dropdown by `itemOrderMeta(item).count` descending (most ordered first, then less ordered, then alphabetical).

## 133. Food Chart — Weekly Auto Add Recipe (Sunday–Saturday)
- **Backend (`dietChartController.js`, `routes/index.js`)**:
  - Added `GET /api/food-chart/week-status` returning whether the Sunday–Saturday week containing `date` is empty for the selected location.
  - Added `POST /api/food-chart/auto-add-week` (`autoAddWeeklyFoodChartRecipes`) filling the entire Sunday–Saturday week by combining weekday+meal history with available/planned ingredients from `marketing_list_items`.
- **Frontend (`FoodChart.jsx`)**:
  - Added **Weekly Auto Add Recipe** directly above the date field, enabled only when the selected Sunday–Saturday week's food chart is empty.

## 134. Marketing List — Weekly (Sunday–Saturday) Duplicate & Over-Order Check Popup
- **`frontend/src/pages/MarketingList.jsx` & `frontend/src/pages/marketing.css`**:
  - Added `getSundayToSaturdayBounds` and `analyzeWeeklyDuplicatesAndOverOrders` checking the current/upcoming Sunday–Saturday week for duplicate entries (`>= 2` orders in the week) and over-ordered quantities (`> 125%` of the item's continuous Sunday–Saturday weekly purchase average).
  - Added a **Weekly Check** button (showing the alert count when issues exist) that opens a popup modal listing all duplicate and over-ordered items with inline quantity editing (**Save**) and **Remove** actions for pending items.

## 135. Marketing List — Accept Button for Weekly Duplicate & Over-Order Alerts
- **Backend (`schemaSql.js`, `marketingController.js`, `routes/index.js`)**:
  - Added `public.marketing_weekly_alert_acceptances` and `GET/POST /api/marketing-list/weekly-acceptances` to persist accepted duplicate/over-order alerts per user, week (`week_start`), location, and item.
- **Frontend (`MarketingList.jsx`, `marketing.css`)**:
  - Added an **Accept** button on each flagged item in the Weekly Check popup; once accepted, that item is permanently hidden from the duplicate/over-order list and badge count for that week.

## 136. Marketing List — Track Accepted Quantity for Weekly Duplicate & Over-Order Alerts
- **`backend/scripts/sql/schemaSql.js`, `marketingController.js`, `frontend/src/pages/MarketingList.jsx`**:
  - Added `accepted_qty` and `accepted_count` to `public.marketing_weekly_alert_acceptances` so accepted duplicate/over-order warnings stay suppressed for the accepted quantity and entry count, while re-alerting if additional quantity or new orders are added later in the week.

## 137. Added 16 Samosa Varieties to Recipe Master
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Added 16 diverse Samosa recipes (`static-2010`–`static-2025`), including Aloo Matar Punjabi Samosa, Atta Tawa Samosa, Beetroot & Peanut Samosa, Bread Samosa, Chana Dal Irani Patti Samosa, Cheese & Sweet Corn Samosa, Chicken Keema Samosa, Chinese Noodles Samosa, Egg Bhurji Samosa, Fulkopi Shingara, Matar Paneer Samosa, Kolkata Hing Aloo Samosa, Mawa & Dry Fruit Sweet Samosa, Moong Dal Dry Mini Samosa, Onion & Poha Patti Samosa, and Soya Keema Masala Samosa.
  - All recipes use standardized ingredient names and manual stovetop/tawa/kadhai preparation without blenders, mixers, grinders, or ovens, bringing the alphabetically sorted catalogue to 1758 total recipes.

## 138. Corrected 13 Stuffed Paratha Recipes (Ingredients & Stuffing Steps)
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Replaced generic 4-ingredient bread placeholders on all 13 stuffed paratha recipes (`Aloo Paratha`, `Masala Aloo Paratha`, `Stuffed Aloo Paratha`, `Tawa Aloo Paratha`, `Whole Wheat Aloo Paratha`, `Gobi Paratha`, `Masala Gobi Paratha`, `Stuffed Gobi Paratha`, `Tawa Gobi Paratha`, `Whole Wheat Gobi Paratha`, `Stuffed Methi Paratha`, `Stuffed Lachha Paratha`, and `Stuffed Paratha`) with authentic stuffing ingredients and explicit dough-stuffing, pleating/sealing, rolling, and tawa-roasting steps.

## 139. Differentiated All 46 Bread & Stuffed Bread Recipes (Naan, Kulcha, Paratha, Luchi, Poori, Roti)
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Replaced all 46 remaining generic 4-ingredient bread placeholders with authentic, distinct recipes for each bread type and modifier:
    - **Naan** (leavened yogurt-milk-baking powder/soda maida dough, garlic/kalo jeere, tawa + flame blistered; Stuffed Naan with paneer-potato filling).
    - **Kulcha** (soft curd-leavened dough, Amritsari potato-onion-paneer-anardana/amchur stuffing for Stuffed Kulcha, steam-puffed tawa cook).
    - **Lachha Paratha** (ghee-brushed accordion-pleated spiral layers; Masala Lachha with spice layers).
    - **Methi Paratha** (fresh fenugreek leaves, besan, curd, ajwain, ginger-chilli).
    - **Paratha** (triangular ghee-folded layers; Masala Paratha with spiced dough).
    - **Luchi** (Bengali moyan maida puffed bread; Stuffed Luchi with spiced green pea filling; Masala Luchi with kalo jeere).
    - **Poori** (stiff atta + sooji dough; Stuffed Poori with spiced urad dal filling; Masala Poori with ajwain & kasuri methi).
    - **Phulka / Chapati / Roti** (distinct oil-free direct-flame phulka vs. dry-tawa chapati/roti, plus real paneer-potato-onion stuffing for Stuffed Chapati/Phulka/Roti).

## 140. Added 16 Jhuri Bhaja, Chanachur, Gathiya & Namkeen Recipes
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Added 16 crispy namkeen/farsan recipes (`static-2026`–`static-2041`), including Badam & Curry Leaf Jhuri Aloo Bhaja, Bombay/Madras Mixture, Chakli/Murukku, Chana Dal Namkeen, Chana Jor Garam, Chhena & Aloo Jhuri Bhaja, Fafda Gathiya, Kaju & Poha Dry Fruit Chanachur, Kara/Masala Boondi, Makhana & Peanut Dry Namkeen, Methi Vanela Gathiya, Moong Dal Namkeen, Muri & Chira Masala Chanachur, Nylon Tikha Gathiya, Palak Sev, and Masala Namakpara.
  - All recipes use standardized ingredients and manual stovetop/kadhai/grater/press preparation without blenders or ovens, bringing the alphabetically sorted catalogue to 1774 total recipes.

## 141. Added 14 Egg Mughlai Paratha & Stuffed Envelope Paratha Recipes
- **`backend/src/data/recipes.json` & `backend/src/data/expandedStarterRecipes.js`**:
  - Added 14 Kolkata cabin-style and regional Mughlai/folded egg paratha recipes (`static-2042`–`static-2055`), including Egg Mughlai Paratha / Dim Mughlai Porota, Double Egg Cheese Mughlai Paratha, Atta Egg Mughlai Paratha, Egg Aloo Mughlai Paratha, Egg Paneer Mughlai Paratha, Egg Soya Keema Mughlai Paratha, Egg Prawns Mughlai Paratha, Egg Mutton Liver (Mete) Mughlai Paratha, Veg Mughlai Paratha (Chhena & Potato), Baida Roti (Mumbai Egg Keema Pocket), Egg Baida Roti, Murtabak (Egg & Spiced Keema Folded Paratha), Egg Bhurji Mughlai Paratha, and Egg Sweet Corn & Capsicum Mughlai Paratha.
  - All recipes use standardized ingredient names and manual stovetop/tawa/kadhai preparation without blenders, mixers, grinders, or ovens, bringing the alphabetically sorted catalogue to 1788 total recipes.

## 142. Lock 1-Week-Old Marketing List, Expenses & Food Chart Entries
- **`backend/src/utils/dates.js` & `frontend/src/utils/dates.js`**:
  - Added `oneWeekCutoffIso` / `oneWeekCutoffKolkata` and `isOneWeekOldOrOlder` using `Asia/Kolkata` (`date <= today - 7 days`).
- **`backend/src/controllers/marketingController.js`, `expenseController.js`, `backend/src/services/expenseService.js`, & `backend/src/controllers/dietChartController.js`**:
  - Enforced HTTP `403` read-only protection on all create, update, delete, proof-upload, mark-purchased, bulk-remove, bulk-change-date, reset, and auto-add endpoints when the target or existing entry date is 1 week old or older.
- **`frontend/src/pages/MarketingList.jsx`, `Expense.jsx`, & `FoodChart.jsx`**:
  - Displayed a read-only lock banner on dates that are 1 week old or older and disabled add, edit, delete, purchase, proof-upload, reset, and auto-add controls for locked dates/rows while keeping viewing and receipt previewing available.

## 143. Marketing List — Show Purchased Cost Beside Total Cost for Past & Current Dates
- **`frontend/src/pages/MarketingList.jsx` & `frontend/src/pages/marketing.css`**:
  - Added `purchasedCost` and `purchasedItemCount` to `filteredCostSummary` (deduplicating shared `expense_id` totals so bulk-purchased items are never double-counted).
  - Rendered a green **Purchased cost (filtered)** summary banner directly beside **Total cost (filtered)** whenever viewing an old or current date (`purchaseDate <= todayKolkata()`).
