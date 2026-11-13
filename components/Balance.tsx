"use client";

import { Eye, EyeOff } from "lucide-react";
import { formatZark, ACCOUNT_CURRENCY } from "@/lib/data";
import { useHideBalance } from "@/lib/useHideBalance";

/**
 * Account balance in ZARK with an eye toggle.
 * Open eye = balance visible; click it to close the eye, dim and mask the balance.
 */
/** `amount` null = still loading. */
export default function Balance({ amount, variant = "hero" }: { amount: number | null; variant?: "hero" | "topbar" }) {
  const { hidden, toggle } = useHideBalance();
  const size = variant === "hero" ? 24 : 18;

  return (
    <span className={`balance-wrap ${variant}`} data-hidden={hidden}>
      <span className={variant === "hero" ? "balance" : "topbar-balance"} aria-live="polite">
        {hidden ? `${ACCOUNT_CURRENCY} ••••••` : amount === null ? `${ACCOUNT_CURRENCY} …` : formatZark(amount)}
      </span>
      <button
        type="button"
        className="eye-btn"
        onClick={toggle}
        aria-pressed={hidden}
        aria-label={hidden ? "Show balance" : "Hide balance"}
        title={hidden ? "Show balance" : "Hide balance"}
      >
        {hidden ? <EyeOff size={size} /> : <Eye size={size} />}
      </button>
    </span>
  );
}
