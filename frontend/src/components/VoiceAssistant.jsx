import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  HelpCircle,
  Mic,
  MicOff,
  Send,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api, showToast } from "../lib/api";
import { fetchLocationsWithGps } from "../lib/locationTracker";
import {
  createSpeechRecognizer,
  formatVoiceDateSummary,
  fuzzyMatchMultiple,
  fuzzyMatchOption,
  isBackPhrase,
  isCancelPhrase,
  isConfirmPhrase,
  isRepeatPhrase,
  isSkipPhrase,
  isSpeechRecognitionSupported,
  matchDashboardReportKey,
  parseGlobalVoiceIntent,
  parseQuantityAndUnit,
  parseSpokenDate,
  parseSpokenNumber,
  speakText,
  stopSpeaking,
} from "../lib/voiceEngine";
import { shiftIsoDate, todayKolkata } from "../utils/dates.js";
import "./voiceAssistant.css";

const MEAL_OPTIONS = ["Breakfast", "Lunch", "Evening Snacks", "Dinner"];
const GROUP_OPTIONS = [
  { id: "date", name: "Date" },
  { id: "week", name: "Week" },
  { id: "month", name: "Month" },
  { id: "year", name: "Year" },
  { id: "category", name: "Category" },
  { id: "item", name: "Item" },
  { id: "survivor", name: "Survivor" },
];
const DASHBOARD_REPORT_OPTIONS = [
  { id: "daily", name: "Daily report" },
  { id: "weekly", name: "Weekly Report" },
  { id: "monthly", name: "Monthly Report" },
  { id: "yearly", name: "Yearly Report" },
  { id: "daily-category", name: "Daily report by Category" },
  { id: "weekly-category", name: "Weekly report by Category" },
  { id: "monthly-category", name: "Monthly report by Category" },
  { id: "yearly-category", name: "Yearly report by Category" },
  { id: "daily-survivor", name: "Daily report by Survivor" },
  { id: "weekly-survivor", name: "Weekly report by Survivor" },
  { id: "monthly-survivor", name: "Monthly report by Survivor" },
  { id: "yearly-survivor", name: "Yearly report by Survivor" },
  { id: "daily-survivor-category", name: "Daily report Survivor vs Category" },
  { id: "weekly-survivor-category", name: "Weekly report Survivor vs Category" },
  { id: "monthly-survivor-category", name: "Monthly report Survivor vs Category" },
  { id: "yearly-survivor-category", name: "Yearly report Survivor vs Category" },
];
const ORDINAL_INDEX = { first: 0, "1": 0, one: 0, second: 1, "2": 1, two: 1, third: 2, "3": 2, three: 2, fourth: 3, "4": 3, four: 3, fifth: 4, "5": 4, five: 4 };

const VOICE_LANGUAGES = [
  { code: "en-IN", label: "English (IN)" },
  { code: "bn-IN", label: "বাংলা" },
  { code: "hi-IN", label: "हिन्दी" },
];

