"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CircleCheck } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";

type Invoice = {
  id: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
  totalAmount: string;
  expiresAt: string;
  payment: { asset: string | null; payerAddress: string | null; txHash: string | null } | null;
};

const rand = (v: string | number) => `R${Number(v).toFixed(2)}`;

export default function RequestPayment() {
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<Invoice & { totalAmount: string }>("/invoices", {
        body: {
          currency: "ZAR",
          items: [{ name: label.trim() || "Payment", quantity: 1, unitPrice: Math.round(value * 100) / 100 }],
        },
      });
      setInvoice({ ...created, status: "PENDING", payment: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the payment request");
    } finally {
      setBusy(false);
    }
  }

  // Poll until paid / expired, and tick the countdown
  useEffect(() => {
    if (!invoice || invoice.status !== "PENDING") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const next = await api<Invoice>(`/invoices/${invoice.id}`);
        if (next.status !== "PENDING") setInvoice(next);
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [invoice]);

  function reset() {
    setInvoice(null);
    setAmount("");
    setLabel("");
  }

  // ---------- Paid ----------
  if (invoice?.status === "PAID") {
    return (
      <>
        <PageHeader title="Payment received" hideBalance />
        <main className="share">
          <div className="receipt-icon"><CircleCheck size={40} /></div>
          <div className="shop">{rand(invoice.totalAmount)} received</div>
          {invoice.payment?.asset && <p className="center-note">Paid in {invoice.payment.asset}</p>}
          <div className="actions">
            <button className="btn primary" onClick={reset}>New payment</button>
          </div>
        </main>
      </>
    );
  }

  // ---------- Showing QR ----------
  if (invoice) {
    const secondsLeft = Math.max(0, Math.floor((new Date(invoice.expiresAt).getTime() - now) / 1000));
    const expired = invoice.status === "EXPIRED" || secondsLeft === 0;
    return (
      <>
        <PageHeader title="Request a payment" hideBalance />
        <main className="share">
          <div className="shop">{rand(invoice.totalAmount)}</div>
          {expired ? (
            <div className="alert bad" style={{ width: "100%" }}>This code has expired. Create a new one.</div>
          ) : (
            <>
              <div className="qr">
                {/* Single-use code: encodes only this invoice's pay link, never an amount */}
                <QRCodeSVG value={`${API_URL}/x402/pay/${invoice.id}`} size={220} level="M" />
              </div>
              <p className="center-note">
                Ask the customer to scan with the app. Waiting for payment… {Math.floor(secondsLeft / 60)}:
                {String(secondsLeft % 60).padStart(2, "0")}
              </p>
            </>
          )}
          <div className="actions">
            {!expired && (
              <button
                className="btn outline"
                onClick={() => navigator.clipboard?.writeText(`${API_URL}/x402/pay/${invoice.id}`)}
              >
                Copy payment link
              </button>
            )}
            <button className="btn ghost" onClick={reset}>{expired ? "New payment" : "Cancel"}</button>
          </div>
        </main>
      </>
    );
  }

  // ---------- Amount entry ----------
  return (
    <>
      <PageHeader title="Request a payment" hideBalance />
      <form className="share" onSubmit={create}>
        <div style={{ width: "100%" }}>
          <label htmlFor="amount" className="code-label" style={{ display: "block", marginBottom: 8 }}>
            Amount (ZAR)
          </label>
          <input
            id="amount"
            className="input"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
        <div style={{ width: "100%" }}>
          <label htmlFor="label" className="code-label" style={{ display: "block", marginBottom: 8 }}>
            What is it for? (optional)
          </label>
          <input id="label" className="text-input" maxLength={80} placeholder="Payment" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {error && <div className="alert bad" style={{ width: "100%" }}>{error}</div>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={!valid || busy}>
            {busy ? "Creating…" : valid ? `Get paid ${rand(value)}` : "Enter an amount"}
          </button>
        </div>
      </form>
    </>
  );
}
