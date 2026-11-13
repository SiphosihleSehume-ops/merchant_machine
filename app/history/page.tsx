"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { formatZark } from "@/lib/data";
import { loadAccounts, type BusinessAccount } from "@/lib/accounts";
import { shortAddress } from "@/lib/wallet";

type Txn = {
  id: string;
  amount: string;
  asset: string | null;
  payerAddress: string | null;
  status: "PENDING" | "SETTLED" | "FAILED" | "REVERSED";
  createdAt: string;
  explorerUrl: string | null;
};

const timestamp = (d: string) =>
  new Date(d).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function History() {
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [account, setAccount] = useState("main");
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts()
      .then((r) => setAccounts(r.accounts))
      .catch(() => undefined); // selector falls back to the main shop
    api<Txn[]>("/transactions")
      .then(setTxns)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load transactions"));
  }, []);

  // Invoice payments are received by the main shop; branch accounts receive direct transfers
  const rows = account === "main" ? txns : [];

  return (
    <>
      <PageHeader title="Transaction history" />
      <main>
        <div className="field">
          <label htmlFor="acct">From account</label>
          <div className="select-wrap">
            <select id="acct" value={account} onChange={(e) => setAccount(e.target.value)}>
              {(accounts.length ? accounts : [{ id: "main", name: "Main account" } as BusinessAccount]).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <ChevronDown size={22} />
          </div>
        </div>

        {error && <p className="center-note" style={{ color: "var(--bad)" }}>{error}</p>}
        {rows === null && !error && <p className="center-note">Loading transactions…</p>}
        {rows?.length === 0 && <p className="center-note" style={{ paddingTop: 24 }}>No payments to this account yet.</p>}

        {rows?.map((t) => {
          const body = (
            <>
              <span className="txn-icon"><Wallet size={28} strokeWidth={1.7} /></span>
              <span style={{ minWidth: 0 }}>
                <span className="caption" style={{ display: "block" }}>
                  Payment from{t.status !== "SETTLED" && ` · ${t.status.toLowerCase()}`}
                </span>
                <span className="title" style={{ display: "block" }} title={t.payerAddress ?? undefined}>
                  {t.payerAddress ? shortAddress(t.payerAddress) : "Awaiting payment"}
                </span>
                <span className="date">{timestamp(t.createdAt)}</span>
              </span>
              <span className="amount">{formatZark(Number(t.amount))}</span>
            </>
          );
          return t.explorerUrl ? (
            <a key={t.id} className="txn" data-ok={t.status !== "FAILED"} data-status={t.status} href={t.explorerUrl} target="_blank" rel="noreferrer" aria-label={`View transaction from ${t.payerAddress ?? "wallet"} on Etherscan`}>
              {body}
            </a>
          ) : (
            <div key={t.id} className="txn" data-ok={t.status !== "FAILED"} data-status={t.status}>
              {body}
            </div>
          );
        })}
      </main>
    </>
  );
}
