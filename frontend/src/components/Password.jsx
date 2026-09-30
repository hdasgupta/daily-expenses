import React, { useState } from "react";
import { Eye, EyeOff, Check, X } from "lucide-react";
export default function Password({
  value,
  onChange,
  label = "Password",
  confirm = false,
  confirmValue,
  onConfirmChange,
}) {
  const [show, setShow] = useState(false);
  const rules = [
    ["capital", /[A-Z]/, "One capital letter"],
    ["small", /[a-z]/, "One small letter"],
    ["special", /[^A-Za-z0-9\s]/, "One special character"],
    ["digit", /[0-9]/, "One digit"],
    ["space", /^[^\s]*$/, "No space"],
    ["length", /^.{8,}$/, "At least 8 characters"],
  ];
  return (
    <div className="passwordWrap">
      <label>{label}</label>
      <div className="passbox">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" onClick={() => setShow(!show)}>
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <div className="rules">
        {rules.map(([k, re, t]) => (
          <div className={re.test(value) ? "ok" : "bad"} key={k}>
            {re.test(value) ? <Check size={15} /> : <X size={15} />} {t}
          </div>
        ))}
      </div>
      {confirm && (
        <>
          <label>Confirm Password</label>
          <div
            className={
              "match " + (value && value === confirmValue ? "ok" : "bad")
            }
          >
            {value && value === confirmValue ? (
              <Check size={15} />
            ) : (
              <X size={15} />
            )}{" "}
            {value && value === confirmValue
              ? "Passwords match"
              : "Passwords must match"}
          </div>
        </>
      )}
    </div>
  );
}
