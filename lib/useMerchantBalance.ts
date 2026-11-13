"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

export type MerchantBalance = {
  symbol: "ZARK";
  balance: string; // decimal string, e.g. "125.5"
  chainId: number;
  tokenAddress: string | null;
  wallet: string | null;
  reason: null | "NO_WALLET" | "NOT_CONFIGURED" | "UNAVAILABLE";
};

// One request shared by every component on screen; refreshed after 20 s
const TTL_MS = 20_000;
let cache: { at: number; value: MerchantBalance } | null = null;
let inflight: Promise<MerchantBalance> | null = null;

function fetchBalance(force = false): Promise<MerchantBalance> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value);
  inflight ??= api<MerchantBalance>("/merchants/me/balance")
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Live ZARK balance of the merchant's registered payout wallet (starts at 0). */
export function useMerchantBalance(enabled = true) {
  const { session } = useAuth();
  const isMerchant = session?.user.role === "MERCHANT";
  const [data, setData] = useState<MerchantBalance | null>(cache?.value ?? null);

  const refresh = useCallback(async (force = true) => {
    try {
      setData(await fetchBalance(force));
    } catch {
      /* keep last value; header balance is non-critical */
    }
  }, []);

  useEffect(() => {
    if (enabled && isMerchant) refresh(false);
  }, [enabled, isMerchant, refresh]);

  return { data, amount: data ? Number(data.balance) : null, refresh };
}
