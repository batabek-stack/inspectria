import React, { useState } from "react";
import { styles } from "../styles/appStyles";
import { register as registerUser } from "../services/authService";

type Props = {
  onLogin: (
    username: string,
    password: string,
    organizationName: string
  ) => Promise<void>;
};

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    try {
      if (mode === "login") {
        await onLogin(username, password, organizationName);
        return;
      }

      await registerUser(username, password, fullName, organizationName);
      setMessage("Your organization request was sent. Please wait for platform approval.");
      setUsername("");
      setPassword("");
      setFullName("");
      setOrganizationName("");
      setMode("login");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "login"
            ? "Login failed"
            : "Registration failed"
      );
    }
  };

  return (
    <div className="login-page" style={styles.page}>
      <div className="login-card" style={{ ...styles.card, maxWidth: 440 }}>
        <div className="login-brand">
          <img src="/inspectra-logo.png" alt="Inspectria" />
        </div>
        <h1 style={{ ...styles.title, textAlign: "center", marginBottom: 18 }}>Login</h1>

        {error ? <div style={styles.error}>{error}</div> : null}
        {message ? (
          <div style={{ ...styles.section, marginTop: 0, marginBottom: 12, background: "#e6f7f5" }}>
            {message}
          </div>
        ) : null}

        <form onSubmit={submit}>
          {mode === "register" ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <label>Organization Name</label>
                <input
                  style={styles.input}
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label>Full Name</label>
                <input
                  style={styles.input}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            </>
          ) : null}

          {mode === "login" ? (
            <div style={{ marginBottom: 12 }}>
              <label>Organization Name</label>
              <input
                style={styles.input}
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="Enter Organization"
              />
            </div>
          ) : null}

          <div style={{ marginBottom: 12 }}>
            <label>Username</label>
            <input
              style={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Password</label>
            <input
              type="password"
              style={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" style={styles.button}>
            {mode === "login" ? "Login" : "Send Approval Request"}
          </button>
        </form>

        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => {
              setMode((prev) => (prev === "login" ? "register" : "login"));
              setError("");
              setMessage("");
            }}
          >
            {mode === "login" ? "Create New User Request" : "Back To Login"}
          </button>
          {mode === "login" ? (
            <div style={{ ...styles.small, marginTop: 10 }}>
              Forgot your password? Contact your organization admin to generate a reset link.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
