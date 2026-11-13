"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, ChevronDown, Clock, FileText, ShieldCheck, XCircle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api, apiForm } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";

type Application = {
  id: string;
  status: "PENDING" | "APPROVING" | "APPROVED" | "REJECTED";
  walletAddress: string;
  address: { streetAddress: string; suburb: string | null; city: string; province: string; postalCode: string; country: string };
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  explorerUrl: string | null;
};

type KycState = {
  wallet: string | null;
  application: Application | null;
  onChain: { verified: boolean; verifiedAt: string | null; contract: string } | null;
  provinces: string[];
};

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png";
const when = (d: string) => new Date(d).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function MyAddress() {
  const [state, setState] = useState<KycState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resubmit, setResubmit] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<KycState>("/kyc/me"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your KYC status");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const app = state?.application;
  const showForm = state && (!app || (app.status === "REJECTED" && resubmit));

  return (
    <>
      <PageHeader title="My address" />
      <main className="stack">
        <p className="muted" style={{ fontSize: 14 }}>
          Verify your identity (KYC). Your documents are encrypted and only seen by our verifier. Only your
          wallet&apos;s <em>verified</em> status is recorded on the blockchain, never your name, ID or address.
        </p>

        {!state && !error && <p className="center-note">Loading…</p>}
        {error && <div className="alert bad" role="alert">{error}</div>}

        {state && app && !showForm && <StatusCard state={state} onResubmit={() => setResubmit(true)} />}

        {state && showForm && (
          state.wallet ? (
            <KycForm
              provinces={state.provinces}
              wallet={state.wallet}
              onDone={() => {
                setResubmit(false);
                load();
              }}
            />
          ) : (
            <div className="alert warn">
              Connect your payout wallet first. It&apos;s the wallet that gets verified.{" "}
              <Link href="/profile/shop" className="link-btn">Go to My shop</Link>
            </div>
          )
        )}
      </main>
    </>
  );
}

