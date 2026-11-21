import { formatLongDateWithWeekday, shiftIsoDate, todayKolkata } from "../utils/dates.js";

function getNativeAndroidSpeech() {
  if (typeof window === "undefined") return null;
  const bridge = window.DailyExpensesSpeech;
  if (!bridge || typeof bridge.startListening !== "function") return null;
  return bridge;
}

export function isSpeechRecognitionSupported() {
  if (typeof window === "undefined") return false;
  if (getNativeAndroidSpeech()) return true;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createSpeechRecognizer({
  lang = "en-IN",
  onInterim,
  onFinal,
  onStart,
  onEnd,
  onError,
} = {}) {
  const nativeBridge = getNativeAndroidSpeech();
  if (nativeBridge) {
    return {
      start() {
        window.__onNativeVoiceEvent = (payload) => {
          const type = payload?.type;
          const value = String(payload?.value || "").trim();
          if (type === "start") onStart?.();
          else if (type === "interim" && value) onInterim?.(value);
          else if (type === "final" && value) onFinal?.(value);
          else if (type === "error") onError?.(value || "speech-error");
          else if (type === "end") onEnd?.();
        };
        nativeBridge.startListening(lang);
      },
      stop() {
        try {
          nativeBridge.stopListening?.();
        } catch {
          // Ignore native stop errors
        }
      },
    };
  }

  const SpeechRec =
    typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRec) return null;

  const recognition = new SpeechRec();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => onStart?.();
  recognition.onend = () => onEnd?.();
  recognition.onerror = (event) => onError?.(event?.error || "speech-error");
  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i]?.[0]?.transcript || "";
      if (event.results[i].isFinal) {
        finalText += piece;
      } else {
        interim += piece;
      }
    }
    if (interim.trim()) onInterim?.(interim.trim());
    if (finalText.trim()) onFinal?.(finalText.trim());
  };

  return recognition;
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore synthesis cancel errors
    }
  }
}

export function speakText(text, { enabled = true, lang = "en-IN", onEnd } = {}) {
  if (!enabled || !text || typeof window === "undefined" || !window.speechSynthesis) {
    onEnd?.();
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text));
    utterance.lang = lang;
    utterance.rate = 1.04;
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    window.speechSynthesis.speak(utterance);
  } catch {
    onEnd?.();
  }
}

const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  half: 0.5,
  quarter: 0.25,
};

export function parseSpokenNumber(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;

  const digitMatch = raw.match(/(\d+(?:,\d{3})*(?:\.\d+)?)/);
  if (digitMatch) {
    const num = Number(digitMatch[1].replace(/,/g, ""));
    if (Number.isFinite(num)) return num;
  }

  const tokens = raw.replace(/[^a-z\s.-]/g, " ").split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let matched = false;

  for (const token of tokens) {
    if (token in NUMBER_WORDS) {
      current += NUMBER_WORDS[token];
      matched = true;
    } else if (token === "hundred") {
      current = (current || 1) * 100;
      matched = true;
    } else if (token === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      matched = true;
    }
  }
  return matched ? total + current : null;
}

