"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Award, Star, Store, MapPin, Smartphone, ChevronRight, Pencil, Repeat, LogOut, ShieldCheck, Home, CircleCheck,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { merchant } from "@/lib/data";
import { displayName, useAuth } from "@/lib/auth";

const items = [
  { label: "Rewards partners", Icon: Award, href: "#" },
  { label: "My shop", Icon: Store, href: "/profile/shop" },
  { label: "My address", Icon: MapPin, href: "/profile/address" },
  { label: "My devices", Icon: Smartphone, href: "/devices" },
];

export default function Profile() {
  const { session, logout } = useAuth();
  // Confirmation after returning from My shop (read on the client; no Suspense needed)
  const [savedShop, setSavedShop] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("saved") === "shop") {
      setSavedShop(true);
      window.history.replaceState(null, "", "/profile"); // don't show it again on reload
    }
  }, []);

  return (
    <>
      <PageHeader
        title="My profile"
        action={
          <button className="icon-btn filled" aria-label="Edit profile">
            <Pencil size={18} />
          </button>
        }
      />
      <main>
        {savedShop && (
          <div className="stack" style={{ paddingBottom: 0 }}>
            <div className="alert ok" role="status" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <CircleCheck size={20} />
              <span>
                Shop saved{session?.user.merchant?.name ? `: ${session.user.merchant.name}` : ""}. Customers will pay
                your connected wallet.
              </span>
            </div>
          </div>
        )}
        <section className="rewards">
          <div className="top">
            <span className="eyebrow">My rewards level</span>
            <div className="stars" aria-label={`Level ${merchant.rewardsLevel} of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} size={34} className={n <= merchant.rewardsLevel ? "on" : ""} />
              ))}
            </div>
            <p className="hint">
              <strong>How do I get to level 2?</strong>
              Grow your sales and money transfers, and accept QR payments.
            </p>
          </div>
          <div className="bottom">
            <Award size={40} color="var(--accent)" strokeWidth={1.5} />
            <div>
              <div className="points">{merchant.rewardsBalance.toFixed(2)}</div>
              <div className="points-sub">Reward points available this week at participating partners</div>
            </div>
          </div>
        </section>

        <div className="stack" style={{ paddingTop: 0, gap: 10 }}>
          {items.map(({ label, Icon, href }) => (
            <Link key={label} href={href} className="card-link">
              <Icon size={26} color="var(--accent)" strokeWidth={1.7} />
              <span className="grow">{label}</span>
              <ChevronRight size={20} />
            </Link>
          ))}
          {session?.user.isAdmin && (
            <Link href="/admin/kyc" className="card-link">
              <ShieldCheck size={26} color="var(--accent)" strokeWidth={1.7} />
              <span className="grow">KYC reviews (verifier)</span>
              <ChevronRight size={20} />
            </Link>
          )}
          <Link href="/choose-role" className="card-link">
            <Repeat size={26} color="var(--accent)" strokeWidth={1.7} />
            <span className="grow">Switch role</span>
            <ChevronRight size={20} />
          </Link>
          <button className="card-link" onClick={logout} style={{ width: "100%", textAlign: "left" }}>
            <LogOut size={26} color="var(--bad)" strokeWidth={1.7} />
            <span className="grow">Sign out</span>
          </button>
          <Link href="/" className="btn primary" style={{ marginTop: 6 }}>
            <Home size={18} /> Go to home
          </Link>
          <p className="center-note" style={{ fontSize: 13 }}>Signed in as {displayName(session?.user)}</p>
        </div>
      </main>
    </>
  );
}
