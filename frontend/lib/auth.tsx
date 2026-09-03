"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { User } from "./types";
import { API_BASE, setCsrfToken, setAuthResyncHandler } from "./api";

type AuthCtx = {
  user: User | null;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  loaded: boolean;
};
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);

  const hydrate = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (data.authenticated) {
        setUser(data.user);
        setCsrfToken(data.csrf_token);
      } else {
        setUser(null);
        setCsrfToken(null);
      }
    } catch {
      setUser(null);
      setCsrfToken(null);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    hydrate();

    // Any 401/403 from ANY API call resyncs local state to the server's
    // real current session — covers both "suspended mid-session" (goes
    // to unauthenticated) and the stale-tab case (§ root cause: cookies
    // are shared across tabs, but this tab's React state isn't — logging
    // into a different account in another tab left THIS tab still
    // showing the old identity until something reconciled it; a plain
    // role-permission 403 never used to trigger that reconciliation).
    setAuthResyncHandler((me) => {
      if (me.authenticated) {
        setUser(me.user as User);
        setCsrfToken(me.csrf_token || null);
      } else {
        setUser(null);
        setCsrfToken(null);
      }
    });

    // Defense in depth: catch the mismatch on tab focus too, before any
    // request even has a chance to 403 — switching back to a tab
    // re-checks who's really logged in right now.
    const onFocus = () => hydrate();
    window.addEventListener("focus", onFocus);

    return () => {
      setAuthResyncHandler(null);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.detail || "Could not log in — check your email and password." };
      }
      const data = await res.json();
      setUser(data.user);
      setCsrfToken(data.csrf_token);
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not reach the server — check your connection and try again." };
    }
  };

  const logout = () => {
    fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    setUser(null);
    setCsrfToken(null);
  };

  return <Ctx.Provider value={{ user, login, logout, loaded }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
