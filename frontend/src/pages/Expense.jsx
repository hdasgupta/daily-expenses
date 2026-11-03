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

let tesseractLoaderPromise = null;

function loadTesseract() {
  if (typeof window !== "undefined" && window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (tesseractLoaderPromise) {
    return tesseractLoaderPromise;
  }
  tesseractLoaderPromise = new Promise((resolve, reject) => {
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
        tesseractLoaderPromise = null;
        reject(new Error("Unable to load OCR engine"));
      };
      document.head.appendChild(fallback);
    };
    document.head.appendChild(script);
  });
  return tesseractLoaderPromise;
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

function buildPreprocessedCanvas(img, crop = { x: 0, y: 0.05, w: 1, h: 0.9 }, scale = 1.75) {
  const sx = Math.floor(img.naturalWidth * crop.x);
  const sy = Math.floor(img.naturalHeight * crop.y);
  const sw = Math.max(1, Math.floor(img.naturalWidth * crop.w));
  const sh = Math.max(1, Math.floor(img.naturalHeight * crop.h));

  const maxDim = 1800;
  const effectiveScale = Math.min(scale, maxDim / Math.max(sw, sh, 1));
  const dw = Math.max(1, Math.round(sw * Math.max(effectiveScale, 1)));
  const dh = Math.max(1, Math.round(sh * Math.max(effectiveScale, 1)));

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
  const isDarkTheme = avgLum < 128;

  for (let i = 0; i < data.length; i += 4) {
    let lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (isDarkTheme) {
      lum = 255 - lum;
    }
    // Stretch contrast so text becomes crisp dark on light background
    const contrasted = Math.max(0, Math.min(255, (lum - 140) * 1.85 + 140));
    const finalVal = contrasted > 190 ? 255 : contrasted < 75 ? 0 : Math.round(contrasted);
    data[i] = finalVal;
    data[i + 1] = finalVal;
    data[i + 2] = finalVal;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function cleanRupeeWordWithSymbols(wordObj) {
  const rawText = String(wordObj?.text || "").trim();
  if (!rawText) return "";

  const symbols = Array.isArray(wordObj?.symbols) ? wordObj.symbols : [];
  if (symbols.length >= 2) {
    const first = symbols[0];
    const rest = symbols.slice(1);
    const digitSymbols = rest.filter((s) => /[0-9]/.test(String(s?.text || "")));

    if (digitSymbols.length >= 1) {
      const firstChar = String(first?.text || "");
      // If first symbol is non-digit currency/OCR artifact, strip it
      if (/^[₹$€£?ftzFrR]$/.test(firstChar)) {
        return rest.map((s) => s.text).join("");
      }
      // In Google Pay, the ₹ symbol is superscripted (shorter and higher baseline than the digits)
      // and Tesseract 'eng' frequently misreads it as '2', '3', or '7'.
      if (/^[237]$/.test(firstChar) && first?.bbox) {
        const h0 = Math.max(1, (first.bbox.y1 || 0) - (first.bbox.y0 || 0));
        const avgH =
          digitSymbols.reduce(
            (sum, s) => sum + Math.max(1, (s.bbox?.y1 || 0) - (s.bbox?.y0 || 0)),
            0,
          ) / digitSymbols.length;
        const maxY1 = Math.max(...digitSymbols.map((s) => s.bbox?.y1 || 0));
        const baselineGap = maxY1 - (first.bbox.y1 || 0);
        const avgConf =
          digitSymbols.reduce((sum, s) => sum + Number(s.confidence ?? 90), 0) /
          digitSymbols.length;
        const firstConf = Number(first.confidence ?? 90);

        if (
          h0 < avgH * 0.82 ||
          baselineGap > avgH * 0.14 ||
          (firstConf < 74 && avgConf - firstConf > 12)
        ) {
          return rest.map((s) => s.text).join("");
        }
      }
    }
  }

  return rawText;
}

function parseCandidateNumber(rawToken) {
  if (!rawToken) return null;
  const cleaned = String(rawToken)
    .replace(/^[₹$€£?ftzFrR]+/i, "")
    .replace(/,/g, "")
    .trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  // Ignore 10+ digit phone numbers or 12-digit UPI transaction IDs
  const integerPart = cleaned.split(".")[0];
  if (integerPart.length >= 8) return null;
  const val = Number(cleaned);
  if (!Number.isFinite(val) || val <= 0 || val > 10000000) return null;
  return val;
}

function extractBestAmountFromOcrResult(ocrData, isHeroCrop = false) {
  const candidates = [];
  const lines = Array.isArray(ocrData?.lines) ? ocrData.lines : [];

  const ignoreLinePattern =
    /(?:upi\s*transaction\s*id|google\s*transaction\s*id|transaction\s*id|utr|ref\s*no|kb\/s|volte|battery|\d{1,2}:\d{2}\s*(?:am|pm)?|\d{10,12})/i;

  lines.forEach((line, lineIdx) => {
    const rawLineText = String(line?.text || "").trim();
    if (!rawLineText) return;
    if (ignoreLinePattern.test(rawLineText) && !/[₹]|(?:rs\.?|inr)\s*\d/i.test(rawLineText)) {
      return;
    }

    const words = Array.isArray(line?.words) ? line.words : [];
    const normalizedWords = words.map(cleanRupeeWordWithSymbols);
    const reconstructedLine = normalizedWords.join(" ").trim() || rawLineText;

    const lineHeight =
      words.reduce(
        (maxH, w) => Math.max(maxH, (w?.bbox?.y1 || 0) - (w?.bbox?.y0 || 0)),
        0,
      ) || 0;

    // 1. Explicit ₹ / Rs / INR amount match on the line
    const currencyRegex = /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi;
    let match;
    while ((match = currencyRegex.exec(rawLineText)) !== null) {
      const val = parseCandidateNumber(match[1]);
      if (val !== null) {
        candidates.push({
          value: val,
          score: (isHeroCrop ? 140 : 110) + Math.min(lineHeight, 80),
        });
      }
    }

    // 2. Check reconstructed words (after stripping superscript ₹ misreads)
    for (let wIdx = 0; wIdx < normalizedWords.length; wIdx += 1) {
      const wText = normalizedWords[wIdx];
      const origText = String(words[wIdx]?.text || "");
      const hadRupeeOrPrefix =
        /^[₹$€£?ftzFrR]/.test(origText) ||
        origText !== wText ||
        (wIdx > 0 && /^(?:₹|rs\.?|inr|paid|amount|total)$/i.test(normalizedWords[wIdx - 1]));

      const val = parseCandidateNumber(wText);
      if (val === null) continue;

      // Avoid matching years like 2025/2026 when adjacent to month names
      if (
        val >= 2020 &&
        val <= 2035 &&
        /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(rawLineText)
      ) {
        continue;
      }

      const prevLineText = String(lines[lineIdx - 1]?.text || "");
      const nextLineText = String(lines[lineIdx + 1]?.text || "");
      const nextNextLineText = String(lines[lineIdx + 2]?.text || "");
      const nearGPayAnchors =
        /(?:to|paid\s*to|from|request\s*from)/i.test(prevLineText) ||
        /(?:pay\s*again|completed|split\s*with|paid|success|processing)/i.test(
          `${nextLineText} ${nextNextLineText}`,
        );

      const isStandaloneNumericLine =
        normalizedWords.length <= 2 &&
        /^[^a-zA-Z]*\d[\d,.]*[^a-zA-Z]*$/.test(reconstructedLine);

      let score = 0;
      if (hadRupeeOrPrefix) score += 95;
      if (nearGPayAnchors) score += 85;
      if (isHeroCrop && isStandaloneNumericLine) score += 80;
      score += Math.min(lineHeight * 1.2, 90);

      if (score >= 70) {
        candidates.push({ value: val, score });
      }
    }
  });

  if (!candidates.length && ocrData?.text) {
    const fallbackRegex = /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi;
    let m;
    while ((m = fallbackRegex.exec(ocrData.text)) !== null) {
      const val = parseCandidateNumber(m[1]);
      if (val !== null) {
        candidates.push({ value: val, score: 90 });
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].value;
}

async function detectAmountFromScreenshot(file) {
  const img = await loadImageElement(file);

  // 1. Try native browser TextDetector (Chrome on Android / Google ML Kit) first if available
  if (typeof window !== "undefined" && "TextDetector" in window) {
    try {
      const detector = new window.TextDetector();
      const blocks = await detector.detect(img);
      if (Array.isArray(blocks) && blocks.length) {
        const imgH = img.naturalHeight || 1;
        const nativeCandidates = [];
        for (const block of blocks) {
          const text = String(block.rawValue || "").trim();
          const box = block.boundingBox || {};
          const relY = (box.y || 0) / imgH;
          if (relY < 0.05 || relY > 0.85) continue;

          const rupeeMatch = text.match(
            /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
          );
          if (rupeeMatch) {
            const val = parseCandidateNumber(rupeeMatch[1]);
            if (val !== null) {
              nativeCandidates.push({
                value: val,
                score: 150 + (box.height || 0) + (relY >= 0.12 && relY <= 0.55 ? 50 : 0),
              });
            }
          } else if (relY >= 0.12 && relY <= 0.52 && /^₹?\s*\d[\d,.]*$/.test(text)) {
            const val = parseCandidateNumber(text);
            if (val !== null) {
              nativeCandidates.push({
                value: val,
                score: 100 + (box.height || 0),
              });
            }
          }
        }
        if (nativeCandidates.length) {
          nativeCandidates.sort((a, b) => b.score - a.score);
          return nativeCandidates[0].value;
        }
      }
    } catch {
      // Fall through to Tesseract.js OCR
    }
  }

  // 2. Run Tesseract.js on the Google Pay hero amount crop first, then full screenshot if needed
  const Tesseract = await loadTesseract();
  const heroCanvas = buildPreprocessedCanvas(
    img,
    { x: 0.08, y: 0.12, w: 0.84, h: 0.42 },
    2.0,
  );
  const heroResult = await Tesseract.recognize(heroCanvas, "eng");
  const heroAmount = extractBestAmountFromOcrResult(heroResult?.data, true);
  if (heroAmount !== null) {
    return heroAmount;
  }

  const fullCanvas = buildPreprocessedCanvas(
    img,
    { x: 0.04, y: 0.06, w: 0.92, h: 0.86 },
    1.6,
  );
  const fullResult = await Tesseract.recognize(fullCanvas, "eng");
  return extractBestAmountFromOcrResult(fullResult?.data, false);
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
    setScanningProof(true);
    setScanFeedback("Scanning Google Pay / UPI screenshot for total amount…");

    setForm((current) => ({
      ...current,
      proofFile: file,
      expenseType: "online",
    }));

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
          `Detected ₹${Number(detectedAmount).toFixed(2)} from screenshot · Expense type set to Online.`,
        );
      } else {
        setScanFeedback(
          "Expense type set to Online. Could not automatically read the amount — please enter Total cost manually.",
        );
      }
    } catch {
      if (scanSeqRef.current !== seq) return;
      setScanFeedback(
        "Expense type set to Online. Please verify or enter Total cost manually.",
      );
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
          Total cost
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.totalCost}
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

        <label>
          Attach proof (optional — Google Pay / UPI screenshot auto-fills Total cost & Online mode)
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
