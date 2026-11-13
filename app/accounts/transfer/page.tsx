"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ChevronDown, CircleCheck } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { loadAccounts, transferable, zark, type BusinessAccount } from "@/lib/accounts";
import { EXPLORER_TX_URL } from "@/lib/config";
import { connectWallet, hasMetaMask, sendToken, shortAddress } from "@/lib/wallet";

type Step = "form" | "confirm" | "sending" | "done";

function AccountSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: BusinessAccount[];
  onChange: (id: string) => void;
}) {
  const selected = options.find((a) => a.id === value);
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {/* Dropdown whenever there's a choice; a fixed card when only one option remains */}
      {options.length > 1 ? (
        <div className="select-wrap">
          <select id={id} className="text-input" style={{ appearance: "none" }} value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {zark(a.balance)}
              </option>
            ))}
          </select>
          <ChevronDown size={20} style={{ position: "absolute", right: 14, top: 15, pointerEvents: "none", color: "var(--muted)" }} />
        </div>
      ) : (
        <div className="choice" id={id}>
          <span className="grow"><strong>{selected?.name}</strong></span>
          <span>{selected && zark(selected.balance)}</span>
        </div>
      )}
      {selected?.walletAddress && <span className="muted" style={{ fontSize: 13 }}>Wallet {shortAddress(selected.walletAddress)}</span>}
    </div>
  );
}

export default function TransferBetweenAccounts() {
  const [accounts, setAccounts] = useState<BusinessAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts()
      .then((r) => {
        // Only the merchant's own verified accounts can send or receive
        const list = transferable(r.accounts);
        setAccounts(list);
        if (list[0]) setFromId(list[0].id);
        if (list[1]) setToId(list[1].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your accounts"));
  }, []);

  const from = accounts?.find((a) => a.id === fromId);
  const to = accounts?.find((a) => a.id === toId);
  const toOptions = useMemo(() => accounts?.filter((a) => a.id !== fromId) ?? [], [accounts, fromId]);

  function changeFrom(id: string) {
    setFromId(id);
    if (id === toId) setToId(accounts?.find((a) => a.id !== id)?.id ?? "");
  }

  const amountOk = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0;
  const tooMuch = !!from && amountOk && Number(amount) > Number(from.balance);

  async function confirm() {
    if (!from?.walletAddress || !to?.walletAddress) return;
    setStep("sending");
    setError(null);
    try {
      // MetaMask must have the "from" account's wallet selected
      await connectWallet();
      const hash = await sendToken(from.walletAddress as `0x${string}`, "ZARK", to.walletAddress as `0x${string}`, amount);
      setTxHash(hash);
      setStep("done");
    } catch (err: any) {
      setError(err?.code === 4001 ? "You cancelled the transfer in MetaMask." : err?.shortMessage || err?.message || "Transfer failed");
      setStep("confirm");
    }
  }

  if (step === "done" && from && to) {
    return (
      <>
        <PageHeader title="Transfer complete" hideBalance />
        <main className="stack">
          <div className="receipt-icon"><CircleCheck size={40} /></div>
          <h2 style={{ textAlign: "center", fontSize: 22 }}>{zark(amount)} moved</h2>
          <div className="lines">
            <div className="line"><span className="sub">From</span><span>{from.name}</span></div>
            <div className="line"><span className="sub">To</span><span>{to.name}</span></div>
          </div>
          {txHash && <a className="btn ghost" href={`${EXPLORER_TX_URL}${txHash}`} target="_blank" rel="noreferrer">View on Etherscan</a>}
          <Link href="/accounts" className="btn primary">Back to accounts</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Transfer between accounts" hideBalance />
      <main className="stack">
        {!accounts && !error && <p className="center-note">Loading accounts…</p>}
        {accounts && accounts.length < 2 && (
          <div className="alert warn">
            You need at least two verified accounts to transfer. <Link href="/accounts" className="link-btn">Back to accounts</Link>
          </div>
        )}

        {accounts && accounts.length >= 2 && step === "form" && (
          <>
            <AccountSelect id="from" label="From" value={fromId} options={accounts} onChange={changeFrom} />
            <ArrowDown size={20} color="var(--muted)" style={{ alignSelf: "center" }} />
            <AccountSelect id="to" label="To" value={toId} options={toOptions} onChange={setToId} />

            <div className="form-field">
              <label htmlFor="amount">Amount (ZARK)</label>
              <input id="amount" className="input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
              {tooMuch && <span style={{ color: "var(--bad)", fontSize: 13 }}>More than the {zark(from!.balance)} available.</span>}
            </div>

            <button className="btn primary" disabled={!amountOk || tooMuch || !to} onClick={() => setStep("confirm")}>Continue</button>
          </>
        )}

        {(step === "confirm" || step === "sending") && from && to && (
          <>
            <div className="lines">
              <div className="line"><span className="sub">From</span><span>{from.name} · {shortAddress(from.walletAddress)}</span></div>
              <div className="line"><span className="sub">To</span><span>{to.name} · {shortAddress(to.walletAddress)}</span></div>
              <div className="line total"><span>Amount</span><span>{zark(amount)}</span></div>
            </div>
            <div className="alert warn">
              In MetaMask, select the <strong>{from.name}</strong> wallet ({shortAddress(from.walletAddress)}). It pays a small
              Sepolia ETH network fee.
            </div>
            {hasMetaMask() ? (
              <button className="btn primary" onClick={confirm} disabled={step === "sending"}>
                {step === "sending" ? "Confirm in MetaMask…" : "Confirm transfer"}
              </button>
            ) : (
              <a className="btn outline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Install MetaMask</a>
            )}
            <button className="btn ghost" onClick={() => setStep("form")} disabled={step === "sending"}>Back</button>
          </>
        )}

        {error && <div className="alert bad" role="alert">{error}</div>}
      </main>
    </>
  );
}
