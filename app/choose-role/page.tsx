"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Store, Wallet } from "lucide-react";
import Logo from "@/components/Logo";
import { homeFor, useAuth, type Role } from "@/lib/auth";
import { connectWallet, hasMetaMask } from "@/lib/wallet";
import { AUTH_DISABLED } from "@/lib/config";

export default function ChooseRole() {
  const router = useRouter();
  const { session, selectRole, logout } = useAuth();
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merchantSetup, setMerchantSetup] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [wallet, setWallet] = useState("");

  if (!session) return null;
  const user = session.user;

  async function choose(role: Role, extra?: { businessName: string; cryptoWallet: string }) {
    setBusy(role);
    setError(null);
    try {
      const next = await selectRole({ role, ...extra });
      router.replace(homeFor(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
      setBusy(null);
    }
  }

  function pickMerchant() {
    if (user.hasMerchantProfile) return choose("MERCHANT");
    setMerchantSetup(true); // first time: need business details
  }

  async function fillFromMetaMask() {
    setError(null);
    try {
      setWallet(await connectWallet());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect MetaMask");
    }
  }

  const walletValid = /^0x[a-fA-F0-9]{40}$/.test(wallet);

  return (
    <main className="auth">
      <div className="auth-brand">
        <Logo size={48} />
        <h1>{merchantSetup ? "Set up your shop" : "How will you use the app?"}</h1>
        <p>{merchantSetup ? "Customers will see this name when they scan your code." : "You can switch any time."}</p>
      </div>

      {!merchantSetup ? (
        <div className="stack" style={{ padding: 0 }}>
          <button className="role-card" onClick={pickMerchant} disabled={!!busy}>
            <span className="role-icon"><Store size={28} /></span>
            <span style={{ flex: 1 }}>
              <span className="role-title">I&apos;m a merchant</span>
              <span className="role-sub">
                {user.merchant ? user.merchant.name : "Accept payments, create invoices, manage your shop"}
              </span>
            </span>
            <ChevronRight size={20} color="var(--muted)" />
          </button>
          <button className="role-card" onClick={() => choose("CUSTOMER")} disabled={!!busy}>
            <span className="role-icon"><Wallet size={28} /></span>
            <span style={{ flex: 1 }}>
              <span className="role-title">I&apos;m a customer</span>
              <span className="role-sub">Connect MetaMask, scan to pay and request refunds</span>
            </span>
            <ChevronRight size={20} color="var(--muted)" />
          </button>
        </div>
      ) : (
        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault();
            choose("MERCHANT", { businessName: businessName.trim(), cryptoWallet: wallet.trim() });
          }}
        >
          <div className="form-field">
            <label htmlFor="biz">Business name</label>
            <input id="biz" className="text-input" required minLength={2} maxLength={80} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="wallet">Wallet to receive payments</label>
            <input
              id="wallet"
              className="text-input"
              placeholder="0x…"
              spellCheck={false}
              value={wallet}
              onChange={(e) => setWallet(e.target.value.trim())}
            />
            {hasMetaMask() && (
              <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }} onClick={fillFromMetaMask}>
                Use my MetaMask address
              </button>
            )}
          </div>
          <button className="btn primary" type="submit" disabled={busy !== null || businessName.trim().length < 2 || !walletValid}>
            {busy ? "Setting up…" : "Continue"}
          </button>
          <button type="button" className="btn ghost" onClick={() => setMerchantSetup(false)}>Back</button>
        </form>
      )}

      {error && <div className="alert bad" role="alert">{error}</div>}

      {AUTH_DISABLED ? (
        <div className="alert warn">
          <strong>Test mode:</strong> sign-in is turned off. You are using a shared demo account.
        </div>
      ) : (
        <div className="signed-in">
          <span>Signed in as {user.email}</span>
          <button className="link-btn" onClick={logout}>Sign out</button>
        </div>
      )}
    </main>
  );
}
