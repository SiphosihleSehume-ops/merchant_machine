"use client";

import { useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { CircleCheck, ShieldCheck, Store } from "lucide-react";
import CustomerHeader from "@/components/CustomerHeader";
import QrScanner from "@/components/QrScanner";
import { api } from "@/lib/api";
import { API_URL, EXPLORER_TX_URL } from "@/lib/config";
import { useWallet } from "@/lib/useWallet";
import { sendTokenExact, shortAddress } from "@/lib/wallet";

/** Receipt for an invoice, from GET /x402/invoice/:id (all amounts set by the server). */
type Receipt = {
  invoiceId: string;
  merchant: { name: string; category: string | null; wallet: `0x${string}` };
  items: { name: string; quantity: number; unitPrice: string; total: string }[];
  subtotal: string;
  total: string;
  currency: string;
  expiresAt: string;
  pay: { symbol: "ZARK"; token: `0x${string}`; amountAtomic: string; decimals: number; chainId: number };
};

type Step =
  | { kind: "scan" }
  | { kind: "loading" }
  | { kind: "review"; receipt: Receipt }
  | { kind: "paying"; receipt: Receipt; note: string }
  | { kind: "done"; receipt: Receipt; txHash: string };

const PAY_PREFIX = `${API_URL}/x402/pay/`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only accept our own invoice links: a QR sticker pointing elsewhere is rejected. */
function invoiceIdFrom(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith(PAY_PREFIX)) return null;
  const id = t.slice(PAY_PREFIX.length).split(/[?#/]/)[0];
  return UUID.test(id) ? id : null;
}

const zark = (v: string | number) =>
  `ZARK ${Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Pay() {
  const w = useWallet();
  const [step, setStep] = useState<Step>({ kind: "scan" });
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [scanKey, setScanKey] = useState(0); // remount scanner to scan again

  async function load(text: string) {
    setError(null);
    const id = invoiceIdFrom(text);
    if (!id) {
      setError("That isn't a Merchant Machine payment code. Only pay codes shown in the merchant's app.");
      setStep({ kind: "scan" });
      setScanKey((k) => k + 1);
      return;
    }
    setStep({ kind: "loading" });
    try {
      setStep({ kind: "review", receipt: await api<Receipt>(`/x402/invoice/${id}`, { auth: false }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the invoice");
      setStep({ kind: "scan" });
      setScanKey((k) => k + 1);
    }
  }

  async function confirm() {
    if (step.kind !== "review" || !w.address) return;
    const receipt = step.receipt;
    setError(null);
    try {
      setStep({ kind: "paying", receipt, note: "Confirm the payment in MetaMask…" });
      // Exactly the invoice total, straight to the merchant's registered wallet
      const txHash = await sendTokenExact(w.address, receipt.pay.token, receipt.merchant.wallet, BigInt(receipt.pay.amountAtomic));
      setStep({ kind: "paying", receipt, note: "Payment sent. Verifying on the blockchain…" });
      await api(`/x402/invoice/${receipt.invoiceId}/transfer`, { body: { txHash }, auth: false });
      setStep({ kind: "done", receipt, txHash });
      w.reloadBalances();
    } catch (err: any) {
      setError(err?.code === 4001 ? "You cancelled the payment in MetaMask." : err?.shortMessage || err?.message || "Payment failed");
      setStep({ kind: "review", receipt });
    }
  }

  const ItemLines = ({ r }: { r: Receipt }) => (
    <div className="lines">
      {r.items.map((i, n) => (
        <div className="line" key={n}>
          <span>
            {i.quantity} × {i.name}
            <span className="sub" style={{ display: "block" }}>@ {zark(i.unitPrice)}</span>
          </span>
          <span>{zark(i.total)}</span>
        </div>
      ))}
    </div>
  );

  // ---------------- Done ----------------
  if (step.kind === "done") {
    const r = step.receipt;
    return (
      <>
        <CustomerHeader title="Payment complete" />
        <main className="stack">
          <div className="receipt-icon"><CircleCheck size={40} /></div>
          <p style={{ textAlign: "center", margin: 0 }}>Paid {r.merchant.name}</p>
          <h2 style={{ textAlign: "center", fontSize: 30, margin: 0 }}>{zark(r.total)}</h2>
          <ItemLines r={r} />
          <a className="btn ghost" href={`${EXPLORER_TX_URL}${step.txHash}`} target="_blank" rel="noreferrer">
            View transaction {shortAddress(step.txHash)}
          </a>
          <Link href="/customer" className="btn primary">Done</Link>
        </main>
      </>
    );
  }

  // ---------------- Receipt + Confirm ----------------
  if (step.kind === "review" || step.kind === "paying") {
    const r = step.receipt;
    const exact = formatUnits(BigInt(r.pay.amountAtomic), r.pay.decimals);
    const bal = w.balances?.find((b) => b.address?.toLowerCase() === r.pay.token.toLowerCase())?.raw;
    const short = bal !== undefined && bal < BigInt(r.pay.amountAtomic);
    const eth = w.balances?.find((b) => b.symbol === "ETH");
    const noGas = !!eth && eth.raw === 0n;

    return (
      <>
        <CustomerHeader title="Confirm payment" />
        <main className="stack">
          <div className="merchant-banner">
            <span className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Store size={14} /> You are paying
            </span>
            <span className="name">{r.merchant.name}</span>
            {r.merchant.category && <span className="muted" style={{ fontSize: 14 }}>{r.merchant.category}</span>}
            <span className="muted" style={{ fontSize: 13 }}>
              <ShieldCheck size={13} style={{ verticalAlign: "-2px" }} /> Registered wallet {shortAddress(r.merchant.wallet)}
            </span>
          </div>

          <ItemLines r={r} />

          <div style={{ textAlign: "center", padding: "6px 0" }}>
            <span className="muted" style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" }}>Total</span>
            <h2 style={{ fontSize: 34, margin: "4px 0 0", letterSpacing: "-0.02em" }}>{zark(r.total)}</h2>
            <span className="muted" style={{ fontSize: 13 }}>Exactly {Number(exact).toLocaleString("en-ZA", { maximumFractionDigits: 6 })} ZARK leaves your wallet</span>
          </div>

          {!w.address && <div className="alert warn">Connect MetaMask to pay.</div>}
          {short && <div className="alert bad">Not enough ZARK in this wallet.</div>}
          {noGas && <div className="alert warn">This wallet has no Sepolia ETH for the network fee.</div>}
          {error && <div className="alert bad" role="alert">{error}</div>}
          {step.kind === "paying" && <div className="alert warn">{step.note}</div>}

          {w.address ? (
            <button className="btn primary" onClick={confirm} disabled={step.kind === "paying" || short}>
              {step.kind === "paying" ? "Processing…" : "Confirm"}
            </button>
          ) : (
            <button className="btn primary" onClick={w.connect} disabled={w.busy}>Connect MetaMask</button>
          )}
          <button
            className="btn ghost"
            onClick={() => {
              setError(null);
              setStep({ kind: "scan" });
              setScanKey((k) => k + 1);
            }}
            disabled={step.kind === "paying"}
          >
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
          <p className="center-note" style={{ padding: 48 }}>Loading receipt…</p>
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