function emitVoiceAction(detail) {
  window.dispatchEvent(new CustomEvent("app:voice-action", { detail }));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function activeReportKeyFromPath(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (parts[0] === "dashboard" && parts[1] === "report" && parts[2]) {
    return parts[2];
  }
  return "";
}

export default function VoiceAssistant({ user, path, navigate, onSetDark }) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [lang, setLang] = useState("en-IN");
  const [showHelp, setShowHelp] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [assistantMessage, setAssistantMessage] = useState(
    'Tap the mic and say a command like "Add marketing list", "Add expense", "Add recipe to food chart", "Search recipe paneer", "Show report", or "Filter dashboard".',
  );
  const [manualInput, setManualInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [wizard, setWizard] = useState(null);
  const [stepItems, setStepItems] = useState([]);
  const [stepRecipeQuery, setStepRecipeQuery] = useState("");
  const [stepQty, setStepQty] = useState("");
  const [stepUnitId, setStepUnitId] = useState("");
  const [stepNumericVal, setStepNumericVal] = useState("");
  const [stepTextVal, setStepTextVal] = useState("");
  const [stepMultiIds, setStepMultiIds] = useState([]);

  // Cached metadata for fast voice matching
  const metaRef = useRef({
    categories: [],
    units: [],
    survivors: [],
    locations: [],
    bestLocation: null,
    recipes: [],
    itemsByCategory: new Map(),
  });
  const recognizerRef = useRef(null);
  const wizardRef = useRef(null);
  const ttsRef = useRef(ttsEnabled);
  const langRef = useRef(lang);

  useEffect(() => {
    wizardRef.current = wizard;
    if (!wizard) {
      setStepItems([]);
      setStepRecipeQuery("");
      setStepQty("");
      setStepUnitId("");
      setStepNumericVal("");
      setStepTextVal("");
      setStepMultiIds([]);
      return;
    }
    const step = wizard.steps[wizard.stepIndex];
    setStepRecipeQuery("");
    setStepQty(wizard.data?.quantity || "");
    setStepUnitId(wizard.data?.unitId || "");
    setStepNumericVal(
      step?.key === "cost"
        ? wizard.data?.approximateCost || ""
        : step?.key === "totalCost"
          ? wizard.data?.totalCost || ""
          : step?.key === "servings"
            ? String(wizard.data?.servings ?? 2)
            : "",
    );
    setStepTextVal(step?.key === "comment" ? wizard.data?.comment || "" : "");
    if (step?.key === "categories") {
      setStepMultiIds(Array.isArray(wizard.data?.categories) ? wizard.data.categories : []);
    } else if (step?.key === "survivors") {
      setStepMultiIds(
        Array.isArray(wizard.data?.survivors)
          ? wizard.data.survivors
          : Array.isArray(wizard.data?.survivorIds)
            ? wizard.data.survivorIds
            : [],
      );
    } else if (step?.key === "groupBy") {
      setStepMultiIds(Array.isArray(wizard.data?.groupBy) ? wizard.data.groupBy : []);
    } else {
      setStepMultiIds([]);
    }
    if (step?.key === "item" && wizard.data?.categoryId) {
      void loadCategoryItems(wizard.data.categoryId).then(setStepItems);
    } else {
      setStepItems([]);
    }
  }, [wizard?.type, wizard?.stepIndex, wizard?.data?.categoryId]);
  useEffect(() => {
    ttsRef.current = ttsEnabled;
  }, [ttsEnabled]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const speechSupported = useMemo(() => isSpeechRecognitionSupported(), []);

  const hasPermission = useCallback(
    (perm) => {
      if (!perm) return true;
      const perms = user?.permissions;
      if (!Array.isArray(perms) || !perms.length) return true;
      return perms.includes(perm);
    },
    [user?.permissions],
  );

  const ensureMetadata = useCallback(async ({ needRecipes = false, needLocations = false } = {}) => {
    const tasks = [];
    if (!metaRef.current.categories.length) {
      tasks.push(
        api("/meta/categories", { silent: true })
          .then((res) => {
            metaRef.current.categories = asArray(res);
          })
          .catch(() => {}),
      );
    }
    if (!metaRef.current.units.length) {
      tasks.push(
        api("/meta/units", { silent: true })
          .then((res) => {
            metaRef.current.units = asArray(res);
          })
          .catch(() => {}),
      );
    }
    if (!metaRef.current.survivors.length) {
      tasks.push(
        api("/meta/survivors", { silent: true })
          .then((res) => {
            metaRef.current.survivors = asArray(res);
          })
          .catch(() => {}),
      );
    }
    if (needLocations && !metaRef.current.locations.length) {
      tasks.push(
        fetchLocationsWithGps({ silent: true, fastInitial: true })
          .then((bundle) => {
            metaRef.current.locations = asArray(bundle?.locations);
            metaRef.current.bestLocation = bundle?.bestLocation || metaRef.current.locations[0] || null;
          })
          .catch(() => {}),
      );
    }
    if (needRecipes && !metaRef.current.recipes.length) {
      tasks.push(
        api("/recipes", { silent: true })
          .then((res) => {
            metaRef.current.recipes = asArray(res);
          })
          .catch(() => {}),
      );
    }
    if (tasks.length) await Promise.all(tasks);
    return metaRef.current;
  }, []);

  const loadCategoryItems = useCallback(async (categoryId) => {
    const key = String(categoryId || "");
    if (!key) return [];
    if (metaRef.current.itemsByCategory.has(key)) {
      return metaRef.current.itemsByCategory.get(key);
    }
    try {
      const list = asArray(await api(`/meta/items/${key}`, { silent: true }));
      metaRef.current.itemsByCategory.set(key, list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognizerRef.current) {
      try {
        recognizerRef.current.stop();
      } catch {
        // Ignore stop errors
      }
      recognizerRef.current = null;
    }
    setListening(false);
    setInterimText("");
  }, []);

  const say = useCallback((message, { autoListen = false } = {}) => {
    setAssistantMessage(message);
    speakText(message, {
      enabled: ttsRef.current,
      lang: langRef.current,
      onEnd: () => {
        if (autoListen && isSpeechRecognitionSupported()) {
          // Small delay so recognition doesn't catch TTS tail
          setTimeout(() => {
            startListeningRef.current?.();
          }, 220);
        }
      },
    });
  }, []);

  const promptForWizardStep = useCallback(
    (nextWizard, { autoListen = true } = {}) => {
      setWizard(nextWizard);
      const step = nextWizard.steps[nextWizard.stepIndex];
      if (!step) return;
      const msg = typeof step.prompt === "function" ? step.prompt(nextWizard.data) : step.prompt;
      say(msg, { autoListen });
    },
    [say],
  );

  // ---------------- WIZARD STARTERS ----------------

  const startMarketingWizard = useCallback(async () => {
    if (!hasPermission("marketing-list")) {
      say("You do not have permission to access the Marketing List.");
      return;
    }
    setBusy(true);
    try {
      const meta = await ensureMetadata({ needLocations: true });
      const defaultLoc = meta.bestLocation || meta.locations[0] || null;
      const steps = [
        {
          key: "date",
          label: "Purchase Date",
          prompt: `Marketing List step 1: Which date? Say "today", "tomorrow", or a date, or say "skip" for today.`,
        },
        {
          key: "location",
          label: "Shopping Location",
          prompt: (d) =>
            `Step 2: Which shopping location? Say a location name or "skip" for ${d.locationName || "nearest location"}.`,
        },
        {
          key: "category",
          label: "Category",
          prompt: `Step 3: Which category? Say a category name or "skip".`,
        },
        {
          key: "item",
          label: "Item Name",
          prompt: `Step 4: Say the item name to add to the marketing list.`,
        },
        {
          key: "quantity",
          label: "Quantity & Unit",
          prompt: `Step 5: Say the quantity and unit, like "2 kg" or "500 gram", or say "skip".`,
        },
        {
          key: "cost",
          label: "Approximate Cost",
          prompt: `Step 6: Say the approximate cost in rupees, or say "skip" to auto-estimate.`,
        },
        {
          key: "confirm",
          label: "Confirm & Save",
          prompt: (d) =>
            `Ready to add ${d.itemName}${d.quantity ? `, ${d.quantity} ${d.unitName || ""}` : ""} for ${formatVoiceDateSummary(d.purchaseDate)} at ${d.locationName || "selected location"}${d.approximateCost ? `, approx ₹${d.approximateCost}` : ""}. Say "confirm" to save or "cancel".`,
        },
      ];
      promptForWizardStep({
        type: "marketing",
        title: "Add to Marketing List",
        stepIndex: 0,
        steps,
        data: {
          purchaseDate: todayKolkata(),
          locationId: defaultLoc ? String(defaultLoc.id) : "",
          locationName: defaultLoc?.name || "",
          categoryId: "",
          categoryName: "",
          itemId: "",
          itemName: "",
          quantity: "",
          unitId: "",
          unitName: "",
          approximateCost: "",
        },
        suggestions: [],
      });
    } finally {
      setBusy(false);
    }
  }, [ensureMetadata, hasPermission, promptForWizardStep, say]);

  const startExpenseWizard = useCallback(async () => {
    if (!hasPermission("add-expense")) {
      say("You do not have permission to add expenses.");
      return;
    }
    setBusy(true);
    try {
      await ensureMetadata();
      const steps = [
        {
          key: "date",
          label: "Expense Date",
          prompt: `Add Expense step 1: Which date? Say "today", "yesterday", or a date, or say "skip" for today.`,
        },
        {
          key: "category",
          label: "Category",
          prompt: `Step 2: Which expense category?`,
        },
        {
          key: "item",
          label: "Item",
          prompt: `Step 3: Which item? Say an item name, "Total", or an "Other" item name.`,
        },
        {
          key: "quantity",
          label: "Quantity & Unit",
          prompt: `Step 4: Say quantity and unit like "2 kg", or say "skip".`,
        },
        {
          key: "totalCost",
          label: "Total Cost (₹)",
          prompt: `Step 5: What is the total cost in rupees?`,
        },
        {
          key: "expenseType",
          label: "Expense Type",
          prompt: `Step 6: Was this Cash or Online?`,
        },
        {
          key: "survivors",
          label: "Survivors",
          prompt: `Step 7: Which survivors share this expense? Say "all" for equal split across all survivors, or say survivor names.`,
        },
        {
          key: "comment",
          label: "Comment",
          prompt: `Step 8: Any comment? Say your note or say "skip".`,
        },
        {
          key: "confirm",
          label: "Confirm & Save",
          prompt: (d) =>
            `Ready to save ₹${Number(d.totalCost || 0).toFixed(2)} (${d.expenseType}) for ${d.categoryName} — ${d.itemLabel} on ${formatVoiceDateSummary(d.expenseDate)}, shared by ${d.survivorLabels.join(", ")}. Say "confirm" to save or "cancel".`,
        },
      ];
      promptForWizardStep({
        type: "expense",
        title: "Add Expense",
        stepIndex: 0,
        steps,
        data: {
          expenseDate: todayKolkata(),
          categoryId: "",
          categoryName: "",
          itemId: "__total__",
          otherItem: "",
          itemLabel: "Total",
          quantity: "",
          unitId: "",
          unitName: "",
          totalCost: "",
          expenseType: "cash",
          survivorIds: [],
          survivorLabels: [],
          comment: "",
        },
        suggestions: [],
      });
    } finally {
      setBusy(false);
    }
  }, [ensureMetadata, hasPermission, promptForWizardStep, say]);

  const startFoodChartWizard = useCallback(async () => {
    if (!hasPermission("food-chart")) {
      say("You do not have permission to edit the Food Chart.");
      return;
    }
    setBusy(true);
    try {
      const meta = await ensureMetadata({ needRecipes: true, needLocations: true });
      const defaultLoc = meta.bestLocation || meta.locations[0] || null;
      const steps = [
        {
          key: "date",
          label: "Date",
          prompt: `Food Chart step 1: Which date? Say "today", "tomorrow", or a date.`,
        },
        {
          key: "location",
          label: "Location",
          prompt: (d) =>
            `Step 2: Which location? Say a location name or "skip" for ${d.locationName || "All locations"}.`,
        },
        {
          key: "meal",
          label: "Meal Timing",
          prompt: `Step 3: Which meal? Breakfast, Lunch, Evening Snacks, or Dinner?`,
        },
        {
          key: "recipe",
          label: "Recipe",
          prompt: `Step 4: Say the recipe name you want to add.`,
        },
        {
          key: "servings",
          label: "Servings",
          prompt: (d) =>
            `Step 5: How many servings for ${d.recipeName}? Say a number or "skip" for ${d.servings || 2}.`,
        },
        {
          key: "confirm",
          label: "Confirm & Add",
          prompt: (d) =>
            `Ready to add ${d.recipeName} (${d.servings} servings) to ${d.meal} on ${formatVoiceDateSummary(d.date)}${d.locationName ? ` at ${d.locationName}` : ""}. Say "confirm" to save or "cancel".`,
        },
      ];
      promptForWizardStep({
        type: "food_chart",
        title: "Add Recipe to Food Chart",
        stepIndex: 0,
        steps,
        data: {
          date: todayKolkata(),
          locationId: defaultLoc ? String(defaultLoc.id) : "",
          locationName: defaultLoc?.name || "",
          meal: "Lunch",
          recipeId: "",
          recipeName: "",
          servings: 2,
          recipeMatches: [],
        },
        suggestions: [],
      });
    } finally {
      setBusy(false);
    }
  }, [ensureMetadata, hasPermission, promptForWizardStep, say]);

  const startReportWizard = useCallback(async () => {
    if (!hasPermission("report")) {
      say("You do not have permission to view Reports.");
      return;
    }
    setBusy(true);
    try {
      await ensureMetadata();
      const steps = [
        {
          key: "dateFilter",
          label: "Date Filter",
          prompt: `Report Builder step 1: Choose a date filter — say "today", "last 7 days", "this month", "this year", a specific date, or "skip" for all dates.`,
        },
        {
          key: "categories",
          label: "Category Filter",
          prompt: `Step 2: Filter by categories? Say one or more category names, or say "skip" for all categories.`,
        },
        {
          key: "survivors",
          label: "Survivor Filter",
          prompt: `Step 3: Filter by survivors? Say one or more survivor names, or say "skip" for all survivors.`,
        },
        {
          key: "groupBy",
          label: "Group By",
          prompt: `Step 4: Group by which fields? Say Date, Week, Month, Year, Category, Survivor, or Item (for example "Date and Category"), or say "skip" for raw report.`,
        },
        {
          key: "sort",
          label: "Sort Order",
          prompt: `Step 5: Sort by which field? Say "date descending", "price descending", "category ascending", or say "skip" for default order.`,
        },
        {
          key: "summarise",
          label: "Summarise",
          prompt: `Step 6: Enable Summarise and show chart? Say "yes" or "no".`,
        },
        {
          key: "confirm",
          label: "Run Report",
          prompt: (d) =>
            `Ready to run report${d.dateLabel ? ` for ${d.dateLabel}` : ""}${d.groupBy.length ? `, grouped by ${d.groupBy.join(", ")}` : ""}${d.summarise ? ", summarised with chart" : ""}. Say "confirm" to open and run.`,
        },
      ];
      promptForWizardStep({
        type: "report",
        title: "Build Report Step by Step",
        stepIndex: 0,
        steps,
        data: {
          dateFilterType: "none",
          dateLabel: "all dates",
          date: "",
          dateFrom: "",
          dateTo: "",
          month: "",
          year: "",
          categories: [],
          categoryLabels: [],
          survivors: [],
          survivorLabels: [],
          groupBy: [],
          sortColumns: [],
          summarise: false,
        },
        suggestions: [],
      });
    } finally {
      setBusy(false);
    }
  }, [ensureMetadata, hasPermission, promptForWizardStep, say]);

  const startDashboardFilterWizard = useCallback(async () => {
    if (!hasPermission("dashboard")) {
      say("You do not have permission to access Dashboard.");
      return;
    }
    setBusy(true);
    try {
      await ensureMetadata();
      const currentKey = activeReportKeyFromPath(path);
      const steps = [];
      if (!currentKey) {
        steps.push({
          key: "reportKey",
          label: "Dashboard Report",
          prompt: `Dashboard Filter step 1: Which dashboard report do you want to open? For example, "Daily report by Category" or "Monthly report by Survivor".`,
        });
      }
      steps.push(
        {
          key: "categories",
          label: "Categories Filter",
          prompt: `Choose Categories to filter by — say one or more category names, or say "all" to include every category.`,
        },
        {
          key: "survivors",
          label: "Survivors Filter",
          prompt: `Choose Survivors to filter by — say one or more survivor names, or say "all" to include every survivor.`,
        },
        {
          key: "confirm",
          label: "Apply Filters",
          prompt: (d) =>
            `Ready to filter dashboard${d.categoryLabels.length ? ` by categories ${d.categoryLabels.join(", ")}` : " (all categories)"}${d.survivorLabels.length ? ` and survivors ${d.survivorLabels.join(", ")}` : " (all survivors)"}. Say "confirm" to apply.`,
        },
      );
      promptForWizardStep({
        type: "dashboard_filter",
        title: "Filter Dashboard Details",
        stepIndex: 0,
        steps,
        data: {
          reportKey: currentKey || "daily-category",
          categories: [],
          categoryLabels: [],
          survivors: [],
          survivorLabels: [],
        },
        suggestions: [],
      });
    } finally {
      setBusy(false);
    }
  }, [ensureMetadata, hasPermission, path, promptForWizardStep, say]);

  // ---------------- WIZARD SUBMISSION ----------------

  const executeWizardConfirm = useCallback(
    async (activeWizard) => {
      const { type, data } = activeWizard;
      setBusy(true);
      try {
        if (type === "marketing") {
          await api("/marketing-list", {
            method: "POST",
            body: JSON.stringify({
              categoryId: data.categoryId || "",
              itemId: data.itemId || "",
              itemName: data.itemName,
              quantity: data.quantity || "",
              unitId: data.unitId || "",
              approximateCost: data.approximateCost || "",
              autoCalculateCost: !data.approximateCost,
              purchaseDate: data.purchaseDate,
              locationId: data.locationId,
            }),
            silentToast: true,
          });
          setWizard(null);
          showToast("success", `Added "${data.itemName}" to the Marketing List.`);
          say(`Added ${data.itemName} to the marketing list.`);
          if (path !== "/marketing-list") {
            navigate("/marketing-list");
          }
          emitVoiceAction({ type: "refresh-marketing-list", date: data.purchaseDate });
          return;
        }

        if (type === "expense") {
          const allSurvivors = metaRef.current.survivors;
          const chosenIds = data.survivorIds.length
            ? data.survivorIds
            : allSurvivors.map((s) => String(s.id));
          const shares = chosenIds.map((sid) => ({
            survivorId: sid,
            shareType: "remaining",
            amount: "",
          }));
          await api("/expenses", {
            method: "POST",
            body: JSON.stringify({
              expenseDate: data.expenseDate,
              categoryId: data.categoryId,
              itemId: data.itemId,
              otherItem: data.itemId === "__other__" ? data.otherItem : "",
              quantity: data.quantity || "",
              unitId: data.unitId || "",
              totalCost: String(data.totalCost),
              expenseType: data.expenseType || "cash",
              comment: data.comment || "",
              shares,
            }),
            silentToast: true,
          });
          setWizard(null);
          showToast("success", `Saved ₹${Number(data.totalCost).toFixed(2)} expense.`);
          say(`Saved ${data.totalCost} rupees expense for ${data.categoryName}.`);
          if (path !== "/add-expense") {
            navigate("/add-expense");
          }
          emitVoiceAction({ type: "refresh-expenses", date: data.expenseDate });
          return;
        }

        if (type === "food_chart") {
          await api("/food-chart", {
            method: "POST",
            body: JSON.stringify({
              date: data.date,
              locationId: data.locationId || "",
              meal: data.meal,
              recipeId: data.recipeId,
              servings: Number(data.servings) || 2,
            }),
            silentToast: true,
          });
          setWizard(null);
          showToast("success", `Added "${data.recipeName}" to ${data.meal}.`);
          say(`Added ${data.recipeName} to ${data.meal} on the food chart.`);
          if (path !== "/food-chart") {
            navigate("/food-chart");
          }
          emitVoiceAction({ type: "refresh-food-chart", date: data.date });
          return;
        }

        if (type === "report") {
          const activeFilters = [];
          if (data.dateFilterType && data.dateFilterType !== "none") activeFilters.push("date");
          if (data.categories.length) activeFilters.push("categories");
          if (data.survivors.length) activeFilters.push("survivors");

          const reportConfig = {
            activeFilters,
            dateFilterType: data.dateFilterType,
            filters: {
              date: data.date || "",
              dateFrom: data.dateFrom || "",
              dateTo: data.dateTo || "",
              month: data.month || "",
              year: data.year || "",
              hasProof: "",
              categoryItems: [],
              categories: data.categories,
              survivors: data.survivors,
            },
            sortColumns: data.sortColumns,
            groupBy: data.groupBy,
            summarise: Boolean(data.summarise),
          };
          try {
            sessionStorage.setItem(
              "job_status_open_report_config",
              JSON.stringify({ config: reportConfig, autoRun: true }),
            );
          } catch {
            // Ignore storage errors
          }
          setWizard(null);
          say("Opening report and running your query.");
          if (path === "/report") {
            emitVoiceAction({ type: "run-report", config: reportConfig });
          } else {
            navigate("/report");
          }
          return;
        }

        if (type === "dashboard_filter") {
          const targetKey = data.reportKey || activeReportKeyFromPath(path) || "daily-category";
          const payload = {
            categories: data.categories,
            survivors: data.survivors,
          };
          try {
            localStorage.setItem(
              `dashboard_filters:${user?.id || "anon"}:${targetKey}`,
              JSON.stringify(payload),
            );
          } catch {
            // Ignore storage errors
          }
          await api(`/dashboard/filters/${encodeURIComponent(targetKey)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
            silent: true,
          }).catch(() => {});

          setWizard(null);
          say("Applied your dashboard filters.");
          const targetPath = `/dashboard/report/${targetKey}`;
          if (path !== targetPath) {
            navigate(targetPath);
          }
          emitVoiceAction({
            type: "dashboard-apply-filters",
            reportKey: targetKey,
            categories: data.categories,
            survivors: data.survivors,
          });
        }
      } catch (err) {
        const msg = err?.message || "Unable to complete action.";
        showToast("error", msg);
        say(`Sorry, ${msg}`);
      } finally {
        setBusy(false);
      }
    },
    [navigate, path, say, user?.id],
  );

  // ---------------- WIZARD STEP INPUT HANDLER ----------------

  const handleWizardInput = useCallback(
    async (transcript, activeWizard) => {
      const step = activeWizard.steps[activeWizard.stepIndex];
      if (!step) return;

      if (isCancelPhrase(transcript)) {
        stopSpeaking();
        setWizard(null);
        say("Cancelled.");
        return;
      }

      if (isRepeatPhrase(transcript)) {
        promptForWizardStep(activeWizard, { autoListen: true });
        return;
      }

      if (isBackPhrase(transcript) && activeWizard.stepIndex > 0) {
        promptForWizardStep(
          { ...activeWizard, stepIndex: activeWizard.stepIndex - 1, suggestions: [] },
          { autoListen: true },
        );
        return;
      }

      const advance = (patchData = {}, extraSteps = 1) => {
        const nextIndex = Math.min(activeWizard.stepIndex + extraSteps, activeWizard.steps.length - 1);
        promptForWizardStep(
          {
            ...activeWizard,
            stepIndex: nextIndex,
            data: { ...activeWizard.data, ...patchData },
            suggestions: [],
          },
          { autoListen: true },
        );
      };

      const meta = metaRef.current;

      // ---- CONFIRM STEP (all wizards) ----
      if (step.key === "confirm") {
        if (isConfirmPhrase(transcript)) {
          await executeWizardConfirm(activeWizard);
        } else {
          say('Please say "confirm" to proceed, "back" to edit, or "cancel".', { autoListen: true });
        }
        return;
      }

      // ---- MARKETING WIZARD ----
      if (activeWizard.type === "marketing") {
        if (step.key === "date") {
          if (isSkipPhrase(transcript)) return advance();
          const parsed = parseSpokenDate(transcript, null);
          if (!parsed) {
            say('I did not catch that date. Say "today", "tomorrow", or a date like "22 November".', {
              autoListen: true,
            });
            return;
          }
          return advance({ purchaseDate: parsed });
        }
        if (step.key === "location") {
          if (isSkipPhrase(transcript)) return advance();
          const loc = fuzzyMatchOption(transcript, meta.locations, "name");
          if (!loc) {
            setWizard((w) =>
              w ? { ...w, suggestions: meta.locations.slice(0, 6).map((l) => l.name) } : w,
            );
            say("I couldn't match that location. Try another name, tap a suggestion, or say skip.", {
              autoListen: true,
            });
            return;
          }
          return advance({ locationId: String(loc.id), locationName: loc.name });
        }
        if (step.key === "category") {
          if (isSkipPhrase(transcript)) return advance();
          const cat = fuzzyMatchOption(transcript, meta.categories, "name");
          if (!cat) {
            setWizard((w) =>
              w ? { ...w, suggestions: meta.categories.slice(0, 6).map((c) => c.name) } : w,
            );
            say("I couldn't match that category. Try again, tap a suggestion, or say skip.", {
              autoListen: true,
            });
            return;
          }
          await loadCategoryItems(cat.id);
          return advance({ categoryId: String(cat.id), categoryName: cat.name });
        }
        if (step.key === "item") {
          const items = activeWizard.data.categoryId
            ? await loadCategoryItems(activeWizard.data.categoryId)
            : [];
          const matchedItem = items.length ? fuzzyMatchOption(transcript, items, "name") : null;
          const itemName = matchedItem ? matchedItem.name : transcript.trim();
          if (!itemName) {
            say("Please say the item name.", { autoListen: true });
            return;
          }
          return advance({
            itemId: matchedItem ? String(matchedItem.id) : "",
            itemName,
          });
        }
        if (step.key === "quantity") {
          if (isSkipPhrase(transcript)) return advance();
          const { quantity, unit } = parseQuantityAndUnit(transcript, meta.units);
          return advance({
            quantity,
            unitId: unit ? String(unit.id) : "",
            unitName: unit?.name || "",
          });
        }
        if (step.key === "cost") {
          if (isSkipPhrase(transcript)) return advance({ approximateCost: "" });
          const num = parseSpokenNumber(transcript);
          if (num == null || num < 0) {
            say('Please say an amount in rupees, or say "skip".', { autoListen: true });
            return;
          }
          return advance({ approximateCost: String(num) });
        }
      }

      // ---- EXPENSE WIZARD ----
      if (activeWizard.type === "expense") {
        if (step.key === "date") {
          if (isSkipPhrase(transcript)) return advance();
          const parsed = parseSpokenDate(transcript, null);
          if (!parsed || parsed > todayKolkata()) {
            say('Please say today, yesterday, or a past date.', { autoListen: true });
            return;
          }
          return advance({ expenseDate: parsed });
        }
        if (step.key === "category") {
          const cat = fuzzyMatchOption(transcript, meta.categories, "name");
          if (!cat) {
            setWizard((w) =>
              w ? { ...w, suggestions: meta.categories.slice(0, 6).map((c) => c.name) } : w,
            );
            say("Please say a valid category name or tap one below.", { autoListen: true });
            return;
          }
          await loadCategoryItems(cat.id);
          return advance({ categoryId: String(cat.id), categoryName: cat.name });
        }
        if (step.key === "item") {
          if (isSkipPhrase(transcript) || /\btotal\b/i.test(transcript)) {
            return advance({ itemId: "__total__", otherItem: "", itemLabel: "Total" });
          }
          const items = await loadCategoryItems(activeWizard.data.categoryId);
          const matched = fuzzyMatchOption(transcript, items, "name");
          if (matched) {
            return advance({
              itemId: String(matched.id),
              otherItem: "",
              itemLabel: matched.name,
            });
          }
          return advance({
            itemId: "__other__",
            otherItem: transcript.trim(),
            itemLabel: transcript.trim(),
          });
        }
        if (step.key === "quantity") {
          if (isSkipPhrase(transcript)) return advance();
          const { quantity, unit } = parseQuantityAndUnit(transcript, meta.units);
          return advance({
            quantity,
            unitId: unit ? String(unit.id) : "",
            unitName: unit?.name || "",
          });
        }
        if (step.key === "totalCost") {
          const num = parseSpokenNumber(transcript);
          if (num == null || num <= 0) {
            say("Please say a valid amount in rupees.", { autoListen: true });
            return;
          }
          return advance({ totalCost: String(num) });
        }
        if (step.key === "expenseType") {
          const isOnline = /\b(online|upi|gpay|phonepe|card|bank|net)\b/i.test(transcript);
          return advance({ expenseType: isOnline ? "online" : "cash" });
        }
        if (step.key === "survivors") {
          if (isSkipPhrase(transcript) || /\b(all|everyone|equal)\b/i.test(transcript)) {
            return advance({
              survivorIds: meta.survivors.map((s) => String(s.id)),
              survivorLabels: ["All survivors (equal)"],
            });
          }
          const matched = fuzzyMatchMultiple(transcript, meta.survivors, "full_name");
          if (!matched.length) {
            setWizard((w) =>
              w ? { ...w, suggestions: ["All", ...meta.survivors.slice(0, 5).map((s) => s.full_name)] } : w,
            );
            say('I couldn\'t match those survivor names. Say "all" or try again.', { autoListen: true });
            return;
          }
          return advance({
            survivorIds: matched.map((s) => String(s.id)),
            survivorLabels: matched.map((s) => s.full_name),
          });
        }
        if (step.key === "comment") {
          if (isSkipPhrase(transcript)) return advance({ comment: "" });
          return advance({ comment: transcript.trim() });
        }
      }

      // ---- FOOD CHART WIZARD ----
      if (activeWizard.type === "food_chart") {
        if (step.key === "date") {
          if (isSkipPhrase(transcript)) return advance();
          const parsed = parseSpokenDate(transcript, null);
          if (!parsed) {
            say('Please say "today", "tomorrow", or a date.', { autoListen: true });
            return;
          }
          return advance({ date: parsed });
        }
        if (step.key === "location") {
          if (isSkipPhrase(transcript)) return advance();
          const loc = fuzzyMatchOption(transcript, meta.locations, "name");
          if (!loc) {
            setWizard((w) =>
              w ? { ...w, suggestions: meta.locations.slice(0, 6).map((l) => l.name) } : w,
            );
            say("Location not recognized. Say another location or say skip.", { autoListen: true });
            return;
          }
          return advance({ locationId: String(loc.id), locationName: loc.name });
        }
        if (step.key === "meal") {
          const meal = fuzzyMatchOption(transcript, MEAL_OPTIONS);
          if (!meal) {
            setWizard((w) => (w ? { ...w, suggestions: MEAL_OPTIONS } : w));
            say("Please say Breakfast, Lunch, Evening Snacks, or Dinner.", { autoListen: true });
            return;
          }
          return advance({ meal });
        }
        if (step.key === "recipe") {
          const prevMatches = activeWizard.data.recipeMatches || [];
          const clean = transcript.trim().toLowerCase();
          if (prevMatches.length && clean in ORDINAL_INDEX && prevMatches[ORDINAL_INDEX[clean]]) {
            const pick = prevMatches[ORDINAL_INDEX[clean]];
            return advance({
              recipeId: String(pick.id),
              recipeName: pick.name,
              servings: Number(pick.servings) || 2,
              recipeMatches: [],
            });
          }

          const tokens = clean.split(/\s+/).filter(Boolean);
          const ranked = meta.recipes
            .map((r) => {
              const name = String(r.name || "").toLowerCase();
              let score = 0;
              if (name === clean) score = 100;
              else if (name.startsWith(clean)) score = 90;
              else if (name.includes(clean)) score = 80;
              else {
                const hits = tokens.filter((tk) => name.includes(tk)).length;
                if (hits > 0) score = Math.round((hits / tokens.length) * 65);
              }
              return { r, score };
            })
            .filter((x) => x.score >= 40)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((x) => x.r);

          if (!ranked.length) {
            say(`No recipe matched "${transcript}". Please try another recipe name.`, {
              autoListen: true,
            });
            return;
          }
          if (ranked.length === 1 || String(ranked[0].name).toLowerCase() === clean) {
            const pick = ranked[0];
            return advance({
              recipeId: String(pick.id),
              recipeName: pick.name,
              servings: Number(pick.servings) || 2,
              recipeMatches: [],
            });
          }
          setWizard((w) =>
            w
              ? {
                  ...w,
                  data: { ...w.data, recipeMatches: ranked },
                  suggestions: ranked.map((r) => r.name),
                }
              : w,
          );
          say(
            `Found ${ranked.length} matches. Top options: 1, ${ranked[0].name}; 2, ${ranked[1].name}. Say "first", "second", or tap a recipe.`,
            { autoListen: true },
          );
          return;
        }
        if (step.key === "servings") {
          if (isSkipPhrase(transcript)) return advance();
          const num = parseSpokenNumber(transcript);
          if (num == null || num <= 0) {
            say('Say a number of servings or "skip".', { autoListen: true });
            return;
          }
          return advance({ servings: Math.round(num) });
        }
      }

      // ---- REPORT BUILDER WIZARD ----
      if (activeWizard.type === "report") {
        if (step.key === "dateFilter") {
          if (isSkipPhrase(transcript)) {
            return advance({ dateFilterType: "none", dateLabel: "all dates" });
          }
          const today = todayKolkata();
          if (/\b(last 7|7 days|past week|last week)\b/i.test(transcript)) {
            const from = shiftIsoDate(today, -7);
            const to = shiftIsoDate(today, -1);
            return advance({
              dateFilterType: "range",
              dateFrom: from,
              dateTo: to,
              dateLabel: `${from} to ${to}`,
            });
          }
          if (/\b(this month|current month)\b/i.test(transcript)) {
            const m = today.slice(0, 7);
            return advance({ dateFilterType: "month", month: m, dateLabel: m });
          }
          if (/\b(this year|current year)\b/i.test(transcript)) {
            const y = today.slice(0, 4);
            return advance({ dateFilterType: "year", year: y, dateLabel: y });
          }
          const parsed = parseSpokenDate(transcript, null);
          if (parsed) {
            return advance({ dateFilterType: "date", date: parsed, dateLabel: parsed });
          }
          say('Say "today", "last 7 days", "this month", "this year", or "skip".', {
            autoListen: true,
          });
          return;
        }
        if (step.key === "categories") {
          if (isSkipPhrase(transcript)) return advance({ categories: [], categoryLabels: [] });
          const matched = fuzzyMatchMultiple(transcript, meta.categories, "name");
          if (!matched.length) {
            setWizard((w) =>
              w ? { ...w, suggestions: ["Skip", ...meta.categories.slice(0, 5).map((c) => c.name)] } : w,
            );
            say('No matching categories found. Try again or say "skip".', { autoListen: true });
            return;
          }
          return advance({
            categories: matched.map((c) => String(c.id)),
            categoryLabels: matched.map((c) => c.name),
          });
        }
        if (step.key === "survivors") {
          if (isSkipPhrase(transcript)) return advance({ survivors: [], survivorLabels: [] });
          const matched = fuzzyMatchMultiple(transcript, meta.survivors, "full_name");
          if (!matched.length) {
            setWizard((w) =>
              w ? { ...w, suggestions: ["Skip", ...meta.survivors.slice(0, 5).map((s) => s.full_name)] } : w,
            );
            say('No matching survivors found. Try again or say "skip".', { autoListen: true });
            return;
          }
          return advance({
            survivors: matched.map((s) => String(s.id)),
            survivorLabels: matched.map((s) => s.full_name),
          });
        }
        if (step.key === "groupBy") {
          if (isSkipPhrase(transcript)) return advance({ groupBy: [] });
          const matched = fuzzyMatchMultiple(transcript, GROUP_OPTIONS, "name");
          if (!matched.length) {
            setWizard((w) =>
              w ? { ...w, suggestions: ["Skip", "Date", "Month", "Category", "Survivor"] } : w,
            );
            say('Say Date, Week, Month, Year, Category, Survivor, Item, or "skip".', {
              autoListen: true,
            });
            return;
          }
          return advance({ groupBy: matched.map((g) => g.id) });
        }
        if (step.key === "sort") {
          if (isSkipPhrase(transcript)) return advance({ sortColumns: [] });
          const dir = /\b(desc|descending|high|newest|latest)\b/i.test(transcript) ? "desc" : "asc";
          const sortChoices = [
            ...GROUP_OPTIONS,
            { id: "price", name: "Price" },
            { id: "price", name: "Amount" },
          ];
          const col = fuzzyMatchOption(transcript, sortChoices, "name");
          if (!col) {
            return advance({ sortColumns: [{ column: "date", direction: dir }] });
          }
          return advance({ sortColumns: [{ column: col.id, direction: dir }] });
        }
        if (step.key === "summarise") {
          const yes = isConfirmPhrase(transcript) && !/\bno\b/i.test(transcript);
          return advance({ summarise: yes });
        }
      }

      // ---- DASHBOARD FILTER WIZARD ----
      if (activeWizard.type === "dashboard_filter") {
        if (step.key === "reportKey") {
          const key = matchDashboardReportKey(transcript);
          if (!key) {
            setWizard((w) =>
              w
                ? {
                    ...w,
                    suggestions: [
                      "Daily report by Category",
                      "Weekly report by Category",
                      "Monthly report by Survivor",
                      "Yearly report Survivor vs Category",
                    ],
                  }
                : w,
            );
            say('Say a dashboard report like "Daily report by Category" or "Monthly report by Survivor".', {
              autoListen: true,
            });
            return;
          }
          return advance({ reportKey: key });
        }
        if (step.key === "categories") {
          if (isSkipPhrase(transcript)) return advance({ categories: [], categoryLabels: [] });
          const matched = fuzzyMatchMultiple(transcript, meta.categories, "name");
          if (!matched.length) {
            setWizard((w) =>
              w ? { ...w, suggestions: ["All", ...meta.categories.slice(0, 5).map((c) => c.name)] } : w,
            );
            say('Could not match those categories. Try again or say "all".', { autoListen: true });
            return;
          }
          return advance({
            categories: matched.map((c) => String(c.id)),
            categoryLabels: matched.map((c) => c.name),
          });
        }
        if (step.key === "survivors") {
          if (isSkipPhrase(transcript)) return advance({ survivors: [], survivorLabels: [] });
          const matched = fuzzyMatchMultiple(transcript, meta.survivors, "full_name");
          if (!matched.length) {
            setWizard((w) =>
              w ? { ...w, suggestions: ["All", ...meta.survivors.slice(0, 5).map((s) => s.full_name)] } : w,
            );
            say('Could not match those survivors. Try again or say "all".', { autoListen: true });
            return;
          }
          return advance({
            survivors: matched.map((s) => String(s.id)),
            survivorLabels: matched.map((s) => s.full_name),
          });
        }
      }
    },
    [executeWizardConfirm, loadCategoryItems, promptForWizardStep, say],
  );

  // ---------------- GLOBAL INTENT HANDLER ----------------

  const handleTranscript = useCallback(
    async (transcript) => {
      const cleaned = String(transcript || "").trim();
      if (!cleaned) return;
      setLastHeard(cleaned);

      if (wizardRef.current) {
        await handleWizardInput(cleaned, wizardRef.current);
        return;
      }

      const intent = parseGlobalVoiceIntent(cleaned, path);
      if (!intent) return;

      switch (intent.type) {
        case "start_marketing_wizard":
          await startMarketingWizard();
          return;
        case "start_expense_wizard":
          await startExpenseWizard();
          return;
        case "start_food_chart_wizard":
          await startFoodChartWizard();
          return;
        case "start_report_wizard":
          await startReportWizard();
          return;
        case "start_dashboard_filter_wizard":
          await startDashboardFilterWizard();
          return;
        case "search_recipe": {
          if (!hasPermission("recipe-master")) {
            say("You do not have permission to access Recipe Master.");
            return;
          }
          try {
            sessionStorage.setItem("voice_recipe_search", intent.query);
          } catch {
            // Ignore storage errors
          }
          say(`Searching recipes for ${intent.query}.`);
          if (path === "/recipe-master") {
            emitVoiceAction({ type: "recipe-search", query: intent.query });
          } else {
            navigate("/recipe-master");
          }
          return;
        }
        case "open_dashboard":
          if (!hasPermission("dashboard")) {
            say("You do not have permission to open Dashboard.");
            return;
          }
          say("Opening Dashboard.");
          navigate("/dashboard");
          return;
        case "open_dashboard_report":
          if (!hasPermission("dashboard")) {
            say("You do not have permission to open Dashboard.");
            return;
          }
          say(`Opening ${intent.reportKey.replace(/-/g, " ")} dashboard.`);
          navigate(`/dashboard/report/${intent.reportKey}`);
          return;
        case "dashboard_reset_filters":
          say("Resetting dashboard filters.");
          emitVoiceAction({ type: "dashboard-reset-filters" });
          return;
        case "dashboard_show_report":
          say("Opening this dashboard in Reports.");
          emitVoiceAction({ type: "dashboard-show-report" });
          return;
        case "date_step":
          say(
            intent.direction === "today"
              ? "Switching to today."
              : intent.direction === "prev"
                ? "Moving to previous date."
                : "Moving to next date.",
          );
          emitVoiceAction({ type: "date-step", direction: intent.direction });
          return;
        case "set_theme":
          onSetDark?.(intent.dark);
          say(intent.dark ? "Switched to dark mode." : "Switched to light mode.");
          return;
        case "navigate":
          say(`Opening ${intent.path.replace("/", "").replace(/-/g, " ")}.`);
          navigate(intent.path);
          return;
        case "briefing_today_expense": {
          setBusy(true);
          try {
            const today = todayKolkata();
            const res = await api(`/expenses?date=${today}&page=1&pageSize=1`, { silent: true });
            const total = Number(res?.dateTotalAmount ?? res?.totalAmount ?? 0);
            const count = Number(res?.total ?? 0);
            say(
              `Today's total expense is ${total.toFixed(2)} rupees across ${count} ${count === 1 ? "entry" : "entries"}.`,
            );
          } catch {
            say("Unable to fetch today's expense total right now.");
          } finally {
            setBusy(false);
          }
          return;
        }
        case "briefing_marketing_list": {
          setBusy(true);
          try {
            const today = todayKolkata();
            const list = asArray(await api("/marketing-list", { silent: true }));
            const todayPending = list.filter(
              (r) => String(r.purchase_date || "").slice(0, 10) === today && r.status === "pending",
            );
            say(
              `You have ${todayPending.length} pending ${todayPending.length === 1 ? "item" : "items"} on today's marketing list.`,
            );
          } catch {
            say("Unable to check the marketing list right now.");
          } finally {
            setBusy(false);
          }
          return;
        }
        case "briefing_food_chart": {
          setBusy(true);
          try {
            const today = todayKolkata();
            const entries = asArray(
              await api(`/food-chart?date=${today}`, { silent: true }),
            );
            if (!entries.length) {
              say("No recipes are planned on today's food chart yet.");
            } else {
              const summary = MEAL_OPTIONS.map((m) => {
                const names = entries
                  .filter((e) => e.meal === m)
                  .map((e) => e.recipe?.name || "Recipe");
                return names.length ? `${m}: ${names.join(", ")}` : null;
              })
                .filter(Boolean)
                .join(". ");
              say(`Today's food chart — ${summary}.`);
            }
          } catch {
            say("Unable to fetch today's food chart right now.");
          } finally {
            setBusy(false);
          }
          return;
        }
        default:
          say(
            `I heard "${cleaned}". Try saying "Add marketing list", "Add expense", "Add recipe to food chart", "Search recipe paneer", "Show report", "Show dashboard", or "Filter dashboard".`,
          );
      }
    },
    [
      handleWizardInput,
      hasPermission,
      navigate,
      onSetDark,
      path,
      say,
      startDashboardFilterWizard,
      startExpenseWizard,
      startFoodChartWizard,
      startMarketingWizard,
      startReportWizard,
    ],
  );

  const startListening = useCallback(() => {
    if (!speechSupported) {
      say("Speech recognition is not supported in this browser. You can type commands below.");
      return;
    }
    stopSpeaking();
    stopListening();

    const recognizer = createSpeechRecognizer({
      lang: langRef.current,
      onStart: () => setListening(true),
      onInterim: (text) => setInterimText(text),
      onFinal: (text) => {
        setInterimText("");
        setListening(false);
        recognizerRef.current = null;
        void handleTranscript(text);
      },
      onEnd: () => {
        setListening(false);
        recognizerRef.current = null;
      },
      onError: (err) => {
        setListening(false);
        recognizerRef.current = null;
        if (err === "not-allowed" || err === "service-not-allowed") {
          setAssistantMessage(
            "Microphone permission was denied. Enable microphone access or type your command below.",
          );
        } else if (err !== "no-speech" && err !== "aborted") {
          setAssistantMessage(`Voice input error (${err}). Tap the mic to try again.`);
        }
      },
    });
    if (!recognizer) return;
    recognizerRef.current = recognizer;
    try {
      recognizer.start();
    } catch {
      setListening(false);
    }
  }, [handleTranscript, say, speechSupported, stopListening]);

  const startListeningRef = useRef(startListening);
  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  useEffect(() => {
    return () => {
      stopListening();
      stopSpeaking();
    };
  }, [stopListening]);

  const submitManual = (event) => {
    event.preventDefault();
    const text = manualInput.trim();
    if (!text || busy) return;
    setManualInput("");
    void handleTranscript(text);
  };

  const currentStep = wizard ? wizard.steps[wizard.stepIndex] : null;
  const isConfirmStep = currentStep?.key === "confirm";

  const advanceWizardDirectly = (patchData = {}) => {
    if (!wizard) return;
    stopListening();
    stopSpeaking();
    const nextIndex = Math.min(wizard.stepIndex + 1, wizard.steps.length - 1);
    promptForWizardStep(
      {
        ...wizard,
        stepIndex: nextIndex,
        data: { ...wizard.data, ...patchData },
        suggestions: [],
      },
      { autoListen: true },
    );
  };

  const toggleMultiId = (id) => {
    const key = String(id);
    setStepMultiIds((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  };

  const renderStepControl = () => {
    if (!wizard || !currentStep || isConfirmStep) return null;
    const key = currentStep.key;
    const meta = metaRef.current;

    // 1. Date picker step
    if (key === "date") {
      const dateField =
        wizard.type === "marketing"
          ? "purchaseDate"
          : wizard.type === "expense"
            ? "expenseDate"
            : "date";
      const val = wizard.data?.[dateField] || todayKolkata();
      const maxDate = wizard.type === "expense" ? todayKolkata() : undefined;
      return (
        <div className="voice-step-control">
          <input
            type="date"
            className="voice-step-input"
            value={val}
            max={maxDate}
            onChange={(e) => {
              if (e.target.value) advanceWizardDirectly({ [dateField]: e.target.value });
            }}
          />
          <div className="voice-chips">
            <button
              type="button"
              className="voice-chip"
              onClick={() => advanceWizardDirectly({ [dateField]: todayKolkata() })}
            >
              Today
            </button>
            <button
              type="button"
              className="voice-chip"
              onClick={() => advanceWizardDirectly({ [dateField]: shiftIsoDate(todayKolkata(), -1) })}
            >
              Yesterday
            </button>
            {wizard.type !== "expense" ? (
              <button
                type="button"
                className="voice-chip"
                onClick={() => advanceWizardDirectly({ [dateField]: shiftIsoDate(todayKolkata(), 1) })}
              >
                Tomorrow
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    // 2. Report date filter step
    if (key === "dateFilter") {
      const today = todayKolkata();
      return (
        <div className="voice-step-control">
          <div className="voice-chips">
            <button
              type="button"
              className="voice-chip"
              onClick={() =>
                advanceWizardDirectly({ dateFilterType: "none", dateLabel: "all dates" })
              }
            >
              All dates
            </button>
            <button
              type="button"
              className="voice-chip"
              onClick={() =>
                advanceWizardDirectly({ dateFilterType: "date", date: today, dateLabel: today })
              }
            >
              Today
            </button>
            <button
              type="button"
              className="voice-chip"
              onClick={() => {
                const from = shiftIsoDate(today, -7);
                const to = shiftIsoDate(today, -1);
                advanceWizardDirectly({
                  dateFilterType: "range",
                  dateFrom: from,
                  dateTo: to,
                  dateLabel: `${from} to ${to}`,
                });
              }}
            >
              Last 7 days
            </button>
            <button
              type="button"
              className="voice-chip"
              onClick={() =>
                advanceWizardDirectly({
                  dateFilterType: "month",
                  month: today.slice(0, 7),
                  dateLabel: today.slice(0, 7),
                })
              }
            >
              This month
            </button>
            <button
              type="button"
              className="voice-chip"
              onClick={() =>
                advanceWizardDirectly({
                  dateFilterType: "year",
                  year: today.slice(0, 4),
                  dateLabel: today.slice(0, 4),
                })
              }
            >
              This year
            </button>
          </div>
          <input
            type="date"
            className="voice-step-input"
            aria-label="Pick specific report date"
            value={wizard.data?.date || ""}
            onChange={(e) => {
              if (e.target.value) {
                advanceWizardDirectly({
                  dateFilterType: "date",
                  date: e.target.value,
                  dateLabel: e.target.value,
                });
              }
            }}
          />
        </div>
      );
    }

    // 3. Location dropdown
    if (key === "location") {
      return (
        <div className="voice-step-control">
          <select
            className="voice-step-input"
            value={wizard.data?.locationId || ""}
            onChange={(e) => {
              const id = e.target.value;
              const loc = meta.locations.find((l) => String(l.id) === String(id));
              advanceWizardDirectly({
                locationId: id,
                locationName: loc?.name || "",
              });
            }}
          >
            <option value="">Choose location…</option>
            {meta.locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>
      );
    }

    // 4. Single category dropdown (Marketing List & Expense)
    if (key === "category") {
      return (
        <div className="voice-step-control">
          <select
            className="voice-step-input"
            value={wizard.data?.categoryId || ""}
            onChange={async (e) => {
              const id = e.target.value;
              const cat = meta.categories.find((c) => String(c.id) === String(id));
              if (!cat) return;
              await loadCategoryItems(cat.id);
              advanceWizardDirectly({ categoryId: String(cat.id), categoryName: cat.name });
            }}
          >
            <option value="">Choose category…</option>
            {meta.categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      );
    }

    // 5. Item dropdown + custom item entry
    if (key === "item") {
      return (
        <div className="voice-step-control">
          <select
            className="voice-step-input"
            value=""
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              if (val === "__total__") {
                advanceWizardDirectly({ itemId: "__total__", otherItem: "", itemLabel: "Total" });
                return;
              }
              const item = stepItems.find((i) => String(i.id) === String(val));
              if (!item) return;
              if (wizard.type === "marketing") {
                advanceWizardDirectly({ itemId: String(item.id), itemName: item.name });
              } else {
                advanceWizardDirectly({
                  itemId: String(item.id),
                  otherItem: "",
                  itemLabel: item.name,
                });
              }
            }}
          >
            <option value="">Choose item from list…</option>
            {wizard.type === "expense" ? <option value="__total__">Total</option> : null}
            {stepItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      );
    }

    // 6. Meal dropdown (Food Chart)
    if (key === "meal") {
      return (
        <div className="voice-step-control">
          <select
            className="voice-step-input"
            value={wizard.data?.meal || ""}
            onChange={(e) => {
              if (e.target.value) advanceWizardDirectly({ meal: e.target.value });
            }}
          >
            <option value="">Choose meal…</option>
            {MEAL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      );
    }

    // 7. Recipe searchable dropdown (Food Chart)
    if (key === "recipe") {
      const qLower = stepRecipeQuery.trim().toLowerCase();
      const filtered = qLower
        ? meta.recipes.filter((r) => String(r.name || "").toLowerCase().includes(qLower)).slice(0, 40)
        : meta.recipes.slice(0, 40);
      return (
        <div className="voice-step-control">
          <input
            type="search"
            className="voice-step-input"
            placeholder="Filter recipes…"
            value={stepRecipeQuery}
            onChange={(e) => setStepRecipeQuery(e.target.value)}
          />
          <select
            className="voice-step-input"
            value=""
            onChange={(e) => {
              const pick = meta.recipes.find((r) => String(r.id) === String(e.target.value));
              if (pick) {
                advanceWizardDirectly({
                  recipeId: String(pick.id),
                  recipeName: pick.name,
                  servings: Number(pick.servings) || 2,
                  recipeMatches: [],
                });
              }
            }}
          >
            <option value="">Choose recipe ({filtered.length} shown)…</option>
            {filtered.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      );
    }

    // 8. Expense type dropdown
    if (key === "expenseType") {
      return (
        <div className="voice-step-control">
          <select
            className="voice-step-input"
            value=""
            onChange={(e) => {
              if (e.target.value) advanceWizardDirectly({ expenseType: e.target.value });
            }}
          >
            <option value="">Choose expense type…</option>
            <option value="cash">Cash</option>
            <option value="online">Online</option>
          </select>
        </div>
      );
    }

    // 9. Dashboard report dropdown
    if (key === "reportKey") {
      return (
        <div className="voice-step-control">
          <select
            className="voice-step-input"
            value={wizard.data?.reportKey || ""}
            onChange={(e) => {
              if (e.target.value) advanceWizardDirectly({ reportKey: e.target.value });
            }}
          >
            <option value="">Choose dashboard report…</option>
            {DASHBOARD_REPORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>
      );
    }

    // 10. Quantity & Unit controls
    if (key === "quantity") {
      return (
        <div className="voice-step-control voice-step-row">
          <input
            type="number"
            step="any"
            min="0"
            className="voice-step-input"
            placeholder="Qty"
            value={stepQty}
            onChange={(e) => setStepQty(e.target.value)}
          />
          <select
            className="voice-step-input"
            value={stepUnitId}
            onChange={(e) => setStepUnitId(e.target.value)}
          >
            <option value="">Unit…</option>
            {meta.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary voice-step-apply-btn"
            onClick={() => {
              const unit = meta.units.find((u) => String(u.id) === String(stepUnitId));
              advanceWizardDirectly({
                quantity: stepQty,
                unitId: unit ? String(unit.id) : "",
                unitName: unit?.name || "",
              });
            }}
          >
            Next
          </button>
        </div>
      );
    }

    // 11. Cost / Total Cost / Servings numeric input
    if (key === "cost" || key === "totalCost" || key === "servings") {
      const placeholder =
        key === "servings" ? "Servings (e.g. 2)" : "Amount in ₹";
      return (
        <div className="voice-step-control voice-step-row">
          <input
            type="number"
            step={key === "servings" ? "1" : "0.01"}
            min="0"
            className="voice-step-input"
            placeholder={placeholder}
            value={stepNumericVal}
            onChange={(e) => setStepNumericVal(e.target.value)}
          />
          <button
            type="button"
            className="primary voice-step-apply-btn"
            disabled={key === "totalCost" && (!stepNumericVal || Number(stepNumericVal) <= 0)}
            onClick={() => {
              if (key === "cost") advanceWizardDirectly({ approximateCost: stepNumericVal });
              else if (key === "totalCost") advanceWizardDirectly({ totalCost: stepNumericVal });
              else advanceWizardDirectly({ servings: Math.max(1, Math.round(Number(stepNumericVal) || 2)) });
            }}
          >
            Next
          </button>
        </div>
      );
    }

    // 12. Multi-select categories / survivors / groupBy
    if (key === "categories" || key === "survivors" || key === "groupBy") {
      const options =
        key === "categories"
          ? meta.categories.map((c) => ({ id: String(c.id), name: c.name }))
          : key === "survivors"
            ? meta.survivors.map((s) => ({ id: String(s.id), name: s.full_name }))
            : GROUP_OPTIONS;
      return (
        <div className="voice-step-control">
          <div className="voice-multi-list">
            {options.map((opt) => {
              const checked = stepMultiIds.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`voice-chip${checked ? " active" : ""}`}
                  onClick={() => toggleMultiId(opt.id)}
                >
                  {checked ? "✓ " : ""}
                  {opt.name}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="primary voice-step-apply-btn"
            onClick={() => {
              const labels = options
                .filter((o) => stepMultiIds.includes(o.id))
                .map((o) => o.name);
              if (key === "categories") {
                advanceWizardDirectly({ categories: stepMultiIds, categoryLabels: labels });
              } else if (key === "survivors") {
                if (wizard.type === "expense") {
                  advanceWizardDirectly({
                    survivorIds: stepMultiIds.length
                      ? stepMultiIds
                      : meta.survivors.map((s) => String(s.id)),
                    survivorLabels: labels.length ? labels : ["All survivors (equal)"],
                  });
                } else {
                  advanceWizardDirectly({ survivors: stepMultiIds, survivorLabels: labels });
                }
              } else {
                advanceWizardDirectly({ groupBy: stepMultiIds });
              }
            }}
          >
            Apply ({stepMultiIds.length ? `${stepMultiIds.length} selected` : "All / None"})
          </button>
        </div>
      );
    }

    // 13. Sort dropdown (Report Builder)
    if (key === "sort") {
      return (
        <div className="voice-step-control">
          <select
            className="voice-step-input"
            value=""
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              if (val === "default") {
                advanceWizardDirectly({ sortColumns: [] });
                return;
              }
              const [column, direction] = val.split(":");
              advanceWizardDirectly({ sortColumns: [{ column, direction }] });
            }}
          >
            <option value="">Choose sort order…</option>
            <option value="default">Default order</option>
            <option value="date:desc">Date (newest first)</option>
            <option value="date:asc">Date (oldest first)</option>
            <option value="price:desc">Amount (highest first)</option>
            <option value="price:asc">Amount (lowest first)</option>
            <option value="category:asc">Category (A–Z)</option>
            <option value="survivor:asc">Survivor (A–Z)</option>
          </select>
        </div>
      );
    }

    // 14. Summarise Yes / No (Report Builder)
    if (key === "summarise") {
      return (
        <div className="voice-step-control voice-chips">
          <button
            type="button"
            className="voice-chip active"
            onClick={() => advanceWizardDirectly({ summarise: true })}
          >
            Yes — Summarise & Show Chart
          </button>
          <button
            type="button"
            className="voice-chip"
            onClick={() => advanceWizardDirectly({ summarise: false })}
          >
            No — Detailed Rows
          </button>
        </div>
      );
    }

    // 15. Comment text input
    if (key === "comment") {
      return (
        <div className="voice-step-control voice-step-row">
          <input
            type="text"
            className="voice-step-input"
            placeholder="Optional comment…"
            value={stepTextVal}
            onChange={(e) => setStepTextVal(e.target.value)}
          />
          <button
            type="button"
            className="primary voice-step-apply-btn"
            onClick={() => advanceWizardDirectly({ comment: stepTextVal.trim() })}
          >
            Next
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <>
      <button
        type="button"
        className={`voice-fab${listening ? " listening" : ""}${open ? " open" : ""}`}
        onClick={() => {
          if (!open) {
            setOpen(true);
            if (speechSupported) {
              setTimeout(() => startListening(), 150);
            }
          } else if (listening) {
            stopListening();
          } else {
            startListening();
          }
        }}
        title="Voice commands"
        aria-label="Voice commands"
      >
        {listening ? <MicOff size={21} /> : <Mic size={21} />}
      </button>

      {open ? (
        <aside className="voice-drawer card" aria-label="Voice Assistant">
          <div className="voice-drawer-head">
            <div className="voice-drawer-title">
              <Sparkles size={16} />
              <strong>Voice Assistant</strong>
              {listening ? <span className="voice-live-pill">Listening…</span> : null}
            </div>
            <div className="voice-drawer-controls">
              <select
                className="voice-lang-select"
                aria-label="Voice language"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
              >
                {VOICE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  const next = !ttsEnabled;
                  setTtsEnabled(next);
                  if (!next) stopSpeaking();
                }}
                title={ttsEnabled ? "Mute spoken prompts" : "Enable spoken prompts"}
                aria-label={ttsEnabled ? "Mute spoken prompts" : "Enable spoken prompts"}
              >
                {ttsEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowHelp((v) => !v)}
                title="Voice command examples"
                aria-label="Voice command examples"
              >
                <HelpCircle size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  stopListening();
                  stopSpeaking();
                  setOpen(false);
                }}
                title="Close voice assistant"
                aria-label="Close voice assistant"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {showHelp ? (
            <div className="voice-help-box">
              <strong>Try saying:</strong>
              <ul>
                <li>“Add marketing list” (step-by-step)</li>
                <li>“Add expense” (step-by-step)</li>
                <li>“Add recipe to food chart” (step-by-step)</li>
                <li>“Search recipe Mysore bonda”</li>
                <li>“Show report” (step-by-step builder)</li>
                <li>“Show dashboard” or “Open monthly report by category”</li>
                <li>“Filter dashboard” (step-by-step categories & survivors)</li>
                <li>“Today’s total expense” / “Today’s food chart” / “Next date”</li>
              </ul>
            </div>
          ) : null}

          <div className="voice-prompt-box">
            <p>{assistantMessage}</p>
            {interimText ? <div className="voice-interim">“{interimText}”</div> : null}
            {!interimText && lastHeard ? (
              <div className="voice-last-heard">Heard: “{lastHeard}”</div>
            ) : null}
          </div>

          {wizard ? (
            <div className="voice-wizard-panel">
              <div className="voice-wizard-meta">
                <strong>{wizard.title}</strong>
                <span>
                  Step {wizard.stepIndex + 1} of {wizard.steps.length}: {currentStep?.label}
                </span>
              </div>

              {renderStepControl()}

              {wizard.suggestions?.length ? (
                <div className="voice-chips">
                  {wizard.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="voice-chip"
                      disabled={busy}
                      onClick={() => void handleTranscript(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="voice-wizard-actions">
                {wizard.stepIndex > 0 ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void handleTranscript("back")}
                  >
                    <ChevronLeft size={14} /> Back
                  </button>
                ) : null}
                {!isConfirmStep ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void handleTranscript("skip")}
                  >
                    <SkipForward size={14} /> Skip
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => void executeWizardConfirm(wizard)}
                  >
                    <Check size={14} /> {busy ? "Saving…" : "Confirm"}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    stopSpeaking();
                    setWizard(null);
                    setAssistantMessage("Cancelled. Tap the mic for a new command.");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="voice-quick-starts">
              {hasPermission("marketing-list") ? (
                <button type="button" className="voice-chip" onClick={startMarketingWizard}>
                  + Marketing List
                </button>
              ) : null}
              {hasPermission("add-expense") ? (
                <button type="button" className="voice-chip" onClick={startExpenseWizard}>
                  + Expense
                </button>
              ) : null}
              {hasPermission("food-chart") ? (
                <button type="button" className="voice-chip" onClick={startFoodChartWizard}>
                  + Food Chart
                </button>
              ) : null}
              {hasPermission("report") ? (
                <button type="button" className="voice-chip" onClick={startReportWizard}>
                  Build Report
                </button>
              ) : null}
              {hasPermission("dashboard") ? (
                <button type="button" className="voice-chip" onClick={startDashboardFilterWizard}>
                  Filter Dashboard
                </button>
              ) : null}
            </div>
          )}

          <form className="voice-manual-form" onSubmit={submitManual}>
            <button
              type="button"
              className={`voice-mic-inline${listening ? " listening" : ""}`}
              onClick={() => (listening ? stopListening() : startListening())}
              disabled={busy}
              title={listening ? "Stop listening" : "Start listening"}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder={
                isConfirmStep ? 'Say or type "confirm" or "cancel"…' : "Speak or type a command…"
              }
              disabled={busy}
            />
            <button type="submit" className="primary voice-send-btn" disabled={busy || !manualInput.trim()}>
              <Send size={15} />
            </button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
