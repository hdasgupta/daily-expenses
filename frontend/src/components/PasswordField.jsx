import React, { useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { passwordRules } from "../utils/password";

export default function PasswordField({
  value,
  onChange,
  confirmValue,
  onConfirmChange,
  required = true,
  confirm = false,
  confirmRequired = required,
  label = "Password",
}) {
  const [visible, setVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  return (
    <div className="password-field">
      <label>
        {label}
        <span className="password-box">
          <input
            type={visible ? "text" : "password"}
            required={required}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            className="icon-button"
            title={visible ? "Hide password" : "Show password"}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </label>
      <div className="password-rules" aria-live="polite">
        {passwordRules.map((rule) => {
          const valid = rule.test(value || "");
          return (
            <div key={rule.code} className={valid ? "rule-ok" : "rule-bad"}>
              {valid ? <Check size={14} /> : <X size={14} />}
              {rule.label}
            </div>
          );
        })}
        {confirm ? (
          <div
            className={
              String(value || "") === String(confirmValue || "") && Boolean(value)
                ? "rule-ok"
                : "rule-bad"
            }
          >
            {String(value || "") === String(confirmValue || "") && Boolean(value) ? (
              <Check size={14} />
            ) : (
              <X size={14} />
            )}
            Password and confirmed password must match
          </div>
        ) : null}
      </div>
      {confirm ? (
        <label>
          Confirm password
          <span className="password-box">
            <input
              type={confirmVisible ? "text" : "password"}
              required={confirmRequired}
              value={confirmValue || ""}
              onChange={(e) => onConfirmChange(e.target.value)}
            />
            <button
              type="button"
              className="icon-button"
              title={confirmVisible ? "Hide password" : "Show password"}
              onClick={() => setConfirmVisible((v) => !v)}
            >
              {confirmVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>
      ) : null}
    </div>
  );
}
