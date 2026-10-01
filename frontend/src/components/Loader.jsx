import React, { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";

export default function Loader() {
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState("Please wait…");

  useEffect(() => {
    const onStart = (event) => {
      setActive((value) => value + 1);
      setMessage(event.detail?.message || "Please wait…");
    };
    const onEnd = () => setActive((value) => Math.max(0, value - 1));
    window.addEventListener("app:api:start", onStart);
    window.addEventListener("app:api:end", onEnd);
    return () => {
      window.removeEventListener("app:api:start", onStart);
      window.removeEventListener("app:api:end", onEnd);
    };
  }, []);

  if (!active) return null;
  return (
    <div className="loader-overlay" role="status" aria-live="polite">
      <div className="loader-card">
        <Hourglass className="hourglass" size={28} />
        <span>{message}</span>
      </div>
    </div>
  );
}
