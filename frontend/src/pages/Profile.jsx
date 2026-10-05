import React, { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, MessageCircle, Save, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import PasswordField from "../components/PasswordField";

function normalizeDisplay(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.startsWith("91") ? `+${digits}` : `+${digits}`;
}

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [fullName, setFullName] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [saving, setSaving] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const load = async () => {
    const data = await api("/profile", { loadingMessage: "Loading profile…" });
    setProfile(data);
    setFullName(data.full_name || "");
    setWhatsappNumber(data.whatsapp_number ? normalizeDisplay(data.whatsapp_number) : "");
    setOtp("");
    setOtpSent(Boolean(data.whatsapp_pending_number));
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const saveName = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await api("/profile", {
        method: "PUT",
        body: JSON.stringify({ fullName }),
        loadingMessage: "Saving profile…",
      });
      setProfile(data);
      setFullName(data.full_name || "");
    } finally {
      setSaving(false);
    }
  };

  const requestOtp = async () => {
    const data = await api("/profile/whatsapp/request-otp", {
      method: "POST",
      body: JSON.stringify({ whatsappNumber }),
      loadingMessage: "Sending WhatsApp OTP…",
    });
    setOtpSent(true);
    setOtp("");
    if (data?.whatsappNumber) setWhatsappNumber(normalizeDisplay(data.whatsappNumber));
  };

  const verifyOtp = async () => {
    const data = await api("/profile/whatsapp/verify", {
      method: "POST",
      body: JSON.stringify({ whatsappNumber, otp }),
      loadingMessage: "Verifying WhatsApp number…",
    });
    setOtpSent(false);
    setOtp("");
    setProfile((current) => ({
      ...(current || {}),
      whatsapp_number: data.whatsappNumber,
      whatsapp_verified_at: data.whatsappVerifiedAt,
      whatsapp_pending_number: null,
    }));
    setWhatsappNumber(normalizeDisplay(data.whatsappNumber));
  };

  const changePassword = async (event) => {
    event.preventDefault();
    await api("/profile/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword,
        password,
        confirmPassword,
      }),
      loadingMessage: "Changing password…",
    });
    setCurrentPassword("");
    setPassword("");
    setConfirmPassword("");
  };

  if (!profile) {
    return <section><div className="card">Loading profile…</div></section>;
  }

  const verified = Boolean(profile.whatsapp_number && profile.whatsapp_verified_at);
  const currentVerifiedNumber = profile.whatsapp_number
    ? normalizeDisplay(profile.whatsapp_number)
    : "";
  const numberChanged = whatsappNumber.trim() !== currentVerifiedNumber.trim();

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>My Profile</h1>
          <p>Update your name, WhatsApp number, and password.</p>
        </div>
      </div>

      <form className="card form-stack" onSubmit={saveName}>
        <div className="section-label">Personal information</div>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Email / login ID
          <input value={profile.email || ""} disabled />
        </label>
        <div className="form-actions">
          <button className="primary" type="submit" disabled={saving}>
            <Save size={17} /> Save full name
          </button>
        </div>
      </form>

      <div className="card form-stack">
        <div className="section-label">
          <MessageCircle size={17} /> WhatsApp number
        </div>
        <p className="muted">
          {verified ? (
            <span className="profile-verified">
              <CheckCircle2 size={16} /> Verified
            </span>
          ) : (
            "Optional. A verification OTP will be sent to the number."
          )}
        </p>
        <label>
          WhatsApp number
          <input
            inputMode="tel"
            placeholder="+91 9876543210"
            value={whatsappNumber}
            onChange={(e) => {
              setWhatsappNumber(e.target.value);
              setOtpSent(false);
            }}
          />
        </label>

        {(!verified || numberChanged || otpSent) ? (
          <>
            <div className="form-actions">
              <button className="secondary" type="button" onClick={requestOtp}>
                <MessageCircle size={17} /> Send OTP
              </button>
            </div>
            {otpSent ? (
              <div className="otp-row">
                <label>
                  WhatsApp OTP
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="6-digit OTP"
                  />
                </label>
                <button className="primary" type="button" onClick={verifyOtp} disabled={otp.length !== 6}>
                  <ShieldCheck size={17} /> Verify
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {verified && !numberChanged && !otpSent ? (
          <div className="form-actions">
            <button
              className="secondary"
              type="button"
              onClick={async () => {
                const data = await api("/profile", {
                  method: "PUT",
                  body: JSON.stringify({ fullName, whatsappNumber: "" }),
                  loadingMessage: "Removing WhatsApp number…",
                });
                setProfile(data);
                setWhatsappNumber("");
                setOtpSent(false);
              }}
            >
              Remove WhatsApp number
            </button>
          </div>
        ) : null}
      </div>

      <form className="card form-stack" onSubmit={changePassword}>
        <div className="section-label">
          <KeyRound size={17} /> Change password
        </div>
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <PasswordField
          value={password}
          onChange={setPassword}
          confirmValue={confirmPassword}
          onConfirmChange={setConfirmPassword}
          confirm
          required
          confirmRequired
          label="New password"
        />
        <div className="form-actions">
          <button className="primary" type="submit">
            <KeyRound size={17} /> Change password
          </button>
        </div>
      </form>
    </section>
  );
}
