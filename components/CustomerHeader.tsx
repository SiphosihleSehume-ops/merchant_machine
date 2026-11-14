"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut, Repeat } from "lucide-react";
import Logo from "./Logo";
import { displayName, useAuth } from "@/lib/auth";

/** Simple top bar for the customer area. With `title` it shows a back button instead of the account. */
export default function CustomerHeader({ title }: { title?: string }) {
  const router = useRouter();
  const { session, logout } = useAuth();

  if (title) {
    return (
      <header className="c-head">
        <button className="icon-btn" onClick={() => router.push("/customer")} aria-label="Back">
          <ArrowLeft size={24} />
        </button>
        <strong style={{ flex: 1 }}>{title}</strong>
        <Logo />
      </header>
    );
  }

  return (
    <header className="c-head">
      <div className="who">
        <Logo />
        <span>{displayName(session?.user)}</span>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <Link href="/choose-role" className="icon-btn" aria-label="Switch role" title="Switch role">
          <Repeat size={20} />
        </Link>
        <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
}
