"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, CircleX, FileText, ShieldCheck } from "lucide-react";
import Logo from "@/components/Logo";
import { api, apiBlob } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";

type Review = {
  id: string;
  status: "PENDING" | "APPROVING" | "APPROVED" | "REJECTED";
  walletAddress: string;
  address: { streetAddress: string; suburb: string | null; city: string; province: string; postalCode: string; country: string };
  submittedAt: string;
  rejectionReason: string | null;
  explorerUrl: string | null;
  applicant: { email: string; shopName: string | null };
};

function ReviewPage() {
  const token = useSearchParams().get("token") ?? "";
  const base = `/kyc-review/${encodeURIComponent(token)}`;
  const [app, setApp] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(token ? null : "This review link is missing its token.");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [opened, setOpened] = useState({ id: false, proof: false });

  const load = useCallback(async () => {
    try {
      setApp(await api<Review>(base, { auth: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the application");
    }
  }, [base]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  async function openDoc(kind: "id" | "proof") {
    const tab = window.open("", "_blank"); // open synchronously (popup blockers)
    try {
      const url = URL.createObjectURL(await apiBlob(`${base}/documents/${kind}`));
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setOpened((o) => ({ ...o, [kind]: true }));
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "Could not open document");
    }
  }

  async function decide(kind: "approve" | "reject") {
    setBusy(kind);
    setError(null);
    try {
      await api(`${base}/${kind}`, { method: "POST", body: kind === "reject" ? { reason: reason.trim() } : undefined, auth: false });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${kind}`);
    } finally {
      setBusy(null);
    }
  }

  const a = app?.address;
  const checkedBoth = opened.id && opened.proof;

  return (
    <main className="auth" style={{ gap: 16 }}>
      <div className="auth-brand">
        <Logo size={44} />
        <h1>KYC review</h1>
        <p>Check the documents, then approve or reject.</p>
      </div>

      {error && <div className="alert bad" role="alert">{error}</div>}
      {!app && !error && <p className="center-note">Loading application…</p>}

      {app && a && (
        <>
          <div className="lines">
            <div className="line"><span className="sub">Applicant</span><span>{app.applicant.email}</span></div>
            <div className="line"><span className="sub">Business</span><span>{app.applicant.shopName ?? "-"}</span></div>
            <div className="line"><span className="sub">Wallet</span><span title={app.walletAddress}>{shortAddress(app.walletAddress)}</span></div>
            <div className="line">
              <span className="sub">Address</span>
              <span style={{ textAlign: "right" }}>{a.streetAddress}{a.suburb ? `, ${a.suburb}` : ""}<br />{a.city}, {a.province} {a.postalCode}</span>
            </div>
            <div className="line"><span className="sub">Submitted</span><span>{new Date(app.submittedAt).toLocaleString("en-ZA")}</span></div>
          </div>

          <div className="btn-row" style={{ padding: 0 }}>
            <button className="btn ghost" onClick={() => openDoc("id")}>
              <FileText size={16} /> ID {opened.id && "✓"}
            </button>
            <button className="btn ghost" onClick={() => openDoc("proof")}>
              <FileText size={16} /> Proof {opened.proof && "✓"}
            </button>
          </div>
          <span className="muted" style={{ fontSize: 13, textAlign: "center" }}>
            The same documents are attached to the email.
          </span>

          {app.status === "APPROVED" && (
            <div className="alert ok" style={{ display: "flex", gap: 10 }}>
              <BadgeCheck size={20} style={{ flex: "none" }} />
              <span>
                Approved and recorded on-chain. The applicant has been emailed.{" "}
                {app.explorerUrl && <a className="link-btn" href={app.explorerUrl} target="_blank" rel="noreferrer">View tx</a>}
              </span>
            </div>
          )}
          {app.status === "REJECTED" && (
            <div className="alert bad" style={{ display: "flex", gap: 10 }}>
              <CircleX size={20} style={{ flex: "none" }} />
              <span>Rejected: {app.rejectionReason}. The applicant has been emailed.</span>
            </div>
          )}
          {app.status === "APPROVING" && <div className="alert warn">Recording approval on the blockchain…</div>}

          {app.status === "PENDING" && !rejecting && (
            <>
              {!checkedBoth && <span className="muted" style={{ fontSize: 13, textAlign: "center" }}>Open both documents before deciding.</span>}
              <button className="btn primary" onClick={() => decide("approve")} disabled={!!busy || !checkedBoth}>
                <ShieldCheck size={18} /> {busy === "approve" ? "Recording on-chain…" : "Approve & verify"}
              </button>
              <button className="btn outline" onClick={() => setRejecting(true)} disabled={!!busy}>Reject</button>
            </>
          )}

          {app.status === "PENDING" && rejecting && (
            <>
              <div className="form-field">
                <label htmlFor="reason">Reason (emailed to the applicant)</label>
                <textarea id="reason" className="text-input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <button className="btn primary" onClick={() => decide("reject")} disabled={reason.trim().length < 3 || !!busy}>
                {busy === "reject" ? "Rejecting…" : "Confirm reject"}
              </button>
              <button className="btn ghost" onClick={() => setRejecting(false)} disabled={!!busy}>Cancel</button>
            </>
          )}
        </>
      )}
    </main>
  );
}

export default function KycReviewPage() {
  return (
    <Suspense fallback={<main className="auth" />}>
      <ReviewPage />
    </Suspense>
  );
}
