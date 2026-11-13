"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Printer, Wallet } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import PageHeader from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useMerchantBalance } from "@/lib/useMerchantBalance";
import { shortAddress } from "@/lib/wallet";

type Shop = { name: string; category: string | null; cryptoWallet: string | null };

/**
 * EIP-681 payment link: wallets that scan it (e.g. MetaMask) open a ZARK transfer to the
 * merchant's registered wallet on the right chain. Falls back to a plain address link.
 */
function paymentUri(wallet: string, chainId: number, zark: string | null) {
  return zark ? `ethereum:${zark}@${chainId}/transfer?address=${wallet}` : `ethereum:${wallet}@${chainId}`;
}

export default function ShareCode() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { data: chain } = useMerchantBalance();

  useEffect(() => {
    api<Shop>("/merchants/me/shop")
      .then(setShop)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your shop"));
  }, []);

  const wallet = shop?.cryptoWallet ?? null;
  const uri = wallet && chain ? paymentUri(wallet, chain.chainId, chain.tokenAddress) : null;
  const shareText = shop && wallet ? `Pay ${shop.name} in ZARK. Wallet: ${wallet} (Sepolia)` : "";

  async function copy() {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the address and copy it manually.");
    }
  }

  return (
    <>
      <PageHeader
        title="Get paid"
        hideBalance
        action={
          <button className="icon-btn filled" aria-label="Print" onClick={() => window.print()} disabled={!uri}>
            <Printer size={18} />
          </button>
        }
      />
      <main>
        <section className="share">
          {!shop && !error && <p className="center-note">Loading your shop…</p>}
          {error && <div className="alert bad" style={{ width: "100%" }}>{error}</div>}

          {shop && !wallet && (
            <>
              <h2 className="shop">{shop.name}</h2>
              <div className="alert warn" style={{ width: "100%" }}>
                You haven&apos;t registered a wallet yet. Connect one in My shop so customers can pay you.
              </div>
              <Link href="/profile/shop" className="btn primary">
                <Wallet size={18} /> Set up my wallet
              </Link>
            </>
          )}

          {shop && wallet && (
            <>
              <h2 className="shop">{shop.name}</h2>
              {shop.category && <span className="muted" style={{ marginTop: -12 }}>{shop.category}</span>}

              {uri ? (
                <div className="qr">
                  <QRCodeSVG value={uri} size={220} level="M" />
                </div>
              ) : (
                <p className="center-note">Preparing your code…</p>
              )}

              <div style={{ textAlign: "center", width: "100%" }}>
                <div className="code-label">Scan to pay in ZARK · wallet</div>
                <button type="button" className="choice" onClick={copy} style={{ width: "100%", marginTop: 8, textAlign: "left" }}>
                  <Wallet size={20} color="var(--accent)" />
                  <span className="grow" style={{ wordBreak: "break-all", fontSize: 14 }}>{wallet}</span>
                  <Copy size={18} color="var(--muted)" />
                </button>
                <span className="muted" style={{ fontSize: 13 }}>
                  {copied ? "Address copied" : `Payments go to ${shortAddress(wallet)}, your registered wallet.`}
                </span>
              </div>

              <div className="actions">
                <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
                  Share with WhatsApp
                </a>
                <Link href="/request-payment" className="btn outline">Request a payment</Link>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}
