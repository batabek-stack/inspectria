import React, { useCallback, useEffect, useRef, useState } from "react";
import LoginPage from "./pages/LoginPage";
import { getStoredSession, login as loginRequest, logout as logoutRequest, me } from "./services/authService";
import { Session } from "./types";
import AdminPage from "./pages/AdminPage";
import UserPage from "./pages/UserPage";
import LandingPage from "./pages/LandingPage";
import LegalPage, { getLegalPageFromHash, isLegalPageHash } from "./pages/LegalPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SupportPage from "./pages/SupportPage";
import { importSharedChecklist } from "./services/checklistService";

const AUTO_LOGOFF_MS = 10 * 60 * 1000;
const AUTO_LOGOFF_SAVE_EVENT = "inspectria:auto-logoff-save";
const AUTO_LOGOFF_EVENTS = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "pointerdown",
] as const;

function isLoginRoute(routeHash: string) {
  return routeHash.startsWith("#login") || window.location.pathname === "/login";
}

function requestedAdminSection() {
  const hashQuery = window.location.hash.split("?")[1] || "";
  const hashParams = new URLSearchParams(hashQuery);
  const searchParams = new URLSearchParams(window.location.search);
  const requested = hashParams.get("admin") || searchParams.get("admin");

  if (requested === "users" || requested === "templates") return requested;
  return undefined;
}

function getTemplateShareToken() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashQuery = window.location.hash.split("?")[1] || "";
  const hashParams = new URLSearchParams(hashQuery);
  return searchParams.get("templateShare") || hashParams.get("templateShare") || "";
}

function clearTemplateShareTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("templateShare");

  if (url.hash.includes("?")) {
    const [hashPath, hashQuery] = url.hash.split("?");
    const hashParams = new URLSearchParams(hashQuery || "");
    hashParams.delete("templateShare");
    const nextHashQuery = hashParams.toString();
    url.hash = nextHashQuery ? `${hashPath}?${nextHashQuery}` : hashPath;
  }

  window.history.replaceState({}, "", url.toString());
}

export default function App() {
  const [session, setSession] = useState<Session | null>(getStoredSession());
  const [loading, setLoading] = useState(true);
  const [routeHash, setRouteHash] = useState(() => window.location.hash || "#top");
  const [templateImporting, setTemplateImporting] = useState(false);
  const [templateImportNonce, setTemplateImportNonce] = useState(0);
  const autoLogoffTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (!session || templateImporting) return;

    const token = getTemplateShareToken();
    if (!token) return;

    const importTemplate = async () => {
      try {
        setTemplateImporting(true);
        const result = await importSharedChecklist(token);
        clearTemplateShareTokenFromUrl();
        window.location.hash = "login?admin=templates";
        setRouteHash("#login?admin=templates");
        setTemplateImportNonce((value) => value + 1);
        window.alert(
          result.reused
            ? `${result.title} template already exists in Templates.`
            : `${result.title} template was imported into Templates.`
        );
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Shared template could not be imported.");
        clearTemplateShareTokenFromUrl();
      } finally {
        setTemplateImporting(false);
      }
    };

    importTemplate();
  }, [session, templateImporting]);

  const handleLogin = async (
    username: string,
    password: string,
    organizationName: string
  ) => {
    const data = await loginRequest(username, password, organizationName);
    setSession(data);
  };

  const handleLogout = useCallback(async () => {
    await logoutRequest();
    setSession(null);
  }, []);

  useEffect(() => {
    if (!session) {
      if (autoLogoffTimerRef.current) {
        window.clearTimeout(autoLogoffTimerRef.current);
        autoLogoffTimerRef.current = null;
      }
      return;
    }

    let lastActivityAt = Date.now();
    let isLoggingOff = false;

    const clearAutoLogoffTimer = () => {
      if (autoLogoffTimerRef.current) {
        window.clearTimeout(autoLogoffTimerRef.current);
        autoLogoffTimerRef.current = null;
      }
    };

    const runAutoLogoff = async () => {
      if (isLoggingOff) return;
      isLoggingOff = true;
      clearAutoLogoffTimer();
      window.dispatchEvent(new Event(AUTO_LOGOFF_SAVE_EVENT));
      await handleLogout();
      window.location.hash = "login";
      setRouteHash("#login");
      window.alert("You have been logged out after 10 minutes of inactivity.");
    };

    const scheduleAutoLogoff = () => {
      clearAutoLogoffTimer();
      autoLogoffTimerRef.current = window.setTimeout(() => {
        const idleFor = Date.now() - lastActivityAt;
        if (idleFor >= AUTO_LOGOFF_MS) {
          runAutoLogoff();
          return;
        }
        scheduleAutoLogoff();
      }, AUTO_LOGOFF_MS);
    };

    const registerActivity = () => {
      lastActivityAt = Date.now();
      scheduleAutoLogoff();
    };

    const checkVisibilityIdleTime = () => {
      if (document.visibilityState === "visible" && Date.now() - lastActivityAt >= AUTO_LOGOFF_MS) {
        runAutoLogoff();
      }
    };

    AUTO_LOGOFF_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, registerActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", checkVisibilityIdleTime);
    scheduleAutoLogoff();

    return () => {
      clearAutoLogoffTimer();
      AUTO_LOGOFF_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, registerActivity);
      });
      document.removeEventListener("visibilitychange", checkVisibilityIdleTime);
    };
  }, [handleLogout, session]);

  if (loading || templateImporting) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!session && isLegalPageHash(routeHash)) {
    return <LegalPage page={getLegalPageFromHash(routeHash)} />;
  }
  if (!session && routeHash.startsWith("#reset-password")) return <ResetPasswordPage />;
  if (!session && isLoginRoute(routeHash)) return <LoginPage onLogin={handleLogin} />;
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

  if (routeHash === "#support") {
    return <SupportPage user={session.user} onLogout={handleLogout} />;
  }

  return session.user.role === "admin" || session.user.role === "platform_admin"
    ? <AdminPage key={templateImportNonce} user={session.user} onLogout={handleLogout} initialSection={requestedAdminSection()} />
    : <UserPage user={session.user} onLogout={handleLogout} />;
}
