"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import Logo from "./Logo";
import { formatRand, merchant } from "@/lib/data";

export function CartButton() {
  return (
    <Link href="/cart" className="cart-btn" aria-label={`Cart, ${merchant.cartCount} items`}>
      <ShoppingCart size={22} strokeWidth={2} />
      <span className="cart-count" data-empty={merchant.cartCount === 0}>
        {merchant.cartCount}
      </span>
    </Link>
  );
}

export default function PageHeader({
  title,
  action,
  hideBalance,
}: {
  title?: string;
  action?: React.ReactNode;
  hideBalance?: boolean;
}) {
  const router = useRouter();
  return (
    <>
      <header className="topbar">
        <button className="icon-btn" onClick={() => router.back()} aria-label="Back">
          <ArrowLeft size={24} />
        </button>
        <div className="topbar-center">
          <Logo />
          {!hideBalance && <span className="topbar-balance">{formatRand(merchant.balance)}</span>}
        </div>
        <CartButton />
      </header>
      {title && (
        <div className="band">
          <h1>{title}</h1>
          {action}
        </div>
      )}
    </>
  );
}
