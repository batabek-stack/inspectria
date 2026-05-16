import React from "react";
import { styles } from "../styles/appStyles";
import { User } from "../types";

type Props = {
  user: User;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
};

export default function DashboardShell({ user, onLogout, children }: Props) {
  return (
    <div className="app-page" style={styles.page}>
      <div style={styles.card}>
        <div className="app-header">
          <div className="app-brand">
            <img src="/inspectra-logo.png" alt="Inspectria" />
          </div>
          <div className="app-userbar">
            <div style={styles.small}>Logged in as {user.name} ({user.role})</div>
            <button style={styles.secondaryButton} onClick={onLogout}>Logout</button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