const MONTH_MAP = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function parseSpokenDate(input, fallbackDate = todayKolkata()) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) return fallbackDate;

  const today = todayKolkata();
  if (/\b(today|now|same day|aj|aaj)\b/.test(text)) return today;
  if (/\b(yesterday|kal|goto kal|last day)\b/.test(text)) return shiftIsoDate(today, -1);
  if (/\b(day after tomorrow)\b/.test(text)) return shiftIsoDate(today, 2);
  if (/\b(tomorrow|next day|agami kal)\b/.test(text)) return shiftIsoDate(today, 1);

  const daysAgo = text.match(/(\d+)\s+days?\s+ago/);
  if (daysAgo) return shiftIsoDate(today, -Number(daysAgo[1]));

  const inDays = text.match(/in\s+(\d+)\s+days?/);
  if (inDays) return shiftIsoDate(today, Number(inDays[1]));

  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, "0")}-${String(isoMatch[3]).padStart(2, "0")}`;
  }

  const dmyMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    let year = dmyMatch[3] ? Number(dmyMatch[3]) : Number(today.slice(0, 4));
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const dayMonthMatch = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:\s+(\d{4}))?\b/,
  );
  if (dayMonthMatch && MONTH_MAP[dayMonthMatch[2]]) {
    const day = Number(dayMonthMatch[1]);
    const month = MONTH_MAP[dayMonthMatch[2]];
    const year = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : Number(today.slice(0, 4));
    if (day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const monthDayMatch = text.match(
    /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/,
  );
  if (monthDayMatch && MONTH_MAP[monthDayMatch[1]]) {
    const month = MONTH_MAP[monthDayMatch[1]];
    const day = Number(monthDayMatch[2]);
    const year = monthDayMatch[3] ? Number(monthDayMatch[3]) : Number(today.slice(0, 4));
    if (day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fuzzyMatchOption(transcript, options = [], labelKey = "name") {
  const query = normalizeText(transcript);
  if (!query || !Array.isArray(options) || !options.length) return null;

  const queryTokens = query.split(" ").filter(Boolean);
  let best = null;
  let bestScore = 0;

  for (const opt of options) {
    const label = normalizeText(typeof opt === "string" ? opt : opt?.[labelKey] ?? opt?.label ?? "");
    if (!label) continue;

    let score = 0;
    if (label === query) {
      score = 100;
    } else if (label.startsWith(query) || query.startsWith(label)) {
      score = 88;
    } else if (label.includes(query)) {
      score = 78;
    } else if (query.includes(label) && label.length >= 3) {
      score = 72;
    } else {
      const labelTokens = label.split(" ").filter(Boolean);
      const hits = queryTokens.filter((qt) =>
        labelTokens.some((lt) => lt === qt || (qt.length >= 3 && lt.startsWith(qt))),
      ).length;
      if (hits > 0) {
        score = Math.round((hits / Math.max(queryTokens.length, labelTokens.length)) * 68);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }

  return bestScore >= 32 ? best : null;
}

export function fuzzyMatchMultiple(transcript, options = [], labelKey = "name") {
  const normalized = normalizeText(transcript);
  if (!normalized || !Array.isArray(options) || !options.length) return [];

  const parts = normalized
    .split(/\b(?:and|or|plus|with)\b|,/)
    .map((p) => p.trim())
    .filter(Boolean);

  const matched = [];
  const seen = new Set();

  for (const part of parts.length ? parts : [normalized]) {
    const hit = fuzzyMatchOption(part, options, labelKey);
    if (hit) {
      const key = String(hit?.id ?? hit?.[labelKey] ?? hit);
      if (!seen.has(key)) {
        seen.add(key);
        matched.push(hit);
      }
    }
  }

  if (!matched.length) {
    for (const opt of options) {
      const label = normalizeText(typeof opt === "string" ? opt : opt?.[labelKey] ?? opt?.label ?? "");
      if (label.length >= 3 && normalized.includes(label)) {
        const key = String(opt?.id ?? label);
        if (!seen.has(key)) {
          seen.add(key);
          matched.push(opt);
        }
      }
    }
  }

  return matched;
}

const UNIT_SYNONYMS = {
  kg: ["kg", "kilo", "kilos", "kilogram", "kilograms"],
  g: ["g", "gm", "gms", "gram", "grams"],
  l: ["l", "ltr", "litre", "litres", "liter", "liters"],
  ml: ["ml", "millilitre", "milliliter", "millilitres"],
  pcs: ["pc", "pcs", "piece", "pieces", "nos", "no", "number", "count"],
  pkt: ["pkt", "packet", "packets", "pack", "packs"],
  dozen: ["dozen", "doz"],
  bundle: ["bundle", "bundles", "bunch", "bunches"],
  bottle: ["bottle", "bottles"],
};

export function parseQuantityAndUnit(transcript, units = []) {
  const text = String(transcript || "").trim().toLowerCase();
  const qty = parseSpokenNumber(text);
  let matchedUnit = null;

  for (const unit of units) {
    const uName = normalizeText(unit.name);
    if (!uName) continue;
    const regex = new RegExp(`\\b${uName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i");
    if (regex.test(text)) {
      matchedUnit = unit;
      break;
    }
  }

  if (!matchedUnit) {
    for (const [canonical, aliases] of Object.entries(UNIT_SYNONYMS)) {
      if (aliases.some((a) => new RegExp(`\\b${a}\\b`, "i").test(text))) {
        matchedUnit =
          units.find((u) => {
            const un = normalizeText(u.name);
            return un === canonical || aliases.includes(un);
          }) || null;
        if (matchedUnit) break;
      }
    }
  }

  return {
    quantity: qty != null && qty > 0 ? String(qty) : "",
    unit: matchedUnit,
  };
}

