"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { homeFor, useAuth } from "@/lib/auth";

const PUBLIC = ["/welcome", "/verify-email"];
const RETURN_KEY = "mm.returnTo";
/** Reachable signed in or not (authorised by a signed link instead), e.g. the emailed KYC review. */
const OPEN = ["/kyc/review"];

/** Where the current path requires the user to be, or null if they may stay. */
function redirectFor(path: string, session: ReturnType<typeof useAuth>["session"]): string | null {
  if (OPEN.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));

  if (!session) return isPublic ? null : "/welcome";
  if (isPublic) return homeFor(session); // already signed in

  if (path === "/choose-role") return null; // can switch role any time
  if (!session.user.role) return "/choose-role";

  const isCustomerArea = path === "/customer" || path.startsWith("/customer/");
  if (session.user.role === "CUSTOMER" && !isCustomerArea) return "/customer";
  if (session.user.role === "MERCHANT" && isCustomerArea) return "/";
  return null;
}

/** Client-side route guard: welcome -> verify -> sign in -> role picker -> merchant or customer area. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, session } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const target = ready ? redirectFor(path, session) : null;

  useEffect(() => {
    if (target) {
      // Remember an opened payment link so the customer lands back on it after signing in
      if (path === "/customer/pay" && window.location.search.includes("invoice=")) {
        try {
          sessionStorage.setItem(RETURN_KEY, `${path}${window.location.search}`);
        } catch {
          /* storage unavailable */
        }
      }
      router.replace(target);
      return;
    }
    // Signed in as a customer now: resume a remembered payment link once
    if (ready && session?.user.role === "CUSTOMER") {
      let back: string | null = null;
      try {
        back = sessionStorage.getItem(RETURN_KEY);
        if (back) sessionStorage.removeItem(RETURN_KEY);
      } catch {
        /* storage unavailable */
      }
      if (back && back.startsWith("/customer/pay?")) router.replace(back);
    }
  }, [target, router, path, ready, session]);

  // Render nothing until we know the session, and while redirecting (avoids flashes)
  if (!ready || target) return <div className="gate-wait" aria-busy="true" />;
  return <>{children}</>;
}
