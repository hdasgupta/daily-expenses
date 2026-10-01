import React from "react";
import Modal from "./Modal";

export default function ConfirmDialog({
  open,
  title = "Confirm",
  message,
  onCancel,
  onConfirm,
  busy = false,
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Removing…" : "Confirm"}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
