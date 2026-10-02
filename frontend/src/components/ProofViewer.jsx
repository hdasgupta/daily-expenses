import React, { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { assetUrl } from "../lib/api";

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

export default function ProofViewer({ url, title = "Proof PDF", onClose }) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const viewerRef = useRef(null);

  useEffect(() => {
    if (!url) return undefined;

    let cancelled = false;
    let objectUrl = "";

    async function loadPdf() {
      setStatus("loading");
      setError("");
      try {
        const token = localStorage.getItem("token");
        const response = await fetch(assetUrl(url), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `Unable to load proof (${response.status})`);
        }

        const bytes = await response.arrayBuffer();
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        if (cancelled) return;
        setPdfUrl(objectUrl);

        // Android Chrome often refuses to render a PDF inside an iframe and instead
        // shows an "Open" card. Render the PDF with PDF.js so it is displayed inside
        // this application modal on mobile as well.
        const pdfjs = await import(/* @vite-ignore */ PDFJS_URL);
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (cancelled) return;

        const container = viewerRef.current;
        if (!container) return;
        container.replaceChildren();

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const availableWidth = Math.max(280, container.clientWidth - 16);
          const scale = Math.min(2, availableWidth / baseViewport.width);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.display = "block";
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.margin = "0 auto 12px";
          canvas.style.background = "white";
          canvas.style.borderRadius = "6px";
          container.appendChild(canvas);

          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        }

        if (!cancelled) setStatus("ready");
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
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

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
        ref={viewerRef}
        style={{
          minHeight: "55vh",
          maxHeight: "70vh",
          overflow: "auto",
          padding: 8,
          background: "#202124",
          borderRadius: 8,
        }}
      >
        {status === "loading" ? (
          <div style={{ minHeight: "55vh", display: "grid", placeItems: "center" }}>
            Loading PDF…
          </div>
        ) : null}
        {status === "error" ? (
          <div style={{ minHeight: "55vh", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
            <div>
              <p>Unable to display this PDF inside the report window.</p>
              <small>{error}</small>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
