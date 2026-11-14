"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, RotateCcw, Wallet, X } from "lucide-react";
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

type ReversalItem = {
  id: string;
  transactionId: string;
  originalAmount?: string;
  payerAddress?: string | null;
  status: string;
  amount: string;
  reversalFee: string;
  reason?: string | null;
  expiresAt: string;
  refundTxHash?: string | null;
  refundExplorerUrl?: string | null;
  createdAt: string;
};

const timestamp = (d: string) =>
  new Date(d).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function History() {
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [account, setAccount] = useState("main");
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [reversals, setReversals] = useState<ReversalItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [txList, revList] = await Promise.all([
        api<Txn[]>("/transactions"),
        api<ReversalItem[]>("/reversals").catch(() => [] as ReversalItem[]),
      ]);
      setTxns(txList);
      setReversals(revList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load transactions");
    }
  }, []);

  useEffect(() => {
    loadAccounts()
      .then((r) => setAccounts(r.accounts))
      .catch(() => undefined); // selector falls back to the main shop
    load();
  }, [load]);

  async function respondReversal(reversalId: string, action: "APPROVE" | "DECLINE") {
    setBusyId(reversalId);
    setError(null);
    try {
      await api(`/reversals/${reversalId}`, {
        method: "PATCH",
        body: { action },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action.toLowerCase()} refund`);
    } finally {
      setBusyId(null);
    }
  }

  // Invoice payments are received by the main shop; branch accounts receive direct transfers
  const rows = account === "main" ? txns : [];
  const pendingReversals = reversals.filter((r) => r.status === "PENDING_MERCHANT");

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

        {account === "main" && pendingReversals.length > 0 && (
          <section className="stack" style={{ paddingTop: 4, paddingBottom: 12 }}>
            <strong style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <RotateCcw size={16} color="var(--accent)" /> Pending customer refund requests ({pendingReversals.length})
            </strong>
            {pendingReversals.map((r) => (
              <div key={r.id} className="pay-item">
                <div className="top">
                  <div>
                    <div className="merchant">
                      Refund to {r.payerAddress ? shortAddress(r.payerAddress) : "Customer"}
                    </div>
                    <div className="meta">
                      Requested {timestamp(r.createdAt)} · Fee kept: {formatZark(Number(r.reversalFee))}
                    </div>
                    {r.reason && (
                      <div className="meta" style={{ fontStyle: "italic", marginTop: 2 }}>
                        &ldquo;{r.reason}&rdquo;
                      </div>
                    )}
                  </div>
                  <div className="amt">{formatZark(Number(r.amount))}</div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button
                    className="btn primary"
                    style={{ height: 38, fontSize: 13, flex: 1 }}
                    disabled={busyId === r.id}
                    onClick={() => respondReversal(r.id, "APPROVE")}
                  >
                    <Check size={15} style={{ marginRight: 4 }} />
                    {busyId === r.id ? "Processing…" : "Approve & refund"}
                  </button>
                  <button
                    className="btn outline"
                    style={{ height: 38, fontSize: 13, flex: 1 }}
                    disabled={busyId === r.id}
                    onClick={() => respondReversal(r.id, "DECLINE")}
                  >
                    <X size={15} style={{ marginRight: 4 }} />
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

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
