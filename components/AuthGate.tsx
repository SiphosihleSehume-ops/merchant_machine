"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { homeFor, useAuth } from "@/lib/auth";

const PUBLIC = ["/welcome", "/verify-email"];

/** Where the current path requires the user to be, or null if they may stay. */
function redirectFor(path: string, session: ReturnType<typeof useAuth>["session"]): string | null {
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
    if (target) router.replace(target);
  }, [target, router]);

  // Render nothing until we know the session, and while redirecting (avoids flashes)
  if (!ready || target) return <div className="gate-wait" aria-busy="true" />;
  return <>{children}</>;
}
