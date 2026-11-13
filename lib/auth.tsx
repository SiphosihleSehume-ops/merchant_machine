"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, DEMO_ROLE_KEY, SESSION_KEY } from "./api";
import { AUTH_DISABLED } from "./config";

export type Role = "MERCHANT" | "CUSTOMER";

export type SessionUser = {
  id: string;
  email: string;
  role: Role | null;
  kycStatus?: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
  /** KYC verifier (backend ADMIN_EMAILS) */
  isAdmin?: boolean;
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
  verifyOtp: (email: string, otp: string) => Promise<Session>;
  selectRole: (input: { role: Role; businessName?: string; cryptoWallet?: string }) => Promise<Session>;
  refresh: () => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// ------------------------------------------------------------------
// TEMPORARY TEST MODE (NEXT_PUBLIC_AUTH_DISABLED=true): no sign-in. The session is the
// backend's demo user; only the active role is remembered (localStorage mm.demoRole).
// ------------------------------------------------------------------
const DEMO_NO_ROLE: Session = {
  token: "demo",
  user: {
    id: "demo",
    email: "demo@merchantmachine.test",
    role: null,
    hasMerchantProfile: true, // demo user already owns both profiles: skip setup forms
    hasCustomerProfile: true,
    merchant: null,
    customer: null,
  },
};

function readDemoRole(): Role | null {
  try {
    const r = localStorage.getItem(DEMO_ROLE_KEY);
    return r === "MERCHANT" || r === "CUSTOMER" ? r : null;
  } catch {
    return null;
  }
}

function writeDemoRole(role: Role | null) {
  try {
    if (role) localStorage.setItem(DEMO_ROLE_KEY, role);
    else localStorage.removeItem(DEMO_ROLE_KEY);
  } catch {
    /* ignore */
  }
}

async function loadDemoSession(role: Role | null): Promise<Session> {
  if (!role) return DEMO_NO_ROLE;
  const user = await api<SessionUser>("/auth/me");
  return { token: "demo", user: { ...user, role } };
}

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
    if (AUTH_DISABLED) {
      loadDemoSession(readDemoRole())
        .catch(() => DEMO_NO_ROLE)
        .then((s) => {
          setSession(s);
          setReady(true);
        });
      return;
    }
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

  const verifyOtp = useCallback(
    async (email: string, otp: string) => {
      const next = await api<Session>("/auth/verify-otp", { body: { email, otp }, auth: false });
      save(next);
      return next;
    },
    [save],
  );

  const selectRole = useCallback(
    async (input: { role: Role; businessName?: string; cryptoWallet?: string }) => {
      if (AUTH_DISABLED) {
        writeDemoRole(input.role);
        const demo = await loadDemoSession(input.role);
        setSession(demo);
        return demo;
      }
      const next = await api<Session>("/auth/select-role", { body: input });
      save(next);
      return next;
    },
    [save],
  );

  const refresh = useCallback(async () => {
    if (!session) return;
    if (AUTH_DISABLED) {
      setSession(await loadDemoSession(readDemoRole()));
      return;
    }
    const user = await api<SessionUser>("/auth/me");
    save({ token: session.token, user });
  }, [session, save]);

  // Test mode: "sign out" just returns to the role picker
  const logout = useCallback(() => {
    if (AUTH_DISABLED) {
      writeDemoRole(null);
      setSession(DEMO_NO_ROLE);
      return;
    }
    save(null);
  }, [save]);

  const value = useMemo(
    () => ({ ready, session, login, verifyOtp, selectRole, refresh, logout }),
    [ready, session, login, verifyOtp, selectRole, refresh, logout],
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
