import React, { useMemo, useState } from "react";
import {
  completePasswordReset,
  requestPasswordResetCode,
  verifyPasswordResetCode,
} from "../services/authService";
import { styles } from "../styles/appStyles";
import PasswordInput from "../components/PasswordInput";

type ResetStep = "request" | "code" | "password";

export default function ResetPasswordPage() {
  const initialToken = useMemo(() => {
    const query = window.location.hash.split("?")[1] || "";
    return new URLSearchParams(query).get("token") || "";
  }, []);

  const [step, setStep] = useState<ResetStep>(initialToken ? "password" : "request");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const cleanUsername = username.trim();
    const cleanEmail = email.trim();

    if (!cleanUsername || !cleanEmail) {
      setError("Username and email are required.");
      return;
    }

    if (!cleanEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    try {
      setSaving(true);
      const result = await requestPasswordResetCode(cleanUsername, cleanEmail);
      setUsername(cleanUsername);
      setEmail(cleanEmail);
      setMessage(result.message);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset code could not be sent.");
    } finally {
      setSaving(false);
    }
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setError("Please enter the 6-digit reset code.");
      return;
    }

    try {
      setSaving(true);
      const result = await verifyPasswordResetCode(username, email, cleanCode);
      setResetToken(result.token);
      setCode("");
      setMessage("Code verified. Please enter your new password.");
      setStep("password");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset code could not be verified.");
    } finally {
      setSaving(false);
    }
  };

  const submitNewPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!resetToken) {
      setError("Reset session is missing or expired.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Password confirmation does not match.");
      return;
    }

    try {
      setSaving(true);
      await completePasswordReset(resetToken, password);
      setPassword("");
      setConfirmPassword("");
      setMessage("Password reset successfully. Returning to login...");
      window.setTimeout(() => {
        window.location.hash = "login";
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password could not be reset.");
    } finally {
      setSaving(false);
    }
  };

  const goLogin = () => {
    window.location.hash = "login";
  };

  return (
    <div className="login-page" style={styles.page}>
      <div className="login-card" style={{ ...styles.card, maxWidth: 440 }}>
        <div className="login-brand">
          <img src="/inspectra-logo.png" alt="Inspectria" />
        </div>
        <h1 style={{ ...styles.title, textAlign: "center", marginBottom: 18 }}>
          Reset Password
        </h1>

        {error ? <div style={styles.error}>{error}</div> : null}
        {message ? (
          <div style={{ ...styles.section, marginTop: 0, marginBottom: 12, background: "#e6f7f5" }}>
            {message}
          </div>
        ) : null}

        {step === "request" ? (
          <form onSubmit={requestCode}>
            <div style={{ marginBottom: 12 }}>
              <label>Username</label>
              <input
                style={styles.input}
                value={username}
                required
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>Email</label>
              <input
                style={styles.input}
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <button type="submit" style={styles.button} disabled={saving}>
              {saving ? "Sending..." : "Send Reset Code"}
            </button>
          </form>
        ) : null}

        {step === "code" ? (
          <form onSubmit={verifyCode}>
            <div style={{ marginBottom: 12 }}>
              <label>6-Digit Code</label>
              <input
                style={{ ...styles.input, letterSpacing: 4, textAlign: "center" }}
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                required
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>

            <button type="submit" style={styles.button} disabled={saving}>
              {saving ? "Verifying..." : "Verify Code"}
            </button>

            <button
              type="button"
              style={{ ...styles.secondaryButton, marginTop: 10, width: "100%" }}
              disabled={saving}
              onClick={() => {
                setStep("request");
                setMessage("");
                setError("");
              }}
            >
              Change Username or Email
            </button>
          </form>
        ) : null}

        {step === "password" ? (
          <form onSubmit={submitNewPassword}>
            <div style={{ marginBottom: 12 }}>
              <label>New Password</label>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>Confirm Password</label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <button type="submit" style={styles.button} disabled={saving}>
              {saving ? "Saving..." : "Set New Password"}
            </button>
          </form>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <button type="button" style={styles.secondaryButton} onClick={goLogin}>
            Back To Login
          </button>
        </div>
      </div>
    </div>
  );
}