export function matchDashboardReportKey(transcript) {
  const t = normalizeText(transcript);
  let period = null;
  if (/\b(daily|day)\b/.test(t)) period = "daily";
  else if (/\b(weekly|week)\b/.test(t)) period = "weekly";
  else if (/\b(monthly|month)\b/.test(t)) period = "monthly";
  else if (/\b(yearly|year|annual)\b/.test(t)) period = "yearly";

  if (!period) return null;

  const hasCategory = /\b(category|categories)\b/.test(t);
  const hasSurvivor = /\b(survivor|survivors|resident|residents)\b/.test(t);

  if (hasCategory && hasSurvivor) return `${period}-survivor-category`;
  if (hasCategory) return `${period}-category`;
  if (hasSurvivor) return `${period}-survivor`;
  return period;
}

export function isConfirmPhrase(transcript) {
  return /\b(confirm|yes|save|submit|ok|okay|done|apply|proceed|go ahead|sure|haan|ha)\b/i.test(
    String(transcript || ""),
  );
}

export function isCancelPhrase(transcript) {
  return /\b(cancel|stop|close|abort|exit|never mind|nevermind|no thanks)\b/i.test(
    String(transcript || ""),
  );
}

export function isSkipPhrase(transcript) {
  return /\b(skip|none|no|nothing|default|all|pass|next)\b/i.test(String(transcript || ""));
}

export function isBackPhrase(transcript) {
  return /\b(back|previous step|go back)\b/i.test(String(transcript || ""));
}

export function isRepeatPhrase(transcript) {
  return /\b(repeat|say again|again|pardon)\b/i.test(String(transcript || ""));
}

