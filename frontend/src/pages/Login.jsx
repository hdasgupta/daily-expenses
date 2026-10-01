import React, { useState } from "react";
import { ArrowLeft, KeyRound, LogIn, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import PasswordField from "../components/PasswordField";

export default function Login({ onLogin, initialPath }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submitLogin = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        loadingMessage: "Signing you in…",
      });
      localStorage.setItem("token", result.token);
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    }
  };

  const requestOtp = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const result = await api("/auth/request-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
        loadingMessage: "Sending reset OTP…",
      });
      setResetRequested(true);
      setMessage(
        result.otpPreview
          ? `Development OTP: ${result.otpPreview}`
          : "An OTP was sent to the account email. It expires shortly.",
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const reset = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email, otp, password, confirmPassword }),
        loadingMessage: "Resetting password…",
      });
      setMode("login");
      setResetRequested(false);
      setPassword("");
      setConfirmPassword("");
      setOtp("");
      setMessage("Password reset successfully. You can now log in.");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-logo">RC</div>
        <h1>Rehabilitation Center</h1>
        <p className="muted">Expense Tracker</p>
        {mode === "login" ? (
          <form className="form-stack" onSubmit={submitLogin}>
            <label>
              Email / login ID
              <input
                autoFocus
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              confirm={false}
            />
            {initialPath && initialPath !== "/" ? (
              <div className="notice">
                You will return to the requested module after successful login, when your role has
                permission for it.
              </div>
            ) : null}
            <div className="form-actions">
              <button className="primary full-width" type="submit">
                <LogIn size={18} /> Login
              </button>
              <button
                className="secondary"
                type="reset"
                onClick={() => {
                  setEmail("");
                  setPassword("");
                }}
              >
                <RotateCcw size={15} /> Reset
              </button>
            </div>
            <button
              className="link-button"
              type="button"
              onClick={() => {
                setMode("reset");
                setMessage("");
                setError("");
              }}
            >
              Forgot / reset password
            </button>
          </form>
        ) : (
          <>
            {!resetRequested ? (
              <form className="form-stack" onSubmit={requestOtp}>
                <label>
                  Email
                  <input
                    autoFocus
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <div className="form-actions">
                  <button className="primary full-width" type="submit">
                    <KeyRound size={18} /> Send OTP
                  </button>
                  <button
                    className="secondary"
                    type="reset"
                    onClick={() => {
                      setEmail("");
                      setError("");
                      setMessage("");
                    }}
                  >
                    <RotateCcw size={15} /> Reset
                  </button>
                </div>
              </form>
            ) : (
              <form className="form-stack" onSubmit={reset}>
                <label>
                  Email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label>
                  OTP
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                </label>
                <PasswordField
                  label="New password"
                  value={password}
                  onChange={setPassword}
                  confirm={true}
                  confirmValue={confirmPassword}
                  onConfirmChange={setConfirmPassword}
                />
                <div className="form-actions">
                  <button className="primary full-width" type="submit">
                    Reset password
                  </button>
                  <button
                    className="secondary"
                    type="reset"
                    onClick={() => {
                      setOtp("");
                      setPassword("");
                      setConfirmPassword("");
                      setError("");
                      setMessage("");
                    }}
                  >
                    <RotateCcw size={15} /> Reset
                  </button>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setResetRequested(false)}
                >
                  Request new OTP
                </button>
              </form>
            )}
            <button
              className="link-button"
              type="button"
              onClick={() => {
                setMode("login");
                setResetRequested(false);
                setError("");
              }}
            >
              <ArrowLeft size={16} /> Back to login
            </button>
          </>
        )}
        {message ? <div className="notice success-notice">{message}</div> : null}
        {error ? <div className="notice error-notice">{error}</div> : null}
      </div>
    </div>
  );
}
