import React, { useEffect, useState } from "react";
import LoginPage from "./pages/LoginPage";
import { getStoredSession, login as loginRequest, logout as logoutRequest, me } from "./services/authService";
import { Session } from "./types";
import AdminPage from "./pages/AdminPage";
import UserPage from "./pages/UserPage";
import LandingPage from "./pages/LandingPage";
import LegalPage, { getLegalPageFromHash, isLegalPageHash } from "./pages/LegalPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";

export default function App() {
  const [session, setSession] = useState<Session | null>(getStoredSession());
  const [loading, setLoading] = useState(true);
  const [routeHash, setRouteHash] = useState(() => window.location.hash || "#top");

  useEffect(() => {
    const restore = async () => {
      const stored = getStoredSession();
      if (!stored) return setLoading(false);
      try {
        const res = await me();
        setSession({ ...stored, user: res.user });
      } catch {
        localStorage.removeItem("mod_token");
        localStorage.removeItem("mod_session");
        setSession(null);
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  useEffect(() => {
    const syncRoute = () => setRouteHash(window.location.hash || "#top");
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  const handleLogin = async (
    username: string,
    password: string,
    organizationName: string
  ) => {
    const data = await loginRequest(username, password, organizationName);
    setSession(data);
  };

  const handleLogout = async () => {
    await logoutRequest();
    setSession(null);
  };

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!session && isLegalPageHash(routeHash)) {
    return <LegalPage page={getLegalPageFromHash(routeHash)} />;
  }
  if (!session && routeHash.startsWith("#reset-password")) return <ResetPasswordPage />;
  if (!session && routeHash === "#login") return <LoginPage onLogin={handleLogin} />;
  if (!session && routeHash === "#register") {
    return <LoginPage onLogin={handleLogin} initialMode="register" />;
  }
  if (!session) {
    return (
      <LandingPage
        onSignIn={() => {
          window.location.hash = "login";
          setRouteHash("#login");
        }}
        onRegister={() => {
          window.location.hash = "register";
          setRouteHash("#register");
        }}
      />
    );
  }

  return session.user.role === "admin" || session.user.role === "platform_admin"
    ? <AdminPage user={session.user} onLogout={handleLogout} />
    : <UserPage user={session.user} onLogout={handleLogout} />;
}
