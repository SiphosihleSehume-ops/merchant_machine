"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Receipt, RefreshCw, RotateCcw } from "lucide-react";
import CustomerHeader from "@/components/CustomerHeader";
import EmptyState from "@/components/EmptyState";
import { api } from "@/lib/api";
import { useWallet } from "@/lib/useWallet";
import { hasMetaMask, shortAddress } from "@/lib/wallet";

export type CustomerPayment = {
  id: string;
  merchantName: string;
  amount: string;
  serviceFee: string | null;
  currency: string;
  asset: string | null;
  payerAddress: string | null;
  status: "PENDING" | "SETTLED" | "FAILED" | "REVERSED";
  createdAt: string;
  items: { name: string; quantity: number; total: string }[];
  explorerUrl: string | null;
  reversal: {
    id: string;
    status: string;
    amount: string;
    reversalFee: string;
    reason?: string | null;
    expiresAt: string;
    completedAt?: string | null;
    refundTxHash?: string | null;
    refundExplorerUrl?: string | null;
  } | null;
};

type ReversalResult = {
  id: string;
  status: string;
  amount: string;
  reversalFee: string;
  refundTxHash?: string | null;
  refundExplorerUrl?: string | null;
};

type FilterTab = "all" | "eligible" | "refunds";

const QUICK_REASONS = [
  "Wrong items",
  "Overcharged",
  "Cancelled order",
  "Defective item",
];

const rand = (v: string | number) =>
  "R" + Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (d: string) =>
  new Date(d).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const REVERSAL_LABEL: Record<string, string> = {
  PENDING_MERCHANT: "Waiting for merchant",
  APPROVED: "Approved",
  DECLINED: "Declined",
  COMPLETED: "Refunded",
  FAILED: "Refund failed",
};