function StatusCard({ state, onResubmit }: { state: KycState; onResubmit: () => void }) {
  const app = state.application!;
  const icon =
    app.status === "APPROVED" ? <BadgeCheck size={30} /> : app.status === "REJECTED" ? <XCircle size={30} /> : <Clock size={30} />;
  const title =
    app.status === "APPROVED" ? "Verified" : app.status === "REJECTED" ? "Not approved" : "Under review";
  const a = app.address;

  return (
    <div className="wallet-card" style={{ margin: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="receipt-icon"
          style={{
            width: 52,
            height: 52,
            margin: 0,
            ...(app.status === "REJECTED" ? { background: "rgba(255,92,92,.12)", color: "var(--bad)" } : {}),
            ...(app.status === "PENDING" || app.status === "APPROVING" ? { background: "var(--accent-soft)", color: "var(--accent)" } : {}),
          }}
        >
          {icon}
        </span>
        <div>
          <strong style={{ fontSize: 18, display: "block" }}>{title}</strong>
          <span className="muted" style={{ fontSize: 13 }}>Submitted {when(app.submittedAt)}</span>
        </div>
      </div>

      <div className="lines" style={{ background: "var(--bg)" }}>
        <div className="line"><span className="sub">Wallet</span><span>{shortAddress(app.walletAddress)}</span></div>
        <div className="line">
          <span className="sub">Address</span>
          <span style={{ textAlign: "right" }}>
            {a.streetAddress}{a.suburb ? `, ${a.suburb}` : ""}<br />{a.city}, {a.province} {a.postalCode}
          </span>
        </div>
        <div className="line">
          <span className="sub">On-chain</span>
          <span>
            {state.onChain?.verified ? (
              <span className="pill ok"><ShieldCheck size={13} /> KYC approved</span>
            ) : (
              <span className="pill">Not recorded</span>
            )}
          </span>
        </div>
      </div>

      {app.status === "PENDING" && <p className="muted" style={{ fontSize: 14 }}>A verifier will review your documents. Check back soon.</p>}
      {app.status === "APPROVING" && <p className="muted" style={{ fontSize: 14 }}>Approved. Recording on the blockchain…</p>}
      {app.status === "REJECTED" && (
        <>
          <div className="alert bad"><strong>Reason:</strong> {app.rejectionReason}</div>
          <button className="btn primary" onClick={onResubmit}>Submit again</button>
        </>
      )}
      {app.explorerUrl && (
        <a className="btn ghost" href={app.explorerUrl} target="_blank" rel="noreferrer">View verification on Etherscan</a>
      )}
    </div>
  );
}

function FilePicker({ id, label, hint, file, onChange }: { id: string; label: string; hint: string; file: File | null; onChange: (f: File | null) => void }) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <label htmlFor={id} className="choice" style={{ cursor: "pointer" }}>
        <FileText size={22} color="var(--accent)" />
        <span className="grow">
          <strong style={{ display: "block", fontSize: 15 }}>{file ? file.name : "Choose file"}</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : hint}
          </span>
        </span>
      </label>
      <input
        id={id}
        type="file"
        accept={ACCEPT}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function KycForm({ provinces, wallet, onDone }: { provinces: string[]; wallet: string; onDone: () => void }) {
  const [street, setStreet] = useState("");
  const [suburb, setSuburb] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postal, setPostal] = useState("");
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(set: (f: File | null) => void) {
    return (f: File | null) => {
      setError(null);
      if (f && f.size > MAX_BYTES) {
        setError(`${f.name} is larger than 5 MB.`);
        return;
      }
      if (f && !ACCEPT.split(",").includes(f.type)) {
        setError(`${f.name} must be a PDF, JPG or PNG.`);
        return;
      }
      set(f);
    };
  }

  const valid =
    street.trim().length >= 3 && city.trim().length >= 2 && !!province && /^\d{4}$/.test(postal) && !!idDoc && !!proof && consent;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("streetAddress", street.trim());
      form.append("suburb", suburb.trim());
      form.append("city", city.trim());
      form.append("province", province);
      form.append("postalCode", postal);
      form.append("country", "South Africa");
      form.append("popiaConsent", String(consent));
      form.append("idDocument", idDoc!);
      form.append("proofOfAddress", proof!);
      await apiForm("/kyc", form);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your documents");
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ padding: 0 }} onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="street">Street address</label>
        <input id="street" className="text-input" autoComplete="address-line1" required value={street} onChange={(e) => setStreet(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="suburb">Suburb (optional)</label>
        <input id="suburb" className="text-input" autoComplete="address-line2" value={suburb} onChange={(e) => setSuburb(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 12 }}>
        <div className="form-field">
          <label htmlFor="city">City / town</label>
          <input id="city" className="text-input" autoComplete="address-level2" required value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="postal">Postal code</label>
          <input
            id="postal"
            className="text-input"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={4}
            required
            value={postal}
            onChange={(e) => setPostal(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="province">Province</label>
        <div className="select-wrap">
          <select id="province" className="text-input" style={{ appearance: "none" }} required value={province} onChange={(e) => setProvince(e.target.value)}>
            <option value="" disabled>Choose a province</option>
            {provinces.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <ChevronDown size={20} style={{ position: "absolute", right: 14, top: 15, pointerEvents: "none", color: "var(--muted)" }} />
        </div>
      </div>

      <FilePicker id="idDoc" label="ID document" hint="Green ID book, smart ID card or passport · PDF/JPG/PNG, max 5 MB" file={idDoc} onChange={pick(setIdDoc)} />
      <FilePicker id="proof" label="Proof of address" hint="Utility bill or bank statement, not older than 3 months" file={proof} onChange={pick(setProof)} />

      <div className="lines">
        <div className="line"><span className="sub">Wallet to verify</span><span>{shortAddress(wallet)}</span></div>
      </div>

      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        I consent to Merchant Machine processing these documents to verify my identity (POPIA). They are stored
        encrypted, only reviewed by a verifier, and never put on the blockchain.
      </label>

      {error && <div className="alert bad" role="alert">{error}</div>}
      <button className="btn primary" type="submit" disabled={!valid || busy}>
        {busy ? "Uploading…" : "Submit for verification"}
      </button>
    </form>
  );
}
