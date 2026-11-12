"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, SESSION_KEY } from "./api";

export type Role = "MERCHANT" | "CUSTOMER";

export type SessionUser = {
  id: string;
  email: string;
  role: Role | null;
  hasMerchantProfile: boolean;
  hasCustomerProfile: boolean;
  merchant: { id: string; name: string; cryptoWallet: string | null; feePercentage: number } | null;
  customer: { id: string; walletAddress: string | null } | null;
};

export type Session = { token: string; user: SessionUser };

type AuthContextValue = {
  /** false until localStorage has been read on the client */
  ready: boolean;
  session: Session | null;
  login: (email: string, password: string) => Promise<Session>;
  selectRole: (input: { role: Role; businessName?: string; cryptoWallet?: string }) => Promise<Session>;
  refresh: () => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function tokenExpired(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  const save = useCallback((next: Session | null) => {
    setSession(next);
    try {
      if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable: session lives in memory only */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const parsed = raw ? (JSON.parse(raw) as Session) : null;
      setSession(parsed && !tokenExpired(parsed.token) ? parsed : null);
    } catch {
      setSession(null);
    }
    setReady(true);

    const onExpired = () => save(null);
    window.addEventListener("mm:session-expired", onExpired);
    return () => window.removeEventListener("mm:session-expired", onExpired);
  }, [save]);

  const login = useCallback(
    async (email: string, password: string) => {
      const next = await api<Session>("/auth/login", { body: { email, password }, auth: false });
      save(next);
      return next;
    },
    [save],
  );

  const selectRole = useCallback(
    async (input: { role: Role; businessName?: string; cryptoWallet?: string }) => {
      const next = await api<Session>("/auth/select-role", { body: input });
      save(next);
      return next;
    },
    [save],
  );

  const refresh = useCallback(async () => {
    if (!session) return;
    const user = await api<SessionUser>("/auth/me");
    save({ token: session.token, user });
  }, [session, save]);

  const logout = useCallback(() => save(null), [save]);

  const value = useMemo(
    () => ({ ready, session, login, selectRole, refresh, logout }),
    [ready, session, login, selectRole, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Where a signed-in user belongs. */
export function homeFor(session: Session | null) {
  if (!session) return "/welcome";
  if (!session.user.role) return "/choose-role";
  return session.user.role === "CUSTOMER" ? "/customer" : "/";
}
