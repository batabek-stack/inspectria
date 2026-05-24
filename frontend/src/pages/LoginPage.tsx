import React, { useState } from "react";
import { styles } from "../styles/appStyles";
import { register as registerUser } from "../services/authService";
import PasswordInput from "../components/PasswordInput";

type Props = {
  onLogin: (
    username: string,
    password: string,
    organizationName: string
  ) => Promise<void>;
  initialMode?: "login" | "register";
};

export default function LoginPage({ onLogin, initialMode = "login" }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"login" | "register">(initialMode);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    try {
      if (mode === "login") {
        await onLogin(username, password, organizationName);
        return;
      }

      const cleanEmail = email.trim();
      if (!organizationName.trim() || !fullName.trim() || !cleanEmail || !username.trim() || !password.trim()) {
        setError("Organization name, full name, email, username and password are required.");
        return;
      }

      if (!cleanEmail.includes("@")) {
        setError("Please enter a valid email address.");
        return;
      }

      const result = await registerUser(username, password, fullName, email, organizationName);
      setMessage(result.message);
      setUsername("");
      setPassword("");
      setEmail("");
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
        <h1 style={{ ...styles.title, textAlign: "center", marginBottom: 18 }}>
          {mode === "login" ? "Login" : "Create User Request"}
        </h1>

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
                  required
                  onChange={(e) => setOrganizationName(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label>Full Name</label>
                <input
                  style={styles.input}
                  value={fullName}
                  required
                  onChange={(e) => setFullName(e.target.value)}
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
              required
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Password</label>
            <PasswordInput
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
            <button
              type="button"
              style={{ ...styles.secondaryButton, marginTop: 10, width: "100%" }}
              onClick={() => {
                window.location.hash = "reset-password";
              }}
            >
              Forgot Password?
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
