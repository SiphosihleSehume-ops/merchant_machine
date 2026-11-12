"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck, CircleX } from "lucide-react";
import Logo from "@/components/Logo";
import { api } from "@/lib/api";

function Verify() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"working" | "ok" | "error">(token ? "working" : "error");
  const [message, setMessage] = useState(token ? "" : "This verification link is missing its token.");
  const sent = useRef(false); // links are single-use: never submit twice (e.g. StrictMode)

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api<{ message: string }>("/auth/verify-email", { body: { token }, auth: false })
      .then((r) => {
        setState("ok");
        setMessage(r.message);
      })
      .catch((err) => {
        setState("error");
        setMessage(err instanceof Error ? err.message : "Verification failed");
      });
  }, [token]);

  return (
    <main className="auth">
      <div className="auth-brand">
        {state === "working" && <Logo size={56} />}
        {state === "ok" && <div className="receipt-icon"><CircleCheck size={38} /></div>}
        {state === "error" && (
          <div className="receipt-icon" style={{ background: "rgba(255,92,92,.12)", color: "var(--bad)" }}>
            <CircleX size={38} />
          </div>
        )}
        <h1>{state === "working" ? "Verifying your email…" : state === "ok" ? "Email verified" : "Link not valid"}</h1>
        {message && <p>{message}</p>}
      </div>
      {state !== "working" && (
        <Link href="/welcome" className="btn primary">
          {state === "ok" ? "Sign in" : "Back to sign in"}
        </Link>
      )}
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className="auth" />}>
      <Verify />
    </Suspense>
  );
}
