import React, { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import { assetUrl } from "../lib/api";

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

export default function ProofViewer({ url, title = "Proof PDF", onClose }) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [pageNumbers, setPageNumbers] = useState([]);
  const [renderVersion, setRenderVersion] = useState(0);
  const pdfRef = useRef(null);
  const viewerRef = useRef(null);
  const canvasRefs = useRef(new Map());

  const pages = useMemo(() => pageNumbers, [pageNumbers]);

  useEffect(() => {
    if (!url) return undefined;

    let cancelled = false;
    let objectUrl = "";
    let loadedPdf = null;

    async function loadPdf() {
      setStatus("loading");
      setError("");
      setPdfUrl("");
      setPageNumbers([]);
      canvasRefs.current.clear();

      try {
        const token = localStorage.getItem("token");
        const response = await fetch(assetUrl(url), {
          headers: {
            "X-App-Timezone": "Asia/Kolkata",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Unable to load proof (${response.status})`);
        }

        const bytes = await response.arrayBuffer();
        if (cancelled) return;

        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        setPdfUrl(objectUrl);

        const pdfjs = await import(/* @vite-ignore */ PDFJS_URL);
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        loadedPdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (cancelled) {
          await loadedPdf.destroy();
          return;
        }

        pdfRef.current = loadedPdf;
        setPageNumbers(Array.from({ length: loadedPdf.numPages }, (_, index) => index + 1));
        setRenderVersion((value) => value + 1);
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(err?.message || "Unable to display the PDF.");
        }
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
      pdfRef.current = null;
      if (loadedPdf) loadedPdf.destroy().catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      canvasRefs.current.clear();
    };
  }, [url]);

  useEffect(() => {
    if (!pages.length || !pdfRef.current || !viewerRef.current) return undefined;

    let cancelled = false;

    async function renderPages() {
      try {
        const pdf = pdfRef.current;
        const containerWidth = Math.max(280, viewerRef.current.clientWidth - 16);

        for (const pageNumber of pages) {
          if (cancelled || pdf !== pdfRef.current) return;

          const canvas = canvasRefs.current.get(pageNumber);
          if (!canvas) continue;

          const page = await pdf.getPage(pageNumber);
          if (cancelled || pdf !== pdfRef.current) return;

          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2, containerWidth / baseViewport.width);
          const viewport = page.getViewport({ scale });
          const context = canvas.getContext("2d", { alpha: false });

          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = "100%";
          canvas.style.height = "auto";

          await page.render({ canvasContext: context, viewport }).promise;
        }

        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setError(err?.message || "Unable to render the PDF.");
        }
      }
    }

    renderPages();
    return () => {
      cancelled = true;
    };
  }, [pages, renderVersion]);

  return (
    <Modal
      open={Boolean(url)}
      title={title}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          {pdfUrl ? (
            <a className="secondary" href={pdfUrl} target="_blank" rel="noreferrer">
              Open PDF
            </a>
          ) : null}
          <button className="secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div
        style={{
          minHeight: "55vh",
          maxHeight: "70vh",
          overflow: "auto",
          padding: 8,
          background: "#202124",
          borderRadius: 8,
          position: "relative",
        }}
      >
        {status === "loading" ? (
          <div style={{ minHeight: "55vh", display: "grid", placeItems: "center" }}>
            Loading PDF…
          </div>
        ) : null}

        {status === "error" ? (
          <div
            style={{
              minHeight: "55vh",
              display: "grid",
              placeItems: "center",
              textAlign: "center",
              padding: 24,
            }}
          >
            <div>
              <p>Unable to display this PDF inside the report window.</p>
              <small style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{error}</small>
            </div>
          </div>
        ) : null}

        <div ref={viewerRef} aria-label="PDF pages">
          {status !== "error"
            ? pages.map((pageNumber) => (
                <canvas
                  key={pageNumber}
                  ref={(node) => {
                    if (node) canvasRefs.current.set(pageNumber, node);
                    else canvasRefs.current.delete(pageNumber);
                  }}
                  aria-label={`PDF page ${pageNumber}`}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "auto",
                    margin: "0 auto 12px",
                    background: "white",
                    borderRadius: 6,
                  }}
                />
              ))
            : null}
        </div>
      </div>
    </Modal>
  );
}
