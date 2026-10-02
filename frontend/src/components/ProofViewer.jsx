import React from "react";
import Modal from "./Modal";

export default function ProofViewer({ url, title = "Proof PDF", onClose }) {
  return (
    <Modal
      open={Boolean(url)}
      title={title}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {url ? (
            <a
              className="secondary"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
            >
              Open PDF
            </a>
          ) : null}
          <button className="secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {url ? (
        <iframe
          title={title}
          src={url}
          style={{ width: "100%", height: "70vh", minHeight: 420, border: 0, borderRadius: 8 }}
          allow="fullscreen"
        />
      ) : null}
    </Modal>
  );
}
