"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, ChevronDown, Wallet } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { connectWallet, hasMetaMask, shortAddress, signBranchWallet } from "@/lib/wallet";

type Proof = { address: `0x${string}`; issuedAt: string; signature: string };

export default function AddAccount() {
  const router = useRouter();
  const { session } = useAuth();
  const [categories, setCategories] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ categories: string[] }>("/merchants/me/shop")
      .then((s) => setCategories(s.categories))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load categories"));
  }, []);

  async function connect() {
    if (!session) return;
    setConnecting(true);
    setError(null);
    try {
      const address = await connectWallet();
      setProof(await signBranchWallet(session.user.id, address));
    } catch (err: any) {
      setError(err?.code === 4001 ? "Request cancelled in MetaMask." : err?.shortMessage || err?.message || "Could not connect MetaMask");
    } finally {
      setConnecting(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!proof) return;
    setSaving(true);
    setError(null);
    try {
      await api("/merchants/me/accounts", { body: { name: name.trim(), category, wallet: proof } });
      router.replace("/accounts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the account");
      setSaving(false);
    }
  }

  const valid = name.trim().length >= 2 && !!category && !!proof;

  return (
    <>
      <PageHeader title="Add account" hideBalance />
      <form className="stack" onSubmit={save}>
        <div className="alert ok" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <BadgeCheck size={20} style={{ flex: "none", marginTop: 1 }} />
          <span>Uses your verified KYC. No new documents needed: just the business details and a new wallet.</span>
        </div>

        <div className="form-field">
          <label htmlFor="biz-name">1. Business name</label>
          <input id="biz-name" className="text-input" placeholder="e.g. Kasi Corner, Soweto branch" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="form-field">
          <label htmlFor="biz-category">2. Category</label>
          <div className="select-wrap">
            <select id="biz-category" className="text-input" style={{ appearance: "none" }} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="" disabled>Choose a category</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown size={20} style={{ position: "absolute", right: 14, top: 15, pointerEvents: "none", color: "var(--muted)" }} />
          </div>
        </div>

        <div className="form-field">
          <label>3. New wallet for this business</label>
          <div className="wallet-card" style={{ margin: 0 }}>
            {proof ? (
              <div className="addr">
                <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)" }}>
                  <Wallet size={18} color="var(--accent)" /> {shortAddress(proof.address)}
                </span>
                <span className="pill ok"><BadgeCheck size={13} /> Signed</span>
              </div>
            ) : (
              <span className="muted" style={{ fontSize: 14 }}>
                In MetaMask, select (or create) a different account from your main shop wallet, then connect it.
              </span>
            )}
            {hasMetaMask() ? (
              <button type="button" className={proof ? "btn ghost" : "btn primary"} onClick={connect} disabled={connecting}>
                {connecting ? "Check MetaMask…" : proof ? "Use a different wallet" : "Connect MetaMask"}
              </button>
            ) : (
              <a className="btn outline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask</a>
            )}
          </div>
        </div>

        {error && <div className="alert bad" role="alert">{error}</div>}

        <button className="btn primary" type="submit" disabled={!valid || saving}>
          {saving ? "Verifying on-chain…" : "Add account"}
        </button>
        <p className="center-note" style={{ fontSize: 13 }}>
          The wallet is recorded as KYC-verified on the blockchain. No personal details go on-chain.
        </p>
      </form>
    </>
  );
}
