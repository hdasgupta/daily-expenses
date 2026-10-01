import React, { useEffect, useState } from "react";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";

const icons = {
  information: Info,
  warning: TriangleAlert,
  success: CheckCircle2,
  error: XCircle,
};
export default function Toast() {
  const [messages, setMessages] = useState([]);
  useEffect(() => {
    const onToast = (event) => {
      const id = crypto.randomUUID();
      const type = ["information", "warning", "success", "error"].includes(event.detail?.type)
        ? event.detail.type
        : "information";
      const item = { id, type, message: event.detail?.message || "" };
      setMessages((current) => [...current, item].slice(-4));
      window.setTimeout(
        () => setMessages((current) => current.filter((row) => row.id !== id)),
        10000,
      );
    };
    window.addEventListener("app:toast", onToast);
    return () => window.removeEventListener("app:toast", onToast);
  }, []);
  return (
    <div className="toast-stack">
      {messages.map((item) => {
        const Icon = icons[item.type];
        return (
          <div className={`toast toast-${item.type}`} key={item.id}>
            <Icon size={18} />
            <div className="toast-body">
              <span>{item.message}</span>
              <div className="toast-progress" />
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => setMessages((current) => current.filter((row) => row.id !== item.id))}
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
