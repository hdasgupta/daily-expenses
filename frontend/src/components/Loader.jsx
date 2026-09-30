import React, { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";

export default function Loader() {
  const [active, setActive] = useState(0),
    [message, setMessage] = useState("Please wait…");
  useEffect(() => {
    const start = (e) => {
      setActive((v) => v + 1);
      setMessage(e.detail?.message || "Please wait…");
    };
    const end = () => setActive((v) => Math.max(0, v - 1));
    window.addEventListener("app:api:start", start);
    window.addEventListener("app:api:end", end);
    return () => {
      window.removeEventListener("app:api:start", start);
      window.removeEventListener("app:api:end", end);
    };
  }, []);
  if (!active) return null;
  return (
    <div className="loaderOverlay" role="status" aria-live="polite">
      <div className="loaderCard">
        <Hourglass className="hourglass" size={34} />
        <span>{message}</span>
      </div>
    </div>
  );
}
