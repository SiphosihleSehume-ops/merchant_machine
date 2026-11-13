"use client";

import { useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import type { PaymentRequired } from "@x402/core/types";
import { CircleCheck, ShieldCheck, Store } from "lucide-react";
import CustomerHeader from "@/components/CustomerHeader";
import QrScanner from "@/components/QrScanner";
import { API_URL, EXPLORER_TX_URL } from "@/lib/config";
import { useWallet } from "@/lib/useWallet";
import { payInvoice, readPaymentRequired, shortAddress } from "@/lib/wallet";

type Challenge = {
  invoice: {
    id: string;
    merchant: { name: string; category?: string | null; wallet: string };
    items: { name: string; quantity: number; unitPrice: string; total: string }[];
    subtotal: string;
    total: string;
    currency: string;
    merchantFeePercentage: number;
    expiresAt: string;
  };
  payment: { options: { symbol: string; asset: `0x${string}`; amount: string; zarPerToken: string }[] };
};

type Step =
  | { kind: "scan" }
  | { kind: "loading" }
  | { kind: "review"; payUrl: string; challenge: Challenge; paymentRequired: PaymentRequired }
  | { kind: "paying"; payUrl: string; challenge: Challenge; paymentRequired: PaymentRequired }
  | { kind: "done"; challenge: Challenge; symbol: string; amount: string; txHash: string };

const PAY_PREFIX = `${API_URL}/x402/pay/`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only accept our own invoice links: a QR sticker pointing elsewhere is rejected. */
function parsePayUrl(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith(PAY_PREFIX)) return null;
  const id = t.slice(PAY_PREFIX.length).split(/[?#]/)[0];
  return UUID.test(id) ? `${PAY_PREFIX}${id}` : null;
}

const rand = (v: string | number) =>
  "R" + Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tokenAmount = (atomic: string, symbol: string) =>
  `${Number(formatUnits(BigInt(atomic), 6)).toLocaleString("en-ZA", { maximumFractionDigits: 6 })} ${symbol}`;

export default function Pay() {
  const w = useWallet();
  const [step, setStep] = useState<Step>({ kind: "scan" });
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [asset, setAsset] = useState<`0x${string}` | null>(null);
  const [scanKey, setScanKey] = useState(0); // remount scanner to scan again

  async function load(text: string) {
    setError(null);
    const payUrl = parsePayUrl(text);
    if (!payUrl) {
      setError("That isn't a Merchant Machine payment code. Only pay codes shown in the merchant's app.");
      setStep({ kind: "scan" });
      setScanKey((k) => k + 1);
      return;
    }
    setStep({ kind: "loading" });
    try {
      const res = await fetch(payUrl, { headers: { accept: "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (res.status !== 402) {
        throw new Error(body?.error || `Unexpected response (${res.status})`);
      }
      const challenge = body as Challenge;
      setAsset(challenge.payment.options[0]?.asset ?? null);
      setStep({ kind: "review", payUrl, challenge, paymentRequired: readPaymentRequired(res, body) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the invoice");
      setStep({ kind: "scan" });
    }
  }

  async function pay() {
    if (step.kind !== "review" || !asset || !w.address) return;
    setError(null);
    setStep({ ...step, kind: "paying" });
    try {
      const { settlement } = await payInvoice(step.payUrl, w.address, step.paymentRequired, asset);
      const option = step.challenge.payment.options.find((o) => o.asset === asset)!;
      setStep({ kind: "done", challenge: step.challenge, symbol: option.symbol, amount: option.amount, txHash: settlement.transaction });
      w.reloadBalances();
    } catch (err: any) {
      setError(err?.code === 4001 ? "You cancelled the signature in MetaMask." : err?.shortMessage || err?.message || "Payment failed");
      setStep({ ...step, kind: "review" });
    }
  }

  // ---------------- Receipt ----------------
  if (step.kind === "done") {
    const inv = step.challenge.invoice;
    return (
      <>
        <CustomerHeader title="Payment complete" />
        <main className="stack">
          <div className="receipt-icon"><CircleCheck size={40} /></div>
          <h2 style={{ textAlign: "center", fontSize: 22 }}>Paid {inv.merchant.name}</h2>
          <div className="lines">
            {inv.items.map((i, n) => (
              <div className="line" key={n}>
                <span>{i.quantity} × {i.name}</span>
                <span>{rand(i.total)}</span>
              </div>
            ))}
            <div className="line total"><span>Total</span><span>{rand(inv.total)}</span></div>
            <div className="line"><span className="sub">Paid with</span><span>{tokenAmount(step.amount, step.symbol)}</span></div>
          </div>
          <a className="btn ghost" href={`${EXPLORER_TX_URL}${step.txHash}`} target="_blank" rel="noreferrer">
            View transaction {shortAddress(step.txHash)}
          </a>
          <Link href="/customer" className="btn primary">Done</Link>
        </main>
      </>
    );
  }

  // ---------------- Review / sign ----------------
  if (step.kind === "review" || step.kind === "paying") {
    const { invoice, payment } = step.challenge;
    const fee = (Number(invoice.total) * invoice.merchantFeePercentage) / 100;
    const balanceOf = (a: string) => w.balances?.find((b) => b.address?.toLowerCase() === a.toLowerCase())?.raw;
    const selected = payment.options.find((o) => o.asset === asset);
    const short = selected && balanceOf(selected.asset) !== undefined && balanceOf(selected.asset)! < BigInt(selected.amount);

    return (
      <>
        <CustomerHeader title="Confirm payment" />
        <main className="stack">
          <div className="merchant-banner">
            <span className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Store size={14} /> You are paying
            </span>
            <span className="name">{invoice.merchant.name}</span>
            {invoice.merchant.category && <span className="muted" style={{ fontSize: 14 }}>{invoice.merchant.category}</span>}
            <span className="muted" style={{ fontSize: 13 }}>
              <ShieldCheck size={13} style={{ verticalAlign: "-2px" }} /> Verified merchant · wallet {shortAddress(invoice.merchant.wallet)}
            </span>
          </div>

          <div className="lines">
            {invoice.items.map((i, n) => (
              <div className="line" key={n}>
                <span>{i.quantity} × {i.name} <span className="sub">@ {rand(i.unitPrice)}</span></span>
                <span>{rand(i.total)}</span>
              </div>
            ))}
            <div className="line">
              <span className="sub">Service fee ({invoice.merchantFeePercentage}%), paid by merchant</span>
              <span className="sub">{rand(fee)}</span>
            </div>
            <div className="line total"><span>Total</span><span>{rand(invoice.total)}</span></div>
          </div>

          <span className="muted" style={{ fontSize: 13 }}>Pay with</span>
          {payment.options.map((o) => {
            const bal = balanceOf(o.asset);
            return (
              <label className="choice" key={o.asset}>
                <input type="radio" name="asset" checked={asset === o.asset} onChange={() => setAsset(o.asset)} />
                <span className="grow">
                  <strong>{tokenAmount(o.amount, o.symbol)}</strong>
                  <span className="muted" style={{ display: "block", fontSize: 13 }}>
                    {o.symbol === "ZARK" ? "1 ZARK = R1" : `1 ${o.symbol} = R${o.zarPerToken} (demo rate)`}
                    {bal !== undefined && ` · balance ${Number(formatUnits(bal, 6)).toLocaleString("en-ZA", { maximumFractionDigits: 2 })}`}
                  </span>
                </span>
              </label>
            );
          })}

          {!w.address && <div className="alert warn">Connect MetaMask to pay.</div>}
          {short && <div className="alert bad">Not enough {selected!.symbol} in this wallet.</div>}
          {error && <div className="alert bad" role="alert">{error}</div>}

          {w.address ? (
            <button className="btn primary" onClick={pay} disabled={step.kind === "paying" || !asset || !!short}>
              {step.kind === "paying" ? "Confirm in MetaMask…" : `Sign & pay ${rand(invoice.total)}`}
            </button>
          ) : (
            <button className="btn primary" onClick={w.connect} disabled={w.busy}>Connect MetaMask</button>
          )}
          <p className="center-note" style={{ fontSize: 13 }}>
            You sign a one-time authorisation. No gas needed: the network fee is covered for you.
          </p>
          <button className="btn ghost" onClick={() => { setError(null); setStep({ kind: "scan" }); }} disabled={step.kind === "paying"}>
            Cancel
          </button>
        </main>
      </>
    );
  }

  // ---------------- Scan ----------------
  return (
    <>
      <CustomerHeader title="Scan to pay" />
      <main>
        {step.kind === "loading" ? (
          <p className="center-note" style={{ padding: 48 }}>Loading invoice…</p>
        ) : (
          <QrScanner key={scanKey} onResult={load} />
        )}
        <div className="stack">
          {error && <div className="alert bad" role="alert">{error}</div>}
          <form
            className="form-field"
            onSubmit={(e) => {
              e.preventDefault();
              load(manual);
            }}
          >
            <label htmlFor="link">Or paste the payment link</label>
            <input id="link" className="text-input" placeholder={`${PAY_PREFIX}…`} value={manual} onChange={(e) => setManual(e.target.value)} />
            <button className="btn ghost" type="submit" disabled={!manual.trim()}>Open</button>
          </form>
        </div>
      </main>
    </>
  );
}