export function parseGlobalVoiceIntent(transcript, currentPath = "") {
  const raw = String(transcript || "").trim();
  const t = normalizeText(raw);
  if (!t) return null;

  // 1. Briefings (read-aloud summaries)
  if (/\b(today|todays).*(total|expense|spent|spending)\b/.test(t) || /\bhow much.*spent\b/.test(t)) {
    return { type: "briefing_today_expense" };
  }
  if (/\b(how many|summary|count|check).*(marketing|shopping)\b/.test(t)) {
    return { type: "briefing_marketing_list" };
  }
  if (
    /\b(today|todays|what).*(food chart|menu|breakfast|lunch|dinner|snacks)\b/.test(t) &&
    !/\badd\b/.test(t)
  ) {
    return { type: "briefing_food_chart" };
  }

  // 2. Step-by-step wizards
  if (/\b(add|new|create|put)\b.*\b(marketing|shopping)\b/.test(t)) {
    return { type: "start_marketing_wizard", raw };
  }
  if (/\b(add|new|record|log|create)\b.*\b(expense|expenses|spending)\b/.test(t)) {
    return { type: "start_expense_wizard", raw };
  }
  if (
    /\b(add|plan|put)\b.*\b(recipe|meal|breakfast|lunch|dinner|snack|snacks)\b.*\b(food chart|chart|today|tomorrow)?\b/.test(
      t,
    ) ||
    /\badd\b.*\bfood chart\b/.test(t)
  ) {
    return { type: "start_food_chart_wizard", raw };
  }

  // 3. Recipe master search
  const recipeSearchMatch = raw.match(
    /(?:search|find|lookup|look up|show)\s+(?:for\s+)?(?:recipe|recipes)(?:\s+(?:for|of|named|called))?\s+(.+)/i,
  );
  if (recipeSearchMatch && recipeSearchMatch[1]?.trim()) {
    return { type: "search_recipe", query: recipeSearchMatch[1].trim() };
  }
  const suffixRecipeMatch = raw.match(/(?:search|find|show)\s+(.+?)\s+recipes?$/i);
  if (suffixRecipeMatch && suffixRecipeMatch[1]?.trim()) {
    return { type: "search_recipe", query: suffixRecipeMatch[1].trim() };
  }

  // 4. Dashboard details filter wizard & quick actions
  if (
    /\b(add|apply|set|change)?\s*filter\b/.test(t) &&
    (currentPath.startsWith("/dashboard/report/") || /\bdashboard\b/.test(t))
  ) {
    return { type: "start_dashboard_filter_wizard", raw };
  }
  if (/\b(reset|clear)\s+filters?\b/.test(t) && currentPath.startsWith("/dashboard/report/")) {
    return { type: "dashboard_reset_filters" };
  }

  // 5. Dashboard specific report or dashboard home
  const dashReportKey = matchDashboardReportKey(t);
  if (dashReportKey && /\b(dashboard|report|open|show)\b/.test(t) && !/\b(build|custom)\b/.test(t)) {
    return { type: "open_dashboard_report", reportKey: dashReportKey };
  }
  if (/\b(show|open|go to)\s+dashboard\b/.test(t) || t === "dashboard") {
    return { type: "open_dashboard" };
  }

  // 6. Step-by-step report builder
  if (
    /\b(show|build|create|run|open|generate)\b.*\breports?\b/.test(t) ||
    t === "report" ||
    t === "reports"
  ) {
    if (currentPath.startsWith("/dashboard/report/") && /\b(this|current)\b/.test(t)) {
      return { type: "dashboard_show_report" };
    }
    return { type: "start_report_wizard", raw };
  }

  // 7. Date stepping on current page
  if (/\b(previous|prev|earlier)\s+(marketing\s+)?date\b/.test(t)) {
    return { type: "date_step", direction: "prev" };
  }
  if (/\b(next|later)\s+(marketing\s+)?date\b/.test(t)) {
    return { type: "date_step", direction: "next" };
  }
  if (/\b(go to|switch to|reset to)\s+today\b/.test(t)) {
    return { type: "date_step", direction: "today" };
  }

  // 8. Theme toggle
  if (/\b(dark mode|dark theme)\b/.test(t)) return { type: "set_theme", dark: true };
  if (/\b(light mode|light theme)\b/.test(t)) return { type: "set_theme", dark: false };

  // 9. General page navigation
  if (/\b(marketing list|shopping list)\b/.test(t)) return { type: "navigate", path: "/marketing-list" };
  if (/\b(add expenses?|expenses? page)\b/.test(t)) return { type: "navigate", path: "/add-expense" };
  if (/\b(food chart|meal plan)\b/.test(t)) return { type: "navigate", path: "/food-chart" };
  if (/\b(recipe master|recipes?)\b/.test(t)) return { type: "navigate", path: "/recipe-master" };
  if (/\b(job status|jobs|schedules?)\b/.test(t)) return { type: "navigate", path: "/job-status" };
  if (/\b(add items?|items?)\b/.test(t)) return { type: "navigate", path: "/add-item" };
  if (/\b(add units?|units?)\b/.test(t)) return { type: "navigate", path: "/add-unit" };
  if (/\b(survivors?)\b/.test(t)) return { type: "navigate", path: "/add-survivor" };
  if (/\b(locations?)\b/.test(t)) return { type: "navigate", path: "/marketing-locations" };

  return { type: "unknown", raw };
}

export function formatVoiceDateSummary(isoDate) {
  return formatLongDateWithWeekday(isoDate) || isoDate;
}
