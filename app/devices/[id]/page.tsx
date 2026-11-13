"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BadgeCheck, CircleCheck, Search, Store, Tablet } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { AUTH_DISABLED, EXPLORER_TX_URL, TOKENS, type TokenSymbol } from "@/lib/config";
import { connectWallet, getBalances, hasMetaMask, sendToken, shortAddress, type Balance } from "@/lib/wallet";

type Device = { id: string; name: string; serial: string };
type Recipient = { merchantId: string; name: string; category: string | null; walletAddress: `0x${string}`; verifiedAt: string | null };

export default function DeviceTransfer() {
  const { id } = useParams<{ id: string }>();
  const [device, setDevice] = useState<Device | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipient[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [recipient, setRecipient] = useState<Recipient | null>(null);

  const [from, setFrom] = useState<`0x${string}` | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [symbol, setSymbol] = useState<TokenSymbol>("ZARK");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ hash: string; amount: string; symbol: string; to: Recipient } | null>(null);

  useEffect(() => {
    if (AUTH_DISABLED) return;
    api<Device>(`/devices/${id}`)
      .then(setDevice)
      .catch((err) => setError(err instanceof Error ? err.message : "Device not found"));
  }, [id]);

  // Debounced search of KYC-verified shops
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || recipient) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await api<Recipient[]>(`/devices/${id}/recipients?q=${encodeURIComponent(q)}`));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, id, recipient]);

  async function connect() {
    setError(null);
    try {
      const a = await connectWallet();
      setFrom(a);
      setBalances(await getBalances(a));
    } catch (err: any) {
      setError(err?.code === 4001 ? "Request cancelled in MetaMask." : err?.message || "Could not connect MetaMask");
    }
  }

  async function send() {
    if (!from || !recipient) return;
    setSending(true);
    setError(null);
    try {
      const hash = await sendToken(from, symbol, recipient.walletAddress, amount);
      setSent({ hash, amount, symbol, to: recipient });
      setBalances(await getBalances(from));
    } catch (err: any) {
      setError(err?.code === 4001 ? "You cancelled the transfer in MetaMask." : err?.shortMessage || err?.message || "Transfer failed");
    } finally {
      setSending(false);
    }
  }

  const balance = balances?.find((b) => b.symbol === symbol);
  const eth = balances?.find((b) => b.symbol === "ETH");
  const amountNum = Number(amount);
  const amountOk = /^\d+(\.\d{1,6})?$/.test(amount) && amountNum > 0;
  const tooMuch = !!balance && amountOk && amountNum > Number(balance.amount);
  const noGas = !!eth && eth.raw === 0n;

  if (AUTH_DISABLED) {
    return (
      <>
        <PageHeader title="Send crypto" />
        <main className="stack">
          <div className="alert warn">Sign in with a registered account to use devices.</div>
        </main>
      </>
    );
  }

  if (sent) {
    return (
      <>
        <PageHeader title="Transfer sent" hideBalance />
        <main className="stack">
          <div className="receipt-icon"><CircleCheck size={40} /></div>
          <h2 style={{ textAlign: "center", fontSize: 22 }}>{sent.amount} {sent.symbol} sent</h2>
          <div className="lines">
            <div className="line"><span className="sub">To</span><span>{sent.to.name}</span></div>
            <div className="line"><span className="sub">Wallet</span><span>{shortAddress(sent.to.walletAddress)}</span></div>
            <div className="line"><span className="sub">Device</span><span>{device?.name}</span></div>
          </div>
          <a className="btn ghost" href={`${EXPLORER_TX_URL}${sent.hash}`} target="_blank" rel="noreferrer">View on Etherscan</a>
          <button className="btn primary" onClick={() => { setSent(null); setAmount(""); setRecipient(null); setQuery(""); }}>
            New transfer
          </button>
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Send crypto" hideBalance />
      <main className="stack">
        {device && (
          <div className="merchant-banner" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Tablet size={26} color="var(--accent)" />
            <span>
              <strong style={{ display: "block" }}>{device.name}</strong>
              <span className="muted" style={{ fontSize: 13 }}>Serial {device.serial}</span>
            </span>
          </div>
        )}

        {/* 1. Recipient */}
        <div className="form-field">
          <label htmlFor="search">1. Send to a verified shop</label>
          {recipient ? (
            <div className="choice" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
              <Store size={22} color="var(--accent)" />
              <span className="grow">
                <strong style={{ display: "block" }}>{recipient.name}</strong>
                <span className="muted" style={{ fontSize: 13 }}>{recipient.walletAddress}</span>
              </span>
              <button type="button" className="link-btn" onClick={() => { setRecipient(null); setQuery(""); }}>Change</button>
            </div>
          ) : (
            <>
              <div style={{ position: "relative" }}>
                <Search size={18} style={{ position: "absolute", left: 14, top: 16, color: "var(--muted)" }} />
                <input
                  id="search"
                  className="text-input"
                  style={{ paddingLeft: 40 }}
                  placeholder="Search shop name"
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <span className="muted" style={{ fontSize: 13 }}>Only shops approved by a KYC verifier appear here.</span>
              {searching && <span className="muted" style={{ fontSize: 13 }}>Searching…</span>}
              {results?.length === 0 && !searching && <span className="muted" style={{ fontSize: 14 }}>No verified shop matches “{query.trim()}”.</span>}
              {results?.map((r) => (
                <button key={r.merchantId} type="button" className="choice" style={{ textAlign: "left", width: "100%" }} onClick={() => setRecipient(r)}>
                  <Store size={22} color="var(--accent)" />
                  <span className="grow">
                    <strong style={{ display: "block" }}>{r.name}</strong>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {r.category ? `${r.category} · ` : ""}{shortAddress(r.walletAddress)}
                    </span>
                  </span>
                  <span className="pill ok"><BadgeCheck size={13} /> KYC</span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* 2. Amount */}
        {recipient && (
          <>
            <div className="form-field">
              <label>2. Token and amount</label>
              <div className="seg" role="group" aria-label="Token" style={{ gridTemplateColumns: `repeat(${TOKENS.length}, 1fr)` }}>
                {TOKENS.map((t) => (
                  <button key={t.symbol} type="button" aria-pressed={symbol === t.symbol} onClick={() => setSymbol(t.symbol)} disabled={!t.address}>
                    {t.symbol}
                  </button>
                ))}
              </div>
              <input
                className="input"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                aria-label="Amount"
              />
              {balance && (
                <span className="muted" style={{ fontSize: 13 }}>
                  Balance: {Number(balance.amount).toLocaleString("en-ZA", { maximumFractionDigits: 2 })} {symbol}
                </span>
              )}
            </div>

            {/* 3. Send */}
            {!from ? (
              hasMetaMask() ? (
                <button className="btn primary" onClick={connect}>Connect MetaMask to send</button>
              ) : (
                <a className="btn outline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask</a>
              )
            ) : (
              <>
                <div className="lines">
                  <div className="line"><span className="sub">From</span><span>{shortAddress(from)}</span></div>
                  <div className="line"><span className="sub">To</span><span>{recipient.name} · {shortAddress(recipient.walletAddress)}</span></div>
                </div>
                {tooMuch && <div className="alert bad">Not enough {symbol} in this wallet.</div>}
                {noGas && <div className="alert warn">This wallet has no Sepolia ETH to pay the network fee.</div>}
                <button className="btn primary" onClick={send} disabled={!amountOk || tooMuch || sending}>
                  {sending ? "Confirm in MetaMask…" : amountOk ? `Send ${amount} ${symbol}` : "Enter an amount"}
                </button>
              </>
            )}
          </>
        )}

        {error && <div className="alert bad" role="alert">{error}</div>}
        <Link href="/devices" className="btn ghost">Back to devices</Link>
      </main>
    </>
  );
}
