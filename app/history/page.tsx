"use client";

import { ChevronDown, CreditCard } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { accounts, formatRand, transactions } from "@/lib/data";

export default function History() {
  return (
    <>
      <PageHeader title="Transaction history" />
      <main>
        <div className="field">
          <label htmlFor="acct">From account</label>
          <div className="select-wrap">
            <select id="acct" defaultValue={accounts[0].id}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <ChevronDown size={22} />
          </div>
        </div>
        {transactions.map((t) => (
          <div key={t.id} className="txn" data-ok={t.ok}>
            <span className="txn-icon"><CreditCard size={28} strokeWidth={1.7} /></span>
            <span>
              <span className="caption" style={{ display: "block" }}>Payment from</span>
              <span className="title" style={{ display: "block" }}>{t.label}</span>
              <span className="date">{t.date}</span>
            </span>
            <span className="amount">{formatRand(t.amount)}</span>
          </div>
        ))}
      </main>
    </>
  );
}
