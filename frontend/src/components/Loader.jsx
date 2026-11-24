import React, { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";

function getWaitingStepStatement(primaryMessage, elapsedSeconds) {
  const lower = String(primaryMessage || "").toLowerCase();

  if (lower.includes("pdf") || lower.includes("export")) {
    if (elapsedSeconds < 2) return "Step 1/3: Gathering report data & filters…";
    if (elapsedSeconds < 5) return "Step 2/3: Rendering charts, tables & proof links into PDF…";
    return `Step 3/3: Finalizing PDF download (${elapsedSeconds}s)…`;
  }

  if (lower.includes("bulk") || lower.includes("upload") || lower.includes("proof")) {
    if (elapsedSeconds < 2) return "Step 1/3: Uploading file securely…";
    if (elapsedSeconds < 6) return "Step 2/3: Validating & storing records in database…";
    return `Step 3/3: Completing processing (${elapsedSeconds}s)…`;
  }

  if (lower.includes("signing in") || lower.includes("verifying")) {
    if (elapsedSeconds < 2) return "Step 1/3: Checking credentials…";
    if (elapsedSeconds < 5) return "Step 2/3: Waking server & loading permissions…";
    return `Step 3/3: Almost ready — finalizing your session (${elapsedSeconds}s)…`;
  }

  if (elapsedSeconds < 2) return "Step 1/3: Connecting to server…";
  if (elapsedSeconds < 5) return "Step 2/3: Querying database & preparing data…";
  if (elapsedSeconds < 10) return `Step 3/3: Server is waking up or processing large data (${elapsedSeconds}s)…`;
  return `Still working — waiting for server response (${elapsedSeconds}s elapsed)…`;
}

export default function Loader() {
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState("Connecting to server…");
  const [customStep, setCustomStep] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const onStart = (event) => {
      setActive((value) => {
        if (value === 0) setElapsedSeconds(0);
        return value + 1;
      });
      setMessage(event.detail?.message || "Connecting to server…");
      setCustomStep(event.detail?.step || "");
    };
    const onStep = (event) => {
      if (event.detail?.message) setMessage(event.detail.message);
      if (event.detail?.step !== undefined) setCustomStep(event.detail.step);
    };
    const onEnd = () => {
      setActive((value) => {
        const next = Math.max(0, value - 1);
        if (next === 0) {
          setCustomStep("");
          setElapsedSeconds(0);
        }
        return next;
      });
    };
    window.addEventListener("app:api:start", onStart);
    window.addEventListener("app:api:step", onStep);
    window.addEventListener("app:api:end", onEnd);
    return () => {
      window.removeEventListener("app:api:start", onStart);
      window.removeEventListener("app:api:step", onStep);
      window.removeEventListener("app:api:end", onEnd);
    };
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      setElapsedSeconds((sec) => sec + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const stepStatement = customStep || getWaitingStepStatement(message, elapsedSeconds);

  return (
    <div className="loader-overlay" role="status" aria-live="polite">
      <div className="loader-card">
        <Hourglass className="hourglass" size={28} />
        <div className="loader-copy">
          <div className="loader-title-row">
            <span>{message}</span>
            {active > 1 ? <small className="loader-count-pill">{active} tasks</small> : null}
          </div>
          <small className="loader-step-text">{stepStatement}</small>
        </div>
      </div>
    </div>
  );
}
