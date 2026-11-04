import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, FileUp, Plus, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import { api } from "../lib/api";
import Pagination from "../components/Pagination";
import { formatDateKolkata, todayKolkata } from "../utils/dates.js";
import Modal from "../components/Modal";
import ProofViewer from "../components/ProofViewer";
import ConfirmDialog from "../components/ConfirmDialog";
import { usePagination } from "../hooks/usePagination";

const TOTAL_ITEM = "__total__";
const OTHER_ITEM = "__other__";

let tesseractScriptPromise = null;
let warmWorkerPromise = null;

function loadTesseractScript() {
  if (typeof window !== "undefined" && window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (tesseractScriptPromise) {
    return tesseractScriptPromise;
  }
  tesseractScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-tesseract-cdn="true"]');
    if (existing && window.Tesseract) {
      resolve(window.Tesseract);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.async = true;
    script.dataset.tesseractCdn = "true";
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("Tesseract failed to initialize"));
    };
    script.onerror = () => {
      const fallback = document.createElement("script");
      fallback.src = "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js";
      fallback.async = true;
      fallback.onload = () => {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error("Tesseract fallback failed to initialize"));
      };
      fallback.onerror = () => {
        tesseractScriptPromise = null;
        reject(new Error("Unable to load OCR engine"));
      };
      document.head.appendChild(fallback);
    };
    document.head.appendChild(script);
  });
  return tesseractScriptPromise;
}

function getWarmOcrWorker() {
  if (warmWorkerPromise) {
    return warmWorkerPromise;
  }
  warmWorkerPromise = (async () => {
    try {
      const Tesseract = await loadTesseractScript();
      if (typeof Tesseract.createWorker === "function") {
        const worker = await Tesseract.createWorker("eng");
        return { worker, Tesseract };
      }
      return { worker: null, Tesseract };
    } catch (err) {
      warmWorkerPromise = null;
      throw err;
    }
  })();
  return warmWorkerPromise;
}