export default function Refund() {
  const w = useWallet();
  const [payments, setPayments] = useState<CustomerPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<CustomerPayment | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("all");

  const load = useCallback(async () => {
    try {
      setError(null);
      const q = w.address ? `?wallet=${encodeURIComponent(w.address)}` : "";
      const list = await api<CustomerPayment[]>(`/transactions${q}`);
      setPayments(list);

      const txParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tx") : null;
      if (txParam) {
        const match = list.find((p) => p.id === txParam && p.status === "SETTLED" && !p.reversal);
        if (match) setTarget(match);
        window.history.replaceState(null, "", "/customer/refund");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payments");
    }
  }, [w.address]);

  useEffect(() => {
    load();
  }, [load]);

  async function claimRefund(reversalId: string) {
    setClaimingId(reversalId);
    setError(null);
    setNotice(null);
    try {
      const res = await api<ReversalResult>(`/reversals/${reversalId}/claim`, {
        body: { walletAddress: w.address ?? undefined },
      });
      if (res.status === "COMPLETED") {
        setNotice(`Refund of ${rand(res.amount)} completed and sent to your wallet!`);
        w.reloadBalances();
      } else {
        setNotice("Refund request is pending merchant confirmation.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process refund right now");
    } finally {
      setClaimingId(null);
    }
  }

  const stats = useMemo(() => {
    const list = payments ?? [];
    const eligible = list.filter((p) => p.status === "SETTLED" && !p.reversal).length;
    const pending = list.filter((p) => p.reversal?.status === "PENDING_MERCHANT").length;
    const refundedTotal = list
      .filter((p) => p.reversal?.status === "COMPLETED")
      .reduce((sum, p) => sum + Number(p.reversal?.amount ?? 0), 0);
    return { eligible, pending, refundedTotal };
  }, [payments]);

  const filtered = useMemo(() => {
    if (!payments) return null;
    if (tab === "eligible") return payments.filter((p) => p.status === "SETTLED" && !p.reversal);
    if (tab === "refunds") return payments.filter((p) => Boolean(p.reversal));
    return payments;
  }, [payments, tab]);

  return (
    <>
      <CustomerHeader title="Refunds" />
      <main className="stack">
        <p className="muted">
          Select a settled payment to get a full or partial refund back to your wallet. The platform service fee is non-refundable.
        </p>

        <WalletLinkHint onLinked={load} />

        {payments && payments.length > 0 && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "12px 10px",
                textAlign: "center",
              }}
            >
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Refundable</div>
                <strong style={{ fontSize: 18 }}>{stats.eligible}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Pending</div>
                <strong style={{ fontSize: 18 }}>{stats.pending}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Refunded</div>
                <strong style={{ fontSize: 18, color: "var(--ok, #22c55e)" }}>{rand(stats.refundedTotal)}</strong>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {(
                [
                  { id: "all", label: "All" },
                  { id: "eligible", label: `Refundable (${stats.eligible})` },
                  { id: "refunds", label: "Refund history" },
                ] as { id: FilterTab; label: string }[]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tab === t.id ? "btn primary" : "btn outline"}
                  style={{ height: 36, fontSize: 13, padding: "0 12px", flex: 1 }}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </>
        )}

        {notice && (
          <div className="alert ok" role="status" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 size={18} />
            <span>{notice}</span>
          </div>
        )}
        {error && <div className="alert bad" role="alert">{error}</div>}
        {payments === null && !error && <p className="center-note">Loading payments…</p>}
        {filtered?.length === 0 && (
          <EmptyState title="No matching payments" icon={<Receipt size={40} />}>
            {tab === "eligible"
              ? "You have no settled payments awaiting a refund."
              : tab === "refunds"
                ? "You haven't requested any refunds yet."
                : "Payments you make by scanning a merchant's code will show up here."}
          </EmptyState>
        )}

        {filtered?.map((p) => {
          const fee = Number(p.serviceFee ?? 0);
          const netRefundable = Math.max(0, Number(p.amount) - fee);
          return (
            <div className="pay-item" key={p.id}>
              <div className="top">
                <div>
                  <div className="merchant">{p.merchantName}</div>
                  <div className="meta">
                    {when(p.createdAt)}
                    {p.asset && ` · ${p.asset}`}
                    {p.items.length > 0 && ` · ${p.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}`}
                  </div>
                </div>
                <div>
                  <div className="amt">{rand(p.amount)}</div>
                  <div style={{ textAlign: "right", marginTop: 4 }}>
                    <span className="badge" data-status={p.status}>{p.status}</span>
                  </div>
                </div>
              </div>

              {p.reversal ? (
                <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                  <div className="meta">
                    Refund{" "}
                    <span className="badge" data-status={p.reversal.status}>
                      {REVERSAL_LABEL[p.reversal.status] ?? p.reversal.status}
                    </span>{" "}
                    <strong>{rand(p.reversal.amount)}</strong>
                    <span className="muted"> (fee kept: {rand(p.reversal.reversalFee)})</span>
                    {p.reversal.status === "PENDING_MERCHANT" && ` · expires ${when(p.reversal.expiresAt)}`}
                  </div>
                  {p.reversal.reason && (
                    <div className="meta" style={{ fontStyle: "italic" }}>
                      Reason: &ldquo;{p.reversal.reason}&rdquo;
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {(p.reversal.status === "PENDING_MERCHANT" || p.reversal.status === "FAILED") && (
                      <button
                        className="btn outline"
                        style={{ height: 38, fontSize: 13 }}
                        onClick={() => claimRefund(p.reversal!.id)}
                        disabled={claimingId === p.reversal.id}
                      >
                        <RefreshCw size={14} style={{ marginRight: 6 }} />
                        {claimingId === p.reversal.id ? "Processing refund…" : `Complete refund (${rand(p.reversal.amount)})`}
                      </button>
                    )}
                    {p.reversal.refundExplorerUrl && (
                      <a
                        className="link-btn"
                        href={p.reversal.refundExplorerUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View refund tx <ExternalLink size={12} style={{ verticalAlign: "-1px" }} />
                      </a>
                    )}
                  </div>
                </div>
              ) : p.status === "SETTLED" ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 4 }}>
                  <span className="meta">
                    Refundable: <strong>{rand(netRefundable)}</strong> (after {rand(fee)} fee)
                  </span>
                  <button
                    className="btn primary"
                    style={{ height: 40, fontSize: 13, padding: "0 16px" }}
                    onClick={() => {
                      setNotice(null);
                      setTarget(p);
                    }}
                  >
                    <RotateCcw size={14} style={{ marginRight: 6 }} />
                    Get refund
                  </button>
                </div>
              ) : null}

              {p.explorerUrl && (
                <a className="link-btn" href={p.explorerUrl} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>
                  View payment on explorer
                </a>
              )}
            </div>
          );
        })}
      </main>

      {target && (
        <RefundModal
          payment={target}
          walletAddress={w.address}
          onClose={() => setTarget(null)}
          onDone={(res) => {
            setTarget(null);
            if (res.status === "COMPLETED") {
              setNotice(`Refund of ${rand(res.amount)} sent back to your wallet!`);
              w.reloadBalances();
            } else {
              setNotice(`Refund request for ${rand(res.amount)} submitted.`);
            }
            load();
          }}
        />
      )}
    </>
  );
}

