"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, BadgeCheck, ChevronRight, Clock, Store } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { loadAccounts, transferable, zark, type AccountsResponse } from "@/lib/accounts";
import { shortAddress } from "@/lib/wallet";

export default function Accounts() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your accounts"));
  }, []);

  const canTransfer = !!data && transferable(data.accounts).length >= 2;

  return (
    <>
      <PageHeader title="Accounts" />
      <main className="stack" style={{ gap: 14 }}>
        {canTransfer ? (
          <Link href="/accounts/transfer" className="card-link">
            <span className="avatar round accent"><ArrowLeftRight size={22} /></span>
            <span className="grow">Transfer between accounts</span>
            <ChevronRight size={20} />
          </Link>
        ) : (
          data && (
            <div className="card-link" aria-disabled="true" style={{ opacity: 0.6 }}>
              <span className="avatar round accent"><ArrowLeftRight size={22} /></span>
              <span className="grow">
                Transfer between accounts
                <span className="muted" style={{ display: "block", fontSize: 13, fontWeight: 400 }}>
                  Needs at least two verified accounts
                </span>
              </span>
            </div>
          )
        )}

        {!data && !error && <p className="center-note">Loading accounts…</p>}
        {error && <div className="alert bad" role="alert">{error}</div>}

        {data?.accounts.map((a, i) => (
          <div key={a.id} className="account" style={{ margin: 0 }}>
            <span className="mark"><Store size={26} /></span>
            <span className="meta" style={{ flex: 1, minWidth: 0 }}>
              <span className="sub" style={{ display: "block" }}>
                {a.kind === "MAIN" ? "Main account" : `Account ${i + 1}`}
                {a.category ? ` · ${a.category}` : ""}
              </span>
              <span className="name" style={{ display: "block" }}>{a.name}</span>
              <span className="sub" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                {a.walletAddress ? shortAddress(a.walletAddress) : "No wallet yet"}
                {a.verified ? (
                  <span className="pill ok"><BadgeCheck size={12} /> Verified</span>
                ) : (
                  <span className="pill"><Clock size={12} /> Not verified</span>
                )}
              </span>
            </span>
            <span style={{ paddingRight: 14, fontWeight: 700, whiteSpace: "nowrap" }}>{zark(a.balance)}</span>
          </div>
        ))}

        {data && !data.kycApproved && (
          <div className="alert warn">
            Get your KYC approved first. Business accounts reuse your verified identity.{" "}
            <Link href="/profile/address" className="link-btn">Go to My address</Link>
          </div>
        )}

        {data?.kycApproved ? (
          <Link href="/accounts/new" className="btn primary" style={{ marginTop: 10 }}>Add account</Link>
        ) : (
          <button className="btn primary" style={{ marginTop: 10 }} disabled>Add account</button>
        )}
      </main>
    </>
  );
}
