"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import CustomerHeader from "@/components/CustomerHeader";
import EmptyState from "@/components/EmptyState";
import { api } from "@/lib/api";

type Payment = {
  id: string;
  merchantName: string;
  amount: string;
  serviceFee: string | null;
  currency: string;
  asset: string | null;
  status: "PENDING" | "SETTLED" | "FAILED" | "REVERSED";
  createdAt: string;
  items: { name: string; quantity: number; total: string }[];
  explorerUrl: string | null;
  reversal: { id: string; status: string; amount: string; reversalFee: string; expiresAt: string } | null;
};

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
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Payment | null>(null);

  const load = useCallback(async () => {
    try {
      setPayments(await api<Payment[]>("/transactions"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payments");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <CustomerHeader title="Refunds" />
      <main className="stack">
        <p className="muted">Choose a payment to request a refund. The merchant has to approve it.</p>
        {error && <div className="alert bad" role="alert">{error}</div>}
        {payments === null && !error && <p className="center-note">Loading payments…</p>}
        {payments?.length === 0 && (
          <EmptyState title="No payments yet" icon={<Receipt size={40} />}>
            Payments you make by scanning a merchant&apos;s code will show up here.
          </EmptyState>
        )}
        {payments?.map((p) => (
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
              <div className="meta">
                Refund <span className="badge" data-status={p.reversal.status}>{REVERSAL_LABEL[p.reversal.status] ?? p.reversal.status}</span>{" "}
                {rand(p.reversal.amount)}
                {p.reversal.status === "PENDING_MERCHANT" && ` · merchant has until ${when(p.reversal.expiresAt)}`}
              </div>
            ) : p.status === "SETTLED" ? (
              <button className="btn outline" style={{ height: 42, fontSize: 13 }} onClick={() => setTarget(p)}>
                Request refund
              </button>
            ) : null}

            {p.explorerUrl && (
              <a className="link-btn" href={p.explorerUrl} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-start" }}>
                View on explorer
              </a>
            )}
          </div>
        ))}
      </main>

      {target && (
        <RefundModal
          payment={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            load();
          }}
        />
      )}
    </>
  );
}

function RefundModal({ payment, onClose, onDone }: { payment: Payment; onClose: () => void; onDone: () => void }) {
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fee = Number(payment.serviceFee ?? 0);
  const back = Number(payment.amount) - fee;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/reversals", {
        body: { transactionId: payment.id, reason: reason.trim() || undefined, acknowledgeNonRefundableFee: true },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request refund");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="refund-title" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 id="refund-title">Request a refund</h2>
        <div className="lines">
          <div className="line"><span>{payment.merchantName}</span><span>{rand(payment.amount)}</span></div>
          <div className="line"><span className="sub">Service fee (non-refundable)</span><span className="sub">−{rand(fee)}</span></div>
          <div className="line total"><span>You get back</span><span>{rand(back)}</span></div>
        </div>
        <div className="alert warn">
          The service fee of {rand(fee)} is <strong>not refundable</strong>. The merchant must approve this request
          before any money is returned.
        </div>
        <div className="form-field">
          <label htmlFor="reason">Reason (optional)</label>
          <textarea id="reason" className="text-input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I understand the {rand(fee)} service fee will not be refunded.
        </label>
        {error && <div className="alert bad" role="alert">{error}</div>}
        <button className="btn primary" onClick={submit} disabled={!ack || busy}>
          {busy ? "Sending…" : "Request refund"}
        </button>
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
