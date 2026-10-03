import React, { useEffect, useState } from "react";
import Modal from "./Modal";
import { Capacitor } from "@capacitor/core";
import { openRemoteFile } from "../lib/download";

export default function ProofViewer({ url, title = "Proof", onClose }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  const isNative = (() => {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    if (!url || !isNative) return;

    let cancelled = false;

    const open = async () => {
      setOpening(true);
      setError("");

      try {
        await openRemoteFile(url, "expense-proof");

        if (!cancelled) {
          onClose?.();
        }
      } catch (openError) {
        if (!cancelled) {
          setError(openError?.message || "Unable to open proof.");
        }
      } finally {
        if (!cancelled) {
          setOpening(false);
        }
      }
    };

    void open();

    return () => {
      cancelled = true;
    };
  }, [url, isNative, onClose]);

  if (isNative) {
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
        {opening ? <div className="empty-card">Opening proof…</div> : null}

        {error ? <div className="notice error-notice">{error}</div> : null}
      </Modal>
    );
  }

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
          style={{
            width: "100%",
            height: "70vh",
            border: 0,
            borderRadius: 8,
          }}
        />
      ) : null}
    </Modal>
  );
}
