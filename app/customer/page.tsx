"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Droplets, RefreshCw, RotateCcw, ScanLine, Wallet } from "lucide-react";
import CustomerHeader from "@/components/CustomerHeader";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/useWallet";
import { claimFaucet, hasMetaMask, shortAddress } from "@/lib/wallet";
import { CHAIN_ID, TOKENS, type TokenSymbol } from "@/lib/config";
import type { CustomerPayment } from "@/app/customer/refund/page";

const fmt = (amount: string, symbol: string) =>
  Number(amount).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: symbol === "ETH" ? 4 : 2,
  });

const rand = (v: string | number) =>
  "R" + Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const when = (d: string) =>
  new Date(d).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function CustomerHome() {
  const w = useWallet();
  const [faucetBusy, setFaucetBusy] = useState<TokenSymbol | null>(null);
  const [recent, setRecent] = useState<CustomerPayment[]>([]);
  const metaMask = hasMetaMask();

  const loadRecent = useCallback(async () => {
    try {
      const q = w.address ? `?wallet=${encodeURIComponent(w.address)}` : "";
      const list = await api<CustomerPayment[]>(`/transactions${q}`);
      setRecent(list.slice(0, 5));
    } catch {
      /* ignore on dashboard */
    }
  }, [w.address]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  async function faucet(symbol: TokenSymbol) {
    if (!w.address) return;
    setFaucetBusy(symbol);
    w.setError(null);
    try {
      await claimFaucet(w.address, symbol);
      await w.reloadBalances();
    } catch (err: any) {
      const msg = String(err?.shortMessage || err?.message || "");
      w.setError(msg.includes("FaucetCooldown") ? `You already claimed ${symbol} today. Try again tomorrow.` : msg || "Faucet failed");
    } finally {
      setFaucetBusy(null);
    }
  }

  return (
    <>
      <CustomerHeader />
      <main>
        <section className="wallet-card">
          {!w.address ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="role-icon" style={{ width: 48, height: 48, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent)" }}>
                  <Wallet size={24} />
                </span>
                <div>
                  <strong style={{ display: "block" }}>Connect your wallet</strong>
                  <span className="muted" style={{ fontSize: 14 }}>Pay merchants straight from MetaMask.</span>
                </div>
              </div>
              {metaMask ? (
                <button className="btn primary" onClick={w.connect} disabled={w.busy}>
                  {w.busy ? "Check MetaMask…" : "Connect MetaMask"}
                </button>
              ) : (
                <a className="btn outline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                  Install MetaMask
                </a>
              )}
            </>
          ) : (
            <>
              <div className="addr">
                <span>{shortAddress(w.address)} · {CHAIN_ID === 31337 ? "Local chain" : "Sepolia"}</span>
                {w.linked ? (
                  <span className="pill ok"><BadgeCheck size={14} /> Verified</span>
                ) : (
                  <button className="link-btn" onClick={w.relink} disabled={w.busy}>Verify wallet</button>
                )}
              </div>
              <div className="balances">
                {(w.balances ?? TOKENS.map((t) => ({ symbol: t.symbol, label: t.label, amount: "", raw: 0n }))).map((b) => (
                  <div className="bal-row" key={b.symbol}>
                    <span>
                      <span className="sym">{b.symbol}</span>
                      <span className="lbl">{b.label}</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {b.symbol !== "ETH" && b.raw === 0n && w.balances && (
                        <button
                          className="link-btn"
                          title="Testnet faucet"
                          onClick={() => faucet(b.symbol as TokenSymbol)}
                          disabled={faucetBusy !== null}
                        >
                          <Droplets size={14} style={{ verticalAlign: "-2px" }} /> {faucetBusy === b.symbol ? "…" : "Get test"}
                        </button>
                      )}
                      <span className="amt">{b.amount === "" ? "–" : fmt(b.amount, b.symbol)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={w.reloadBalances}>
                <RefreshCw size={13} style={{ verticalAlign: "-2px" }} /> Refresh balances
              </button>
            </>
          )}
          {w.error && <div className="alert bad" role="alert">{w.error}</div>}
        </section>

        <div className="action-grid">
          <Link href="/customer/pay" className="action-tile primary" aria-disabled={!w.address}>
            <ScanLine size={36} strokeWidth={1.8} />
            Pay
          </Link>
          <Link href="/customer/refund" className="action-tile">
            <RotateCcw size={34} strokeWidth={1.8} color="var(--accent)" />
            Refund
          </Link>
        </div>

        {!w.address && (
          <p className="center-note" style={{ padding: "16px var(--gutter)" }}>
            Connect MetaMask first so you can pay merchants.
          </p>
        )}

        {recent.length > 0 && (
          <section className="stack" style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 15 }}>Recent payments</strong>
              <Link href="/customer/refund" className="link-btn" style={{ fontSize: 13 }}>
                View all &amp; refunds
              </Link>
            </div>
            {recent.map((p) => (
              <div className="pay-item" key={p.id}>
                <div className="top">
                  <div>
                    <div className="merchant">{p.merchantName}</div>
                    <div className="meta">
                      {when(p.createdAt)}
                      {p.items.length > 0 && ` · ${p.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="amt">{rand(p.amount)}</div>
                    <span className="badge" data-status={p.status}>{p.status}</span>
                  </div>
                </div>
                {p.reversal ? (
                  <div className="meta">
                    Refund:{" "}
                    <span className="badge" data-status={p.reversal.status}>
                      {p.reversal.status === "COMPLETED" ? "Refunded" : p.reversal.status}
                    </span>{" "}
                    {rand(p.reversal.amount)}
                  </div>
                ) : p.status === "SETTLED" ? (
                  <Link
                    href={`/customer/refund?tx=${encodeURIComponent(p.id)}`}
                    className="btn outline"
                    style={{ height: 36, fontSize: 13, alignSelf: "flex-start", padding: "0 14px" }}
                  >
                    <RotateCcw size={13} style={{ marginRight: 6 }} />
                    Get refund
                  </Link>
                ) : null}
              </div>
            ))}
          </section>
        )}
      </main>
    </>
  );
}
