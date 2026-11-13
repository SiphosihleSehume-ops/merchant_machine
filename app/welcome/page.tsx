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
  const { login, verifyOtp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const trimmedEmail = email.trim().toLowerCase();
    try {
      if (mode === "signup") {
        const r = await api<{ message: string; emailDelivered?: boolean }>("/auth/register", {
          body: { email: trimmedEmail, password },
          auth: false,
        });
        setOtp("");
        setSentTo(trimmedEmail);
        // Development fallback: email failed, code is in the backend terminal
        if (r.emailDelivered === false) setNotice(r.message);
      } else {
        const session = await login(trimmedEmail, password);
        router.replace(homeFor(session));
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        setOtp("");
        setSentTo(trimmedEmail);
        setNotice("Your email isn't verified yet. Enter the 6-digit code sent to your email.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo || otp.length !== 6) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const session = await verifyOtp(sentTo, otp);
      router.replace(homeFor(session));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired verification code");
    } finally {
      setBusy(false);
    }
  }

  async function resend(to: string) {
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ message: string; emailDelivered?: boolean }>("/auth/resend-verification", {
        body: { email: to },
        auth: false,
      });
      setNotice(r.emailDelivered === false ? r.message : "A new 6-digit verification code has been sent to your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code");
    }
  }

  if (sentTo) {
    return (
      <main className="auth">
        <div className="auth-brand">
          <div className="receipt-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <MailCheck size={34} />
          </div>
          <h1>Enter verification code</h1>
          <p>
            We sent a 6-digit OTP to <strong style={{ color: "var(--text)" }}>{sentTo}</strong>. Enter it below to
            verify your account.
          </p>
        </div>

        <form className="auth-card" onSubmit={submitOtp} noValidate>
          <div className="form-field">
            <label htmlFor="otp">6-digit OTP code</label>
            <input
              id="otp"
              className="text-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              style={{
                textAlign: "center",
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "0.35em",
              }}
            />
          </div>

          {error && <div className="alert bad" role="alert">{error}</div>}
          {notice && <div className="alert ok">{notice}</div>}

          <button className="btn primary" type="submit" disabled={busy || otp.length !== 6}>
            {busy ? "Verifying…" : "Verify & continue"}
          </button>
          <button type="button" className="btn ghost" onClick={() => resend(sentTo)} disabled={busy}>
            Resend code
          </button>
          <button
            type="button"
            className="link-btn"
            style={{ alignSelf: "center" }}
            onClick={() => {
              setSentTo(null);
              setOtp("");
              setError(null);
              setNotice(null);
              switchMode("signin");
            }}
          >
            Back to sign in
          </button>
        </form>
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

        {error && <div className="alert bad" role="alert">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}

        <button className="btn primary" type="submit" disabled={busy || !email || !password}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </main>
  );
}
