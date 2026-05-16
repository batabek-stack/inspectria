import React, { useMemo, useState } from "react";
import { completePasswordReset } from "../services/authService";
import { styles } from "../styles/appStyles";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const token = useMemo(() => {
    const query = window.location.hash.split("?")[1] || "";
    return new URLSearchParams(query).get("token") || "";
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!token) {
      setError("Reset link is missing or invalid.");
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
      await completePasswordReset(token, password);
      setPassword("");
      setConfirmPassword("");
      setMessage("Password reset successfully. You can now log in with your new password.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password could not be reset.");
    } finally {
      setSaving(false);
    }
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

        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label>New Password</label>
            <input
              type="password"
              style={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Confirm Password</label>
            <input
              type="password"
              style={styles.input}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button type="submit" style={styles.button} disabled={saving}>
            {saving ? "Saving..." : "Set New Password"}
          </button>
        </form>

        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => {
              window.location.hash = "login";
            }}
          >
            Back To Login
          </button>
        </div>
      </div>
    </div>
  );
}