async function recognizeCanvasFast(canvas) {
  const { worker, Tesseract } = await getWarmOcrWorker();
  if (worker && typeof worker.recognize === "function") {
    return worker.recognize(canvas);
  }
  return Tesseract.recognize(canvas, "eng");
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function parseStrictCurrencyNumber(rawToken) {
  if (!rawToken) return null;
  const trimmed = String(rawToken)
    .replace(/^[₹$€£?%ftzFrR(]+/i, "")
    .trim();
  // Reject tokens that contain trailing letters (e.g. "080s" from bank account "0808")
  if (/[a-zA-Z]/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const integerPart = cleaned.split(".")[0];
  // Bank account masks (e.g. "0808") start with leading '0'; valid rupee amounts >= 1 never start with '0'
  if (integerPart.length > 1 && integerPart.startsWith("0")) return null;
  if (integerPart.length >= 8) return null;
  const val = Number(cleaned);
  if (!Number.isFinite(val) || val <= 0 || val > 10000000) return null;
  return val;
}

/**
 * Isolates the giant hero amount digits (e.g. "18" in "₹18") directly from the top-center
 * region of a Google Pay / UPI screenshot and strips the shorter superscript '₹' column
 * before OCR so '₹' is never misread as '2', '3', or '7' and bank codes like "0808" are excluded.
 */
function buildPureHeroDigitsCanvas(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext("2d");
  srcCtx.drawImage(img, 0, 0, w, h);

  const imgData = srcCtx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  const chroma = new Float32Array(w * h);
  for (let i = 0, p = 0; i < imgData.length; i += 4, p += 1) {
    const r = imgData[i];
    const g = imgData[i + 1];
    const b = imgData[i + 2];
    lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    chroma[p] = Math.max(r, g, b) - Math.min(r, g, b);
  }

  // Determine whether screenshot is dark theme or light theme across y: 8%..55%
  const sampleY0 = Math.floor(h * 0.08);
  const sampleY1 = Math.floor(h * 0.55);
  const sampleX0 = Math.floor(w * 0.08);
  const sampleX1 = Math.floor(w * 0.92);
  let lumSum = 0;
  let lumCount = 0;
  for (let y = sampleY0; y < sampleY1; y += 2) {
    for (let x = sampleX0; x < sampleX1; x += 2) {
      lumSum += lum[y * w + x];
      lumCount += 1;
    }
  }
  const isDark = lumSum / Math.max(lumCount, 1) < 125;

  // Neutral foreground intensity: zero out saturated colored pixels (blue checkmark circle, purple avatar, green tick)
  const fg = new Float32Array(w * h);
  for (let p = 0; p < lum.length; p += 1) {
    if (chroma[p] >= 48) {
      fg[p] = 0;
    } else {
      fg[p] = isDark ? lum[p] : 255 - lum[p];
    }
  }

  // Search for hero amount bands across y: 10%..55% (covers both GPay receipt screen and GPay blue-tick "Paid to" screen)
  const yStart = Math.floor(h * 0.1);
  const yEnd = Math.floor(h * 0.55);
  const xStart = Math.floor(w * 0.12);
  const xEnd = Math.floor(w * 0.88);

  const runs = [];
  let inRun = false;
  let runStart = yStart;

  for (let y = yStart; y < yEnd; y += 1) {
    let brightCount = 0;
    for (let x = xStart; x < xEnd; x += 1) {
      if (fg[y * w + x] > 135) brightCount += 1;
    }
    const active = brightCount >= 2 && brightCount < Math.floor(w * 0.26);
    if (active && !inRun) {
      inRun = true;
      runStart = y;
    } else if (!active && inRun) {
      inRun = false;
      runs.push({ y0: runStart, y1: y - 1, bh: y - runStart });
    }
  }
  if (inRun) {
    runs.push({ y0: runStart, y1: yEnd - 1, bh: yEnd - runStart });
  }

  const minHeroHeight = Math.max(16, Math.floor(h * 0.024));
  const candidates = [];

  for (const band of runs) {
    if (band.bh < minHeroHeight) continue;
    const { y0: by0, y1: by1, bh } = band;

    const colRuns = [];
    let inCol = false;
    let colStart = xStart;

    const pushColRun = (cx0, cx1) => {
      let minY = bh;
      let maxY = -1;
      for (let ry = 0; ry <= by1 - by0; ry += 1) {
        for (let cx = cx0; cx <= cx1; cx += 1) {
          if (fg[(by0 + ry) * w + cx] > 130) {
            if (ry < minY) minY = ry;
            if (ry > maxY) maxY = ry;
          }
        }
      }
      if (maxY >= minY) {
        colRuns.push({
          x0: cx0,
          x1: cx1,
          w: cx1 - cx0 + 1,
          cy0: minY,
          cy1: maxY,
          ch: maxY - minY + 1,
        });
      }
    };

    for (let x = xStart; x < xEnd; x += 1) {
      let colMax = 0;
      for (let y = by0; y <= by1; y += 1) {
        const val = fg[y * w + x];
        if (val > colMax) colMax = val;
      }
      if (colMax > 130 && !inCol) {
        inCol = true;
        colStart = x;
      } else if (colMax <= 130 && inCol) {
        inCol = false;
        pushColRun(colStart, x - 1);
      }
    }
    if (inCol) {
      pushColRun(colStart, xEnd - 1);
    }

    // A hero rupee amount ("₹" + 1..9 digit/comma columns) has between 2 and 10 character columns
    if (colRuns.length < 2 || colRuns.length > 10) continue;

    const tallCols = colRuns.slice(1).filter((cr) => cr.ch > bh * 0.5);
    if (!tallCols.length) continue;

    const maxCh = Math.max(...tallCols.map((cr) => cr.ch));
    const maxCy1 = Math.max(...tallCols.map((cr) => cr.cy1));
    const first = colRuns[0];
    const hasSuperscriptRupee =
      first.ch < maxCh * 0.85 || maxCy1 - first.cy1 > maxCh * 0.12;

    candidates.push({
      by0,
      by1,
      bh,
      colRuns,
      hasSuperscriptRupee,
      digitRuns: hasSuperscriptRupee ? colRuns.slice(1) : colRuns,
      score: bh * 2 + (hasSuperscriptRupee ? 120 : 0),
    });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates[0];
  const { by0, by1, digitRuns } = chosen;

  const dx0 = Math.max(0, digitRuns[0].x0 - 6);
  const dx1 = Math.min(w, digitRuns[digitRuns.length - 1].x1 + 7);
  const dy0 = Math.max(0, by0 - 6);
  const dy1 = Math.min(h, by1 + 7);
  const cw = Math.max(1, dx1 - dx0);
  const ch = Math.max(1, dy1 - dy0);

  const padX = 30;
  const padY = 20;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = cw + padX * 2;
  outCanvas.height = ch + padY * 2;
  const outCtx = outCanvas.getContext("2d");
  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);

  const cropImgData = outCtx.createImageData(cw, ch);
  const dst = cropImgData.data;
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const invVal = 255 - fg[(dy0 + y) * w + (dx0 + x)];
      const contrasted = Math.max(0, Math.min(255, Math.round((invVal - 128) * 1.4 + 128)));
      const idx = (y * cw + x) * 4;
      dst[idx] = contrasted;
      dst[idx + 1] = contrasted;
      dst[idx + 2] = contrasted;
      dst[idx + 3] = 255;
    }
  }
  outCtx.putImageData(cropImgData, padX, padY);
  return outCanvas;
}

function buildNormalizedCanvas(img, crop = { x: 0.05, y: 0.08, w: 0.9, h: 0.75 }, targetWidth = 380) {
  const sx = Math.floor(img.naturalWidth * crop.x);
  const sy = Math.floor(img.naturalHeight * crop.y);
  const sw = Math.max(1, Math.floor(img.naturalWidth * crop.w));
  const sh = Math.max(1, Math.floor(img.naturalHeight * crop.h));

  const scale = Math.min(1.25, Math.max(0.6, targetWidth / sw));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

  const imageData = ctx.getImageData(0, 0, dw, dh);
  const data = imageData.data;

  let lumSum = 0;
  const pixelCount = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    lumSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const avgLum = lumSum / Math.max(pixelCount, 1);
  const isDarkTheme = avgLum < 125;

  for (let i = 0; i < data.length; i += 4) {
    let lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (isDarkTheme) {
      lum = 255 - lum;
    }
    const enhanced = Math.max(0, Math.min(255, Math.round((lum - 128) * 1.35 + 128)));
    data[i] = enhanced;
    data[i + 1] = enhanced;
    data[i + 2] = enhanced;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function extractAmountFromFullText(rawText) {
  if (!rawText) return null;
  const lines = String(rawText)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 1. Check explicit Google Pay confirmation sentence: "Payment of ₹18 completed"
  let paymentOfRaw = null;
  for (const line of lines) {
    const m = line.match(/payment\s+of\s+([₹$%?ftzFrR]?\s*[0-9][0-9,.]*)\s+completed/i);
    if (m) {
      paymentOfRaw = m[1].replace(/[^0-9.]/g, "");
      break;
    }
  }

  // 2. Check standalone numeric line between "To <Name>" and "Completed" / "Pay again",
  //    OR immediately above "Paid to" (for Google Pay's blue-checkmark confirmation screen)
  let heroRaw = null;
  const toIdx = lines.findIndex((l) => /^to\s+/i.test(l));
  const completedIdx = lines.findIndex((l) => /\b(?:completed|pay\s*again)\b/i.test(l));
  if (toIdx !== -1 && completedIdx !== -1 && completedIdx > toIdx) {
    for (let i = toIdx + 1; i < completedIdx; i += 1) {
      const m = lines[i].match(/^[₹$%?ftzFrR]?\s*([0-9][0-9,.]*)$/);
      if (m) {
        heroRaw = m[1].replace(/,/g, "");
        break;
      }
    }
  }

  if (!heroRaw) {
    const paidToIdx = lines.findIndex((l) => /^paid\s+to\b/i.test(l));
    if (paidToIdx > 0) {
      for (let i = paidToIdx - 1; i >= 0; i -= 1) {
        const m = lines[i].match(/^[₹$%?ftzFrR]?\s*([0-9][0-9,.]*)$/);
        if (m) {
          heroRaw = m[1].replace(/,/g, "");
          break;
        }
      }
    }
  }

  if (heroRaw && paymentOfRaw) {
    if (heroRaw.length === paymentOfRaw.length - 1 && paymentOfRaw.endsWith(heroRaw)) {
      return parseStrictCurrencyNumber(heroRaw);
    }
    if (paymentOfRaw.length === heroRaw.length - 1 && heroRaw.endsWith(paymentOfRaw)) {
      return parseStrictCurrencyNumber(paymentOfRaw);
    }
  }

  const bankOrMetaPattern =
    /\b(?:bank|banking\s*name|a\/c|account|upi\s*transaction|google\s*transaction|transaction\s*id|@|phonepe|okicici|oksbi|okaxis|okhdfcbank)\b/i;

  for (const line of lines) {
    if (bankOrMetaPattern.test(line)) continue;
    const m = line.match(/(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[1-9][0-9]*(?:\.[0-9]{1,2})?)/i);
    if (m) {
      const val = parseStrictCurrencyNumber(m[1]);
      if (val !== null) return val;
    }
  }

  if (heroRaw) {
    return parseStrictCurrencyNumber(heroRaw);
  }
  if (paymentOfRaw) {
    return parseStrictCurrencyNumber(paymentOfRaw);
  }

  return null;
}

async function detectAmountFromScreenshot(file) {
  const img = await loadImageElement(file);

  // Step 1: Isolate the pure hero digits canvas (with the shorter superscript '₹' column removed!)
  const pureDigitsCanvas = buildPureHeroDigitsCanvas(img);
  if (pureDigitsCanvas) {
    if (typeof window !== "undefined" && "TextDetector" in window) {
      try {
        const detector = new window.TextDetector();
        const blocks = await detector.detect(pureDigitsCanvas);
        for (const b of blocks || []) {
          const val = parseStrictCurrencyNumber(b?.rawValue);
          if (val !== null) return val;
        }
      } catch {
        // Continue to Tesseract worker
      }
    }

    const pureResult = await recognizeCanvasFast(pureDigitsCanvas);
    const pureText = String(pureResult?.data?.text || "").trim();
    const tokenMatch = pureText.match(/([1-9][0-9,]*(?:\.[0-9]{1,2})?)/);
    if (tokenMatch) {
      const val = parseStrictCurrencyNumber(tokenMatch[1]);
      if (val !== null) {
        return val;
      }
    }
  }

  // Step 2: Fallback full-receipt OCR if the screenshot is a non-standard layout
  const fallbackCanvas = buildNormalizedCanvas(
    img,
    { x: 0.05, y: 0.08, w: 0.9, h: 0.72 },
    380,
  );
  const fullResult = await recognizeCanvasFast(fallbackCanvas);
  return extractAmountFromFullText(fullResult?.data?.text || "");
}

function formatExpenseDate(value) {
  return formatDateKolkata(value);
}

const today = todayKolkata;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function emptyForm(date = today()) {
  return {
    expenseDate: date,
    categoryId: "",
    itemId: TOTAL_ITEM,
    otherItem: "",
    quantity: "",
    unitId: "",
    totalCost: "",
    expenseType: "cash",
    comment: "",
    proofFile: null,
    shares: [],
  };
}

function resolvedShares(totalCost, shares) {
  const total = Number(totalCost || 0);
  const fixed = shares
    .filter((share) => share.shareType === "fixed")
    .reduce((sum, share) => sum + Number(share.amount || 0), 0);

  const average = shares.filter((share) => share.shareType === "average");

  const remaining = shares.find((share) => share.shareType === "remaining");

  let left = Math.round((total - fixed) * 100) / 100;

  if (left < 0) {
    return {
      values: {},
      valid: false,
      reason: "Fixed shares exceed total cost",
    };
  }

  const values = {};

  if (average.length) {
    const cents = Math.round(left * 100);
    const baseCents = Math.floor(cents / average.length);
    const extraCents = cents % average.length;

    average.forEach((share, index) => {
      values[share.survivorId] = (baseCents + (index < extraCents ? 1 : 0)) / 100;
    });

    left = 0;
  }

  if (remaining) {
    values[remaining.survivorId] = Math.max(0, left);
    left = 0;
  }

  shares
    .filter((share) => share.shareType === "fixed")
    .forEach((share) => {
      values[share.survivorId] = Number(share.amount || 0);
    });

  const hasDynamic = average.length || Boolean(remaining);

  const valid = Math.abs(left) < 0.01 && (hasDynamic || Math.abs(fixed - total) < 0.01);

  return {
    values,
    valid,
    reason: valid ? "" : "Share amounts must equal total cost",
  };
}

export default function Expense() {
  const pagination = usePagination("expenses", "expense_date");

  const [page, setPage] = useState(1);
  const [date, setDate] = useState(today());
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);

  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [survivors, setSurvivors] = useState([]);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);

  const [proofExpense, setProofExpense] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [proofViewerUrl, setProofViewerUrl] = useState("");
  const [deleteId, setDeleteId] = useState(null);
  const [formError, setFormError] = useState("");
  const [proofInputKey, setProofInputKey] = useState(0);
  const [scanningProof, setScanningProof] = useState(false);
  const [scanFeedback, setScanFeedback] = useState("");
  const proofInputRef = useRef(null);
  const modalProofInputRef = useRef(null);
  const scanSeqRef = useRef(0);

  // Pre-warm the OCR worker as soon as the Add Expense page opens so scanning is instant when an image is picked
  useEffect(() => {
    const timer = setTimeout(() => {
      getWarmOcrWorker().catch(() => {});
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const resetProofInput = () => {
    scanSeqRef.current += 1;
    setScanningProof(false);
    setScanFeedback("");
    if (proofInputRef.current) {
      proofInputRef.current.value = "";
    }
    setProofInputKey((current) => current + 1);
  };

  const handleProofFileChange = async (file) => {
    if (!file) {
      scanSeqRef.current += 1;
      setScanningProof(false);
      setScanFeedback("");
      updateField("proofFile", null);
      return;
    }

    const isImage =
      String(file.type || "").startsWith("image/") ||
      /\.(?:png|jpe?g|webp)$/i.test(String(file.name || ""));

    if (!isImage) {
      scanSeqRef.current += 1;
      setScanningProof(false);
      setScanFeedback("");
      updateField("proofFile", file);
      return;
    }

    const seq = ++scanSeqRef.current;

    // Instantly switch Expense type to Online as soon as the screenshot is chosen
    setForm((current) => ({
      ...current,
      proofFile: file,
      expenseType: "online",
    }));

    setScanningProof(true);
    setScanFeedback("Scanning screenshot amount…");

    try {
      const detectedAmount = await detectAmountFromScreenshot(file);
      if (scanSeqRef.current !== seq) return;
      if (detectedAmount !== null && detectedAmount > 0) {
        const formatted = String(Number(detectedAmount.toFixed(2)));
        setForm((current) => ({
          ...current,
          proofFile: file,
          expenseType: "online",
          totalCost: formatted,
        }));
        setScanFeedback(
          `Auto-filled ₹${Number(detectedAmount).toFixed(2)} & set Expense type to Online.`,
        );
      } else {
        setScanFeedback(
          "Expense type set to Online. Could not read amount from image — please enter Total cost.",
        );
      }
    } catch {
      if (scanSeqRef.current !== seq) return;
      setScanFeedback("Expense type set to Online. Please enter Total cost.");
    } finally {
      if (scanSeqRef.current === seq) {
        setScanningProof(false);
      }
    }
  };

  const shareCalculation = useMemo(
    () => resolvedShares(form.totalCost, form.shares),
    [form.totalCost, form.shares],
  );

  const loadMeta = async () => {
    const [categoryData, unitData, survivorData] = await Promise.all([
      api("/meta/categories", {
        loadingMessage: "Loading expense categories…",
      }),
      api("/meta/units", {
        loadingMessage: "Loading expense units…",
      }),
      api("/meta/survivors", {
        loadingMessage: "Loading survivors…",
      }),
    ]);

    /*
     * Metadata endpoints normally return arrays. Accept arrays as well as
     * paginated { rows }, { data }, or { items } responses so an API-shape
     * difference can never cause a .map() runtime error in this page.
     */
    setCategories(asArray(categoryData));
    setUnits(asArray(unitData));
    setSurvivors(asArray(survivorData));
  };

  const loadItems = async (selectedCategory) => {
    if (!selectedCategory) {
      setItems([]);
      return;
    }

    const data = await api(`/meta/items/${selectedCategory}`, {
      loadingMessage: "Loading items…",
    });

    setItems(asArray(data));
  };

  const loadExpenses = async (requestedPage = page, requestedDate = date) => {
    if (!pagination.ready) return;

    const result = await api(
      `/expenses?date=${encodeURIComponent(requestedDate)}&page=${requestedPage}&pageSize=${
        pagination.pageSize
      }&search=${encodeURIComponent(pagination.search)}&sortColumn=${encodeURIComponent(
        pagination.sortColumn || "expense_date",
      )}&sortDirection=${pagination.sortDirection}`,
      {
        loadingMessage: "Loading expenses…",
      },
    );

    setRows(Array.isArray(result?.rows) ? result.rows : []);
    setTotal(Number(result?.total || 0));
  };

  useEffect(() => {
    loadMeta().catch(() => {});
  }, []);

  useEffect(() => {
    if (!categories.length || !units.length) return;
    let prefill;
    try { prefill = JSON.parse(localStorage.getItem("marketing-purchase-prefill") || "null"); } catch { prefill = null; }
    if (!prefill?.marketingItemId && !Array.isArray(prefill?.marketingItemIds)) return;
    setEditingId(null);
    setDate(prefill.expenseDate || today());
    setForm({ ...emptyForm(prefill.expenseDate || today()), categoryId: String(prefill.categoryId || ""), itemId: prefill.marketingItemIds ? TOTAL_ITEM : String(prefill.itemId || (prefill.itemName ? OTHER_ITEM : TOTAL_ITEM)), otherItem: prefill.marketingItemIds ? "" : (prefill.itemId ? "" : String(prefill.itemName || "")), quantity: prefill.marketingItemIds ? "" : (prefill.quantity ?? ""), unitId: prefill.marketingItemIds ? "" : String(prefill.unitId || ""), comment: String(prefill.comment || "") });
    resetProofInput();
    if (prefill.categoryId) loadItems(String(prefill.categoryId)).catch(() => {});
  }, [categories, units]);

  useEffect(() => {
    loadExpenses().catch(() => {});
  }, [
    date,
    page,
    pagination.pageSize,
    pagination.search,
    pagination.sortColumn,
    pagination.sortDirection,
    pagination.ready,
  ]);

  useEffect(() => {
    setPage(1);
  }, [date, pagination.pageSize, pagination.search]);

  useEffect(() => {
    if (!form.categoryId) {
      setItems([]);
      return;
    }

    loadItems(form.categoryId).catch(() => {});
  }, [form.categoryId]);

  const updateField = (key, value) =>
    setForm((current) => ({
      ...current,
      [key]: value,
    }));

  const addShare = () => {
    const used = new Set(form.shares.map((share) => String(share.survivorId)));

    const available = survivors.find((survivor) => !used.has(String(survivor.id)));

    if (!available) return;

    updateField("shares", [
      ...form.shares,
      {
        survivorId: String(available.id),
        shareType: "fixed",
        amount: "",
      },
    ]);
  };

  const editShare = (index, key, value) =>
    updateField(
      "shares",
      form.shares.map((share, currentIndex) =>
        currentIndex === index
          ? {
              ...share,
              [key]: value,
            }
          : share,
      ),
    );

  const removeShare = (index) =>
    updateField(
      "shares",
      form.shares.filter((_, currentIndex) => currentIndex !== index),
    );

  const submit = async (event) => {
    event.preventDefault();
    setFormError("");

    if (!shareCalculation.valid) {
      setFormError(shareCalculation.reason);
      return;
    }

    const payload = { ...form };
    delete payload.proofFile;

    const result = await api(editingId ? `/expenses/${editingId}` : "/expenses", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(payload),
      loadingMessage: editingId ? "Updating expense…" : "Adding expense…",
    });

    const expenseId = result.id;
    let marketingPrefill = null;
    try { marketingPrefill = JSON.parse(localStorage.getItem("marketing-purchase-prefill") || "null"); } catch { marketingPrefill = null; }
    if ((marketingPrefill?.marketingItemId || Array.isArray(marketingPrefill?.marketingItemIds)) && expenseId) {
      try {
        if (Array.isArray(marketingPrefill.marketingItemIds)) {
          await api("/marketing-list/purchased-bulk", {
            method: "POST",
            body: JSON.stringify({ itemIds: marketingPrefill.marketingItemIds, expenseId, price: payload.totalCost }),
          });
        } else {
          await api(`/marketing-list/${marketingPrefill.marketingItemId}/purchased`, {
            method: "POST",
            body: JSON.stringify({ expenseId, price: payload.totalCost, quantity: payload.quantity, unitId: payload.unitId }),
          });
        }
        localStorage.removeItem("marketing-purchase-prefill");
      } catch (error) {
        setFormError(`Expense saved, but the Marketing List status could not be updated: ${error.message || "Please retry from Marketing List"}`);
      }
    }

    if (form.proofFile && expenseId) {
      const data = new FormData();
      data.append("proof", form.proofFile);

      await api(`/expenses/${expenseId}/proof`, {
        method: "POST",
        body: data,
        loadingMessage: "Uploading proof…",
      });
    }

    const savedDate = String(payload.expenseDate);

    setEditingId(null);
    setDate(savedDate);
    setPage(1);
    setForm(emptyForm(savedDate));
    resetProofInput();

    await loadExpenses(1, savedDate);
  };

  const beginEdit = async (row) => {
    setEditingId(row.id);
    setDate(row.expense_date.slice(0, 10));

    setForm({
      expenseDate: row.expense_date.slice(0, 10),
      categoryId: String(row.category_id),
      itemId: row.item_id ? String(row.item_id) : row.other_item ? OTHER_ITEM : TOTAL_ITEM,
      otherItem: row.other_item || "",
      quantity: row.quantity ?? "",
      unitId: row.unit_id ? String(row.unit_id) : "",
      totalCost: row.total_cost,
      expenseType: row.expense_type || "cash",
      comment: row.comment || "",
      proofFile: null,
      shares: Array.isArray(row.shares)
        ? row.shares.map((share) => ({
            survivorId: String(share.survivorId),
            shareType: share.shareType,
            amount: share.shareType === "fixed" ? share.amount : "",
          }))
        : [],
    });

    resetProofInput();

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const remove = async () => {
    await api(`/expenses/${deleteId}`, {
      method: "DELETE",
      loadingMessage: "Removing expense…",
    });

    setDeleteId(null);
    await loadExpenses();
  };

  const submitProof = async (event) => {
    event.preventDefault();

    if (!proofFile || !proofExpense) return;

    const data = new FormData();
    data.append("proof", proofFile);

    await api(`/expenses/${proofExpense.id}/proof`, {
      method: "POST",
      body: data,
      loadingMessage: "Uploading proof…",
    });

    setProofFile(null);
    setProofExpense(null);

    await loadExpenses();
  };

  const openProof = async (row) => {
    const result = await api(`/expenses/${row.id}/proof-url`, {
      loadingMessage: "Opening proof…",
    });

    setProofViewerUrl(result.url || "");
  };

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Add Expenses</h1>
          <p>Record an expense and allocate its cost across survivors.</p>
        </div>
      </div>

      <form className="card form-stack" onSubmit={submit}>
        <div className="section-label">Expense details</div>

        <label>
          Date of expense
          <input
            type="date"
            max={today()}
            value={form.expenseDate}
            onChange={(e) => {
              setDate(e.target.value);
              updateField("expenseDate", e.target.value);
            }}
            required
          />
        </label>

        <label>
          Category
          <select
            value={form.categoryId}
            required
            onChange={(e) => {
              updateField("categoryId", e.target.value);
              updateField("itemId", TOTAL_ITEM);
              updateField("otherItem", "");
            }}
          >
            <option value="">Select category</option>

            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Item
          <select
            value={form.itemId}
            onChange={(e) => {
              updateField("itemId", e.target.value);

              if (e.target.value !== OTHER_ITEM) {
                updateField("otherItem", "");
              }
            }}
            disabled={!form.categoryId}
          >
            <option value={TOTAL_ITEM}>Total</option>

            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}

            <option value={OTHER_ITEM}>Other</option>
          </select>
        </label>

        {form.itemId === OTHER_ITEM ? (
          <label>
            Other item
            <input
              required
              value={form.otherItem}
              onChange={(e) => updateField("otherItem", e.target.value)}
            />
          </label>
        ) : null}

        <label>
          Quantity
          <input
            type="number"
            min="0"
            step="0.0001"
            value={form.quantity}
            onChange={(e) => updateField("quantity", e.target.value)}
          />
        </label>

        <label>
          Unit
          <select value={form.unitId} onChange={(e) => updateField("unitId", e.target.value)}>
            <option value="">No unit</option>

            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Attach proof (optional — choosing a Google Pay / UPI screenshot auto-fills Total cost & Online mode)
          <input
            key={proofInputKey}
            ref={proofInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => handleProofFileChange(e.target.files?.[0] || null)}
          />
          {scanFeedback ? (
            <small
              className="field-note"
              style={{
                color: scanningProof ? "#2563eb" : "#15803d",
                fontWeight: 600,
              }}
            >
              {scanFeedback}
            </small>
          ) : null}
          <small className="field-note">
            Images are converted to PDF before S3-compatible storage upload.
          </small>
        </label>

        <label>
          Total cost
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.totalCost}
            placeholder={scanningProof ? "Scanning screenshot amount…" : ""}
            onChange={(e) => updateField("totalCost", e.target.value)}
          />
        </label>

        <label>
          Expense type
          <select
            value={form.expenseType}
            onChange={(e) => updateField("expenseType", e.target.value)}
          >
            <option value="cash">Cash</option>
            <option value="online">Online</option>
          </select>
        </label>

        <label>
          Comment
          <textarea
            rows="3"
            value={form.comment}
            onChange={(e) => updateField("comment", e.target.value)}
          />
        </label>

        <div className="shares-panel">
          <div className="shares-heading">
            <div>
              <strong>Share of expense — mandatory</strong>

              <span>Fixed, average and remaining shares are resolved against total cost.</span>
            </div>

            <button
              className="secondary"
              type="button"
              onClick={addShare}
              disabled={!survivors.length || form.shares.length >= survivors.length}
            >
              <Plus size={17} /> Add survivor
            </button>
          </div>

          {form.shares.map((share, index) => (
            <div className="share-row" key={`${share.survivorId}-${index}`}>
              <label>
                Survivor
                <select
                  required
                  value={share.survivorId}
                  onChange={(e) => editShare(index, "survivorId", e.target.value)}
                >
                  {survivors.map((survivor) => (
                    <option
                      key={survivor.id}
                      value={survivor.id}
                      disabled={form.shares.some(
                        (other, otherIndex) =>
                          otherIndex !== index && String(other.survivorId) === String(survivor.id),
                      )}
                    >
                      {survivor.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Share type
                <div
                  role="group"
                  aria-label="Share type"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: "0.5rem",
                  }}
                >
                  {[
                    ["fixed", "Fixed amount"],
                    ["average", "Average amount"],
                    ["remaining", "Remaining amount"],
                  ].map(([value, label]) => {
                    const selected = share.shareType === value;

                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        className={selected ? "primary" : "secondary"}
                        onClick={() => editShare(index, "shareType", value)}
                        style={{
                          minHeight: "42px",
                          justifyContent: "center",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </label>

              <label>
                Share price
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={share.amount}
                  onChange={(e) => editShare(index, "amount", e.target.value)}
                  readOnly={share.shareType === "average" || share.shareType === "remaining"}
                />
              </label>

              <button
                className="icon-button danger-soft"
                type="button"
                title="Remove survivor share"
                onClick={() => removeShare(index)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}

          {!form.shares.length ? (
            <div className="notice">
              <X size={16} /> Add at least one survivor share.
            </div>
          ) : null}

          {form.shares.length && form.totalCost ? (
            <div className={`share-result ${shareCalculation.valid ? "valid" : "invalid"}`}>
              <span>{shareCalculation.valid ? <Check size={16} /> : <X size={16} />}</span>

              {shareCalculation.valid
                ? "Share allocation matches total cost."
                : shareCalculation.reason}
            </div>
          ) : null}
        </div>

        {formError ? (
          <div className="notice error-notice">
            <X size={16} /> {formError}
          </div>
        ) : null}

        <div className="form-actions">
          <button className="primary" type="submit">
            <UploadCloud size={18} />

            {editingId ? "Update expense" : "Add expense"}
          </button>

          <button
            className="secondary"
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm(date));
              setFormError("");
              resetProofInput();
            }}
          >
            <RotateCcw size={17} /> Reset
          </button>
        </div>
      </form>

      <div className="subheading">
        <div>
          <h2>Expenses for {date}</h2>
          <p>All expenses recorded for the selected date.</p>
        </div>
      </div>

      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[
          {
            value: "expense_date",
            label: "Date",
          },
          {
            value: "category",
            label: "Category",
          },
          {
            value: "item",
            label: "Item",
          },
          {
            value: "total_cost",
            label: "Cost",
          },
          {
            value: "expense_type",
            label: "Type",
          },
        ]}
      />

      <div className="list-stack">
        {rows.map((row) => (
          <article className="list-card expense-card" key={row.id}>
            <div className="list-main">
              <strong>
                {formatExpenseDate(row.expense_date)} · ₹{Number(row.total_cost).toFixed(2)} ·{" "}
                {row.category} · {row.item || row.other_item || "Total"}
              </strong>

              {row.quantity !== null && row.quantity !== undefined && row.quantity !== "" ? (
                <span>
                  {row.quantity}
                  {row.unit ? ` ${row.unit}` : ""}
                </span>
              ) : null}

              <span>{row.comment || "No comment"}</span>

              <span>
                Shares:{" "}
                {(Array.isArray(row.shares) ? row.shares : [])
                  .map(
                    (share) =>
                      `${share.survivorName} ₹${Number(share.amount).toFixed(
                        2,
                      )} (${share.shareType})`,
                  )
                  .join(" · ")}
              </span>
            </div>

            <div className="row-actions">
              <button
                className="icon-button soft"
                title="Update expense"
                onClick={() => beginEdit(row)}
              >
                <Edit3Icon />
              </button>

              <button
                className="icon-button soft"
                title="Upload proof"
                onClick={() => {
                  setProofExpense(row);
                  setProofFile(null);
                }}
              >
                <FileUp size={17} />
              </button>

              {row.proof_key ? (
                <button
                  className="icon-button soft"
                  title="Open proof"
                  onClick={() => openProof(row)}
                >
                  <Eye size={17} />
                </button>
              ) : null}

              <button
                className="icon-button danger-soft"
                title="Remove expense"
                onClick={() => setDeleteId(row.id)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}

        {!rows.length ? (
          <div className="empty-card">No expenses recorded for this date.</div>
        ) : null}
      </div>

      <Pagination
        page={page}
        setPage={setPage}
        total={total}
        {...pagination}
        sortOptions={[
          {
            value: "expense_date",
            label: "Date",
          },
          {
            value: "category",
            label: "Category",
          },
          {
            value: "item",
            label: "Item",
          },
          {
            value: "total_cost",
            label: "Cost",
          },
          {
            value: "expense_type",
            label: "Type",
          },
        ]}
      />

      <Modal
        open={Boolean(proofExpense)}
        title={`Upload proof for expense #${proofExpense?.id || ""}`}
        onClose={() => setProofExpense(null)}
        footer={
          <>
            <button className="secondary" onClick={() => setProofExpense(null)}>
              Cancel
            </button>

            <button className="primary" form="proof-form">
              Submit
            </button>
          </>
        }
      >
        <form id="proof-form" className="form-stack" onSubmit={submitProof}>
          <label>
            Proof file
            <input
              key={proofExpense?.id || "proof-modal-input"}
              ref={modalProofInputRef}
              required
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => setProofFile(e.target.files?.[0] || null)}
            />
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteId)}
        message="This will permanently remove the expense and its survivor shares."
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />

      <ProofViewer
        url={proofViewerUrl}
        title="Expense proof"
        onClose={() => setProofViewerUrl("")}
      />
    </section>
  );
}

function Edit3Icon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}