function RefundModal({
  payment,
  walletAddress,
  onClose,
  onDone,
}: {
  payment: CustomerPayment;
  walletAddress: `0x${string}` | null;
  onClose: () => void;
  onDone: (res: ReversalResult) => void;
}) {
  const fee = Number(payment.serviceFee ?? 0);
  const maxBack = Math.max(0, Number((Number(payment.amount) - fee).toFixed(2)));

  const [mode, setMode] = useState<"full" | "partial">("full");
  const [customAmount, setCustomAmount] = useState(maxBack.toFixed(2));
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestedBack = mode === "full" ? maxBack : Number(customAmount || 0);
  const amountValid = Number.isFinite(requestedBack) && requestedBack >= 0.01 && requestedBack <= maxBack;
  const recipientWallet = payment.payerAddress || walletAddress;

  async function submit() {
    if (!amountValid) {
      setError(`Enter a refund amount between R0.01 and ${rand(maxBack)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<ReversalResult>("/reversals", {
        body: {
          transactionId: payment.id,
          amount: mode === "partial" ? Number(requestedBack.toFixed(2)) : undefined,
          reason: reason.trim() || undefined,
          acknowledgeNonRefundableFee: true,
          walletAddress: walletAddress ?? undefined,
          autoApprove: true,
        },
      });
      onDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request refund");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="refund-title" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 id="refund-title">Get a refund</h2>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={mode === "full" ? "btn primary" : "btn outline"}
            style={{ height: 36, fontSize: 13, flex: 1 }}
            onClick={() => {
              setMode("full");
              setCustomAmount(maxBack.toFixed(2));
            }}
          >
            Full refund ({rand(maxBack)})
          </button>
          <button
            type="button"
            className={mode === "partial" ? "btn primary" : "btn outline"}
            style={{ height: 36, fontSize: 13, flex: 1 }}
            onClick={() => setMode("partial")}
          >
            Partial refund
          </button>
        </div>

        {mode === "partial" && (
          <div className="form-field">
            <label htmlFor="refund-amt">Refund amount (max {rand(maxBack)})</label>
            <input
              id="refund-amt"
              type="number"
              step="0.01"
              min="0.01"
              max={maxBack}
              className="text-input"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
            />
          </div>
        )}

        <div className="lines">
          <div className="line"><span>Paid to {payment.merchantName}</span><span>{rand(payment.amount)}</span></div>
          <div className="line"><span className="sub">Service fee (non-refundable)</span><span className="sub">−{rand(fee)}</span></div>
          <div className="line total"><span>Refund to your wallet</span><span>{rand(amountValid ? requestedBack : 0)}</span></div>
        </div>

        {recipientWallet && (
          <div className="meta" style={{ fontSize: 12 }}>
            Refund destination: <strong>{shortAddress(recipientWallet)}</strong> ({payment.asset ?? "ZARK"})
          </div>
        )}

        <div className="alert warn">
          The service fee of {rand(fee)} is <strong>not refundable</strong>. Your refund of{" "}
          <strong>{rand(amountValid ? requestedBack : 0)}</strong> in {payment.asset ?? "ZARK"} will be returned to your wallet.
        </div>

        <div className="form-field">
          <label htmlFor="reason">Reason for refund</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className="btn outline"
                style={{ height: 28, fontSize: 12, padding: "0 10px" }}
                onClick={() => setReason(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            id="reason"
            className="text-input"
            maxLength={500}
            placeholder="Describe why you need a refund (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <label className="check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I understand the {rand(fee)} service fee will not be refunded.
        </label>

        {error && <div className="alert bad" role="alert">{error}</div>}

        <button className="btn primary" onClick={submit} disabled={!ack || !amountValid || busy}>
          {busy ? "Processing refund…" : `Get refund (${rand(amountValid ? requestedBack : 0)})`}
        </button>
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Payments show here when they were made while signed in, or from the customer's connected/verified
 * wallet. If no wallet is verified yet, offer it so earlier payments from it appear across devices.
 */
function WalletLinkHint({ onLinked }: { onLinked: () => void }) {
  const w = useWallet();
  if (w.linked) return null;

  async function verify() {
    if (w.address) await w.relink();
    else await w.connect();
    onLinked();
  }

  return (
    <div className="alert warn">
      Verify the wallet you paid with
      {w.address ? <> ({shortAddress(w.address)})</> : null} to permanently link its payment &amp; refund history to your account.
      {hasMetaMask() && (
        <div style={{ marginTop: 8 }}>
          <button className="btn outline" style={{ height: 40, fontSize: 13 }} onClick={verify} disabled={w.busy}>
            {w.busy ? "Check MetaMask…" : w.address ? "Verify this wallet" : "Connect & verify wallet"}
          </button>
        </div>
      )}
      {w.error && <div style={{ marginTop: 6, color: "var(--bad)" }}>{w.error}</div>}
    </div>
  );
}
