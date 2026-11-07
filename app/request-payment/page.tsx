"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import PageHeader from "@/components/PageHeader";
import { merchant } from "@/lib/data";

export default function RequestPayment() {
  const [amount, setAmount] = useState("");
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;
  return (
    <>
      <PageHeader title="Request a payment" hideBalance />
      <main className="share">
        <div style={{ width: "100%" }}>
          <label htmlFor="amount" className="code-label" style={{ display: "block", marginBottom: 8 }}>
            Amount (ZAR)
          </label>
          <input
            id="amount"
            className="input"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
        {valid ? (
          <>
            <div className="qr">
              <QRCodeSVG value={`${merchant.shopCode}?amount=${value.toFixed(2)}`} size={220} level="M" />
            </div>
            <p className="center-note">Ask the customer to scan this code to pay R{value.toFixed(2)}.</p>
          </>
        ) : (
          <p className="center-note">Enter an amount to generate a payment code.</p>
        )}
      </main>
    </>
  );
}
