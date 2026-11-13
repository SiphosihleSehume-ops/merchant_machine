"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CircleCheck, Plus, Trash2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";

type Invoice = {
  id: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
  totalAmount: string;
  expiresAt: string;
  items?: { name: string; quantity: number; unitPrice: string; total: string }[];
  payment: { asset: string | null; payerAddress: string | null; txHash: string | null } | null;
};

type Line = { key: number; name: string; quantity: string; unitPrice: string };

const zark = (v: string | number) =>
  `ZARK ${Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (v: string) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0;
const qty = (v: string) => /^\d{1,4}$/.test(v) && Number(v) >= 1;
const lineTotal = (l: Line) => (money(l.unitPrice) && qty(l.quantity) ? Number(l.unitPrice) * Number(l.quantity) : 0);

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, name: "", quantity: "1", unitPrice: "" });

export default function RequestPayment() {
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const allValid = lines.length > 0 && lines.every((l) => l.name.trim() && qty(l.quantity) && money(l.unitPrice));

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Server recalculates every total; the client only proposes items
      const created = await api<Invoice>("/invoices", {
        body: {
          currency: "ZAR",
          items: lines.map((l) => ({ name: l.name.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
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
    setLines([blank()]);
  }

  // ---------- Paid ----------
  if (invoice?.status === "PAID") {
    return (
      <>
        <PageHeader title="Payment received" hideBalance />
        <main className="share">
          <div className="receipt-icon"><CircleCheck size={40} /></div>
          <div className="shop">{zark(invoice.totalAmount)} received</div>
          {invoice.payment?.asset && <p className="center-note">Paid in {invoice.payment.asset}</p>}
          <div className="actions">
            <button className="btn primary" onClick={reset}>New payment</button>
          </div>
        </main>
      </>
    );
  }

  // ---------- QR ----------
  if (invoice) {
    const secondsLeft = Math.max(0, Math.floor((new Date(invoice.expiresAt).getTime() - now) / 1000));
    const expired = invoice.status === "EXPIRED" || secondsLeft === 0;
    return (
      <>
        <PageHeader title="Request a payment" hideBalance />
        <main className="share">
          <div className="lines" style={{ width: "100%" }}>
            {invoice.items?.map((i, n) => (
              <div className="line" key={n}>
                <span>{i.quantity} × {i.name}</span>
                <span>{zark(i.total)}</span>
              </div>
            ))}
            <div className="line total"><span>Total</span><span>{zark(invoice.totalAmount)}</span></div>
          </div>
          {expired ? (
            <div className="alert bad" style={{ width: "100%" }}>This code has expired. Create a new one.</div>
          ) : (
            <>
              <div className="qr">
                {/* Single-use code: encodes only this invoice's link, never an amount */}
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
              <button className="btn outline" onClick={() => navigator.clipboard?.writeText(`${API_URL}/x402/pay/${invoice.id}`)}>
                Copy payment link
              </button>
            )}
            <button className="btn ghost" onClick={reset}>{expired ? "New payment" : "Cancel"}</button>
          </div>
        </main>
      </>
    );
  }

  // ---------- Item builder ----------
  return (
    <>
      <PageHeader title="Request a payment" hideBalance />
      <form className="stack" onSubmit={generate}>
        <p className="muted" style={{ fontSize: 14 }}>Add what the customer is buying. The QR code is created from the total.</p>

        {lines.map((l, idx) => (
          <div key={l.key} className="pay-item" style={{ gap: 10 }}>
            <div className="top" style={{ alignItems: "center" }}>
              <strong style={{ fontSize: 14 }}>Item {idx + 1}</strong>
              {lines.length > 1 && (
                <button type="button" className="icon-btn trash" aria-label={`Remove item ${idx + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 size={18} />
                </button>
              )}
            </div>
            <div className="form-field">
              <label htmlFor={`name-${l.key}`}>Item bought</label>
              <input id={`name-${l.key}`} className="text-input" placeholder="e.g. Bread" maxLength={80} value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 10 }}>
              <div className="form-field">
                <label htmlFor={`price-${l.key}`}>Price (ZARK)</label>
                <input id={`price-${l.key}`} className="text-input" inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value.replace(/[^0-9.]/g, "") })} />
              </div>
              <div className="form-field">
                <label htmlFor={`qty-${l.key}`}>Quantity</label>
                <input id={`qty-${l.key}`} className="text-input" inputMode="numeric" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
              </div>
            </div>
            <div className="line" style={{ padding: 0 }}>
              <span className="sub">Line total</span>
              <span>{zark(lineTotal(l))}</span>
            </div>
          </div>
        ))}

        <button type="button" className="btn ghost" onClick={() => setLines((ls) => [...ls, blank()])}>
          <Plus size={18} /> Add another item
        </button>

        <div className="lines">
          <div className="line total"><span>Total</span><span>{zark(total)}</span></div>
        </div>

        {error && <div className="alert bad" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={!allValid || busy}>
          {busy ? "Creating…" : allValid ? `Generate QR · ${zark(total)}` : "Complete every item"}
        </button>
      </form>
    </>
  );
}
