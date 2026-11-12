"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import Logo from "@/components/Logo";
import { api, ApiError } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";

type Mode = "signin" | "signup";

export default function Welcome() {
  const router = useRouter();
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setUnverified(false);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    setNotice(null);
    try {
      if (mode === "signup") {
        await api("/auth/register", { body: { email, password }, auth: false });
        setSentTo(email);
      } else {
        const session = await login(email, password);
        router.replace(homeFor(session));
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") setUnverified(true);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function resend(to: string) {
    setNotice(null);
    try {
      await api("/auth/resend-verification", { body: { email: to }, auth: false });
      setNotice("If the account exists and isn't verified yet, a new link is on its way.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend");
    }
  }

  if (sentTo) {
    return (
      <main className="auth">
        <div className="auth-brand">
          <div className="receipt-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <MailCheck size={34} />
          </div>
          <h1>Check your inbox</h1>
          <p>
            We sent a verification link to <strong style={{ color: "var(--text)" }}>{sentTo}</strong>. Open it to
            activate your account, then sign in.
          </p>
        </div>
        {notice && <div className="alert ok">{notice}</div>}
        <div className="stack" style={{ padding: 0 }}>
          <button className="btn primary" onClick={() => { setSentTo(null); switchMode("signin"); }}>
            I&apos;ve verified, sign in
          </button>
          <button className="btn ghost" onClick={() => resend(sentTo)}>Resend link</button>
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-brand">
        <Logo size={56} />
        <h1>Merchant &amp; Payment Machine</h1>
        <p>Pay and get paid in seconds with digital rand and dollars.</p>
      </div>

      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="seg" role="group" aria-label="Account">
          <button type="button" aria-pressed={mode === "signin"} onClick={() => switchMode("signin")}>Sign in</button>
          <button type="button" aria-pressed={mode === "signup"} onClick={() => switchMode("signup")}>Create account</button>
        </div>

        <div className="form-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="text-input"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="text-input"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "signup" && <span className="muted" style={{ fontSize: 13 }}>At least 8 characters.</span>}
        </div>

        {error && (
          <div className="alert bad" role="alert">
            {error}
            {unverified && (
              <div style={{ marginTop: 6 }}>
                <button type="button" className="link-btn" onClick={() => resend(email)}>Resend verification link</button>
              </div>
            )}
          </div>
        )}
        {notice && <div className="alert ok">{notice}</div>}

        <button className="btn primary" type="submit" disabled={busy || !email || !password}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </main>
  );
}
