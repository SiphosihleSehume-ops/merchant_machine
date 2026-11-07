"use client";

import Link from "next/link";
import { Printer, MessageCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import PageHeader from "@/components/PageHeader";
import { merchant } from "@/lib/data";

export default function ShareCode() {
  const text = `Pay ${merchant.name} using shop code ${merchant.shopCode}`;
  return (
    <>
      <PageHeader
        title="Share my code"
        hideBalance
        action={
          <button className="icon-btn filled" aria-label="Print" onClick={() => window.print()}>
            <Printer size={18} />
          </button>
        }
      />
      <main>
        <section className="share">
          <h2 className="shop">{merchant.name}</h2>
          <div className="qr">
            <QRCodeSVG value={merchant.shopCode} size={220} level="M" />
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="code-label">Shop code</div>
            <div className="code">
              <MessageCircle size={26} />
              {merchant.shopCode}
            </div>
          </div>
          <div className="actions">
            <a
              className="btn primary"
              href={`https://wa.me/?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noreferrer"
            >
              Share with WhatsApp
            </a>
            <Link href="/request-payment" className="btn outline">
              Request a payment
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
