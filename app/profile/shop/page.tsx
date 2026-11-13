"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, ChevronDown, Wallet } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { connectWallet, hasMetaMask, shortAddress, signShopWallet } from "@/lib/wallet";

type Shop = {
  id: string;
  name: string;
  category: string | null;
  cryptoWallet: string | null;
  feePercentage: number;
  categories: string[];
};

type WalletProof = { address: `0x${string}`; issuedAt: string; signature: string };

export default function MyShop() {
  const { session, refresh } = useAuth();
  const router = useRouter();
  const [shop, setShop] = useState<Shop | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [proof, setProof] = useState<WalletProof | null>(null); // new wallet, signed, not yet saved
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Shop>("/merchants/me/shop")
      .then((s) => {
        setShop(s);
        setName(s.name);
        setCategory(s.category ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your shop"));
  }, []);

  async function connect() {
    if (!session) return;
    setConnecting(true);
    setError(null);
    setSaved(false);
    try {
      const address = await connectWallet();
      // Sign to prove this wallet is yours; payments will be sent here
      setProof(await signShopWallet(session.user.id, address));
    } catch (err: any) {
      setError(err?.code === 4001 ? "Request cancelled in MetaMask." : err?.shortMessage || err?.message || "Could not connect MetaMask");
    } finally {
      setConnecting(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api<Omit<Shop, "categories">>("/merchants/me/shop", {
        method: "PUT",
        body: { name: name.trim(), category, ...(proof ? { wallet: proof } : {}) },
      });
      setShop((s) => (s ? { ...s, ...updated } : s));
      setProof(null);
      setSaved(true);
      await refresh().catch(() => undefined); // update shop name shown on the home screen
      // Back to My Profile, which shows a "Shop saved" confirmation
      router.replace("/profile?saved=shop");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your shop");
    } finally {
      setSaving(false);
    }
  }

  const wallet = proof?.address ?? shop?.cryptoWallet ?? null;
  const dirty =
    !!shop && (name.trim() !== shop.name || category !== (shop.category ?? "") || !!proof);
  const canSave = dirty && name.trim().length >= 2 && !!category && !!wallet && !saving;

  return (
    <>
      <PageHeader title="My shop" />
      <main>
        {!shop && !error && <p className="center-note" style={{ padding: 32 }}>Loading your shop…</p>}

        {shop && (
          <form className="stack" onSubmit={save}>
            {/* 1. Shop name */}
            <div className="form-field">
              <label htmlFor="shop-name">1. Shop name</label>
              <input
                id="shop-name"
                className="text-input"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <span className="muted" style={{ fontSize: 13 }}>Customers see this name before they pay you.</span>
            </div>

            {/* 2. Category */}
            <div className="form-field">
              <label htmlFor="shop-category">2. Category</label>
              <div className="select-wrap">
                <select
                  id="shop-category"
                  className="text-input"
                  style={{ appearance: "none", paddingRight: 40 }}
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="" disabled>Choose a category</option>
                  {shop.categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <ChevronDown size={20} style={{ position: "absolute", right: 14, top: 15, pointerEvents: "none", color: "var(--muted)" }} />
              </div>
            </div>

            {/* 3. Payout wallet */}
            <div className="form-field">
              <label>3. Wallet to receive payments</label>
              <div className="wallet-card" style={{ margin: 0 }}>
                {wallet ? (
                  <div className="addr">
                    <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)" }}>
                      <Wallet size={18} color="var(--accent)" />
                      <span title={wallet}>{shortAddress(wallet)}</span>
                    </span>
                    {proof ? (
                      <span className="pill">Not saved yet</span>
                    ) : (
                      <span className="pill ok"><BadgeCheck size={14} /> Receiving payments</span>
                    )}
                  </div>
                ) : (
                  <span className="muted" style={{ fontSize: 14 }}>
                    No wallet yet. Connect MetaMask so customers can pay you.
                  </span>
                )}

                {hasMetaMask() ? (
                  <button type="button" className={wallet ? "btn ghost" : "btn primary"} onClick={connect} disabled={connecting}>
                    {connecting ? "Check MetaMask…" : wallet ? "Use a different wallet" : "Connect MetaMask"}
                  </button>
                ) : (
                  <a className="btn outline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                    Install MetaMask
                  </a>
                )}
                <span className="muted" style={{ fontSize: 13 }}>
                  You&apos;ll sign a message to prove the wallet is yours. No gas is needed. Every payment from
                  your QR codes goes to this wallet.
                </span>
              </div>
            </div>

            {error && <div className="alert bad" role="alert">{error}</div>}
            {saved && <div className="alert ok">Shop saved. New payments will go to {shortAddress(shop.cryptoWallet)}.</div>}

            <button className="btn primary" type="submit" disabled={!canSave}>
              {saving ? "Saving…" : "Save shop"}
            </button>
          </form>
        )}

        {!shop && error && <div className="stack"><div className="alert bad" role="alert">{error}</div></div>}
      </main>
    </>
  );
}
