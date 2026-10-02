import React from "react";
import Modal from "./Modal";

export default function ProofViewer({ url, title = "Proof PDF", onClose }) {
  return (
    <Modal
      open={Boolean(url)}
      title={title}
      onClose={onClose}
      footer={
        <button className="secondary" type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      {url ? (
        <iframe
          title={title}
          src={url}
          type="application/pdf"
          allow="fullscreen"
          style={{ display: "block", width: "100%", height: "70vh", minHeight: 420, border: 0, borderRadius: 8 }}
        />
      ) : null}
    </Modal>
  );
}
