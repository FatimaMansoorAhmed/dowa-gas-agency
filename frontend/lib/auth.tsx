"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { User } from "./types";

type AuthCtx = { user: User | null; login: (u: User) => void; logout: () => void; loaded: boolean };
const Ctx = createContext<AuthCtx | null>(null);

const KEY = "dowa_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // ✅ Changed from localStorage to sessionStorage
    const raw = sessionStorage.getItem(KEY);
    if (raw) setUser(JSON.parse(raw));
    setLoaded(true);
  }, []);

  const login = (u: User) => {
    // ✅ Changed from localStorage to sessionStorage
    sessionStorage.setItem(KEY, JSON.stringify(u));
    setUser(u);
  };

  const logout = () => {
    // ✅ Changed from localStorage to sessionStorage
    sessionStorage.removeItem(KEY);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, login, logout, loaded }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}