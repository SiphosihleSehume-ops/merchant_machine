"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import Logo from "@/components/Logo";
import BottomNav from "@/components/BottomNav";
import { CartButton } from "@/components/PageHeader";
import { merchant } from "@/lib/data";
import Balance from "@/components/Balance";
import { tiles } from "@/lib/nav";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { session } = useAuth();
  const shopName = session?.user.merchant?.name ?? merchant.name;
  const pct = Math.round((merchant.profileStep / merchant.profileSteps) * 100);
  return (
    <>
      <main>
        <section className="home-head">
          <div className="who">
            <Logo />
            <span>{shopName}</span>
          </div>
          <div>
            <Balance amount={merchant.balance} />
          </div>
          <CartButton />
        </section>

        <Link href="/profile" className="progress-card">
          <span className="progress-ring" style={{ "--pct": pct } as React.CSSProperties}>
            <span>
              {merchant.profileStep}/{merchant.profileSteps}
            </span>
          </span>
          <span className="copy">
            <span className="eyebrow" style={{ display: "block" }}>Almost there</span>
            <span className="headline">Complete your profile</span>
          </span>
          <ChevronRight size={22} />
        </Link>

        <div className="tile-grid">
          {tiles.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className="tile">
              <Icon className="tile-icon" size={34} strokeWidth={1.6} />
              <span className="tile-label">{label}</span>
            </Link>
          ))}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
