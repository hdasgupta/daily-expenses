import React, { useState } from "react";
import Password from "../components/Password";
import { api } from "../lib/api";
export default function Login({ onLogin }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [reset, setReset] = useState(false),
    [msg, setMsg] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try {
      if (reset) {
        await api("/auth/request-reset", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        setMsg(
          "If the email exists, an OTP has been issued. Check backend mail/log configuration.",
        );
        return;
      }
      const x = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem("token", x.token);
      onLogin(x.user);
    } catch (e) {
      setMsg(e.message);
    }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="logo big">RC</div>
        <h1>Rehabilitation Center</h1>
        <p>Expense Tracker</p>
        <label>Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {!reset && <Password value={password} onChange={setPassword} />}
        <button className="primary">{reset ? "Send OTP" : "Login"}</button>
        <button type="button" className="link" onClick={() => setReset(!reset)}>
          {reset ? "Back to login" : "Reset password"}
        </button>
        {msg && <div className="notice">{msg}</div>}
      </form>
    </div>
  );
}
