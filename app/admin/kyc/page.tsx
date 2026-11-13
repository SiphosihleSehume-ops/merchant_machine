"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { api, apiBlob } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";

type Row = {
  id: string;
  email: string;
  role: "MERCHANT" | "CUSTOMER";
  status: "PENDING" | "APPROVING" | "APPROVED" | "REJECTED";
  walletAddress: string;
  address: { streetAddress: string; suburb: string | null; city: string; province: string; postalCode: string; country: string };
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  explorerUrl: string | null;
};

const FILTERS = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;
const when = (d: string) => new Date(d).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function KycReviews() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("PENDING");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api<Row[]>(`/admin/kyc?status=${filter}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load applications");
    }
  }, [filter]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  return (
    <>
      <PageHeader title="KYC reviews" hideBalance />
      <main className="stack">
        <div className="seg" role="group" aria-label="Filter" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} style={{ fontSize: 13 }}>
              {f[0] + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        {error && <div className="alert bad" role="alert">{error}</div>}
        {rows === null && !error && <p className="center-note">Loading…</p>}
        {rows?.length === 0 && (
          <EmptyState title="Nothing here" icon={<ShieldCheck size={40} />}>No {filter.toLowerCase()} applications.</EmptyState>
        )}
        {rows?.map((r) => <ApplicationCard key={r.id} row={r} onChanged={load} />)}
      </main>
    </>
  );
}

function ApplicationCard({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const a = row.address;

  async function openDoc(kind: "id" | "proof") {
    setError(null);
    // Open the tab synchronously (popup blockers), then fill it with the decrypted file
    const tab = window.open("", "_blank");
    try {
      const blob = await apiBlob(`/admin/kyc/${row.id}/documents/${kind}`);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "Could not open document");
    }
  }

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      await api(`/admin/kyc/${row.id}/approve`, { method: "POST" });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    setError(null);
    try {
      await api(`/admin/kyc/${row.id}/reject`, { body: { reason: reason.trim() } });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rejection failed");
      setBusy(null);
    }
  }

  return (
    <div className="pay-item">
      <div className="top">
        <div>
          <div className="merchant">{row.email}</div>
          <div className="meta">{row.role === "MERCHANT" ? "Merchant" : "Customer"} · submitted {when(row.submittedAt)}</div>
        </div>
        <span className="badge" data-status={row.status === "APPROVED" ? "SETTLED" : row.status === "REJECTED" ? "FAILED" : "PENDING"}>
          {row.status}
        </span>
      </div>

      <div className="meta" style={{ lineHeight: 1.5 }}>
        Wallet <strong style={{ color: "var(--text)" }} title={row.walletAddress}>{shortAddress(row.walletAddress)}</strong><br />
        {a.streetAddress}{a.suburb ? `, ${a.suburb}` : ""}, {a.city}, {a.province} {a.postalCode}
      </div>

      <div className="btn-row" style={{ padding: 0 }}>
        <button className="btn ghost" onClick={() => openDoc("id")}>ID document</button>
        <button className="btn ghost" onClick={() => openDoc("proof")}>Proof of address</button>
      </div>

      {row.status === "REJECTED" && <div className="meta">Rejected by {row.reviewedBy}: {row.rejectionReason}</div>}
      {row.status === "APPROVED" && (
        <div className="meta">
          Approved by {row.reviewedBy}
          {row.explorerUrl && <> · <a className="link-btn" href={row.explorerUrl} target="_blank" rel="noreferrer">On-chain tx</a></>}
        </div>
      )}

      {row.status === "PENDING" && !rejecting && (
        <div className="btn-row" style={{ padding: 0 }}>
          <button className="btn primary" onClick={approve} disabled={!!busy}>
            {busy === "approve" ? "Recording on-chain…" : "Approve"}
          </button>
          <button className="btn outline" onClick={() => setRejecting(true)} disabled={!!busy}>Reject</button>
        </div>
      )}

      {row.status === "PENDING" && rejecting && (
        <>
          <div className="form-field">
            <label htmlFor={`reason-${row.id}`}>Reason (shown to the applicant)</label>
            <textarea id={`reason-${row.id}`} className="text-input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="btn-row" style={{ padding: 0 }}>
            <button className="btn primary" onClick={reject} disabled={reason.trim().length < 3 || !!busy}>
              {busy === "reject" ? "Rejecting…" : "Confirm reject"}
            </button>
            <button className="btn ghost" onClick={() => setRejecting(false)} disabled={!!busy}>Cancel</button>
          </div>
        </>
      )}

      {error && <div className="alert bad" role="alert">{error}</div>}
    </div>
  );
}
