"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { connectWallet, currentAccount, getBalances, hasMetaMask, signWalletLink, type Balance } from "./wallet";

/** MetaMask connection, account-link status and balances for the customer area. */
export function useWallet() {
  const { session, refresh } = useAuth();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedAddress = session?.user.customer?.walletAddress ?? null;
  const linked = !!address && linkedAddress === address.toLowerCase();

  const loadBalances = useCallback(async (addr: `0x${string}`) => {
    try {
      setBalances(await getBalances(addr));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read balances");
    }
  }, []);

  // Restore an already-authorised account and follow account switches in MetaMask
  useEffect(() => {
    if (!hasMetaMask()) return;
    let alive = true;
    currentAccount().then((a) => {
      if (alive && a) {
        setAddress(a);
        loadBalances(a);
      }
    });
    const onAccounts = (accounts: `0x${string}`[]) => {
      const next = accounts[0] ?? null;
      setAddress(next);
      setBalances(null);
      if (next) loadBalances(next);
    };
    const onChain = () => window.location.reload();
    window.ethereum!.on("accountsChanged", onAccounts);
    window.ethereum!.on("chainChanged", onChain);
    return () => {
      alive = false;
      window.ethereum?.removeListener("accountsChanged", onAccounts);
      window.ethereum?.removeListener("chainChanged", onChain);
    };
  }, [loadBalances]);

  /** Proves wallet ownership with a signature and links it to the customer account. */
  const link = useCallback(
    async (addr: `0x${string}`) => {
      if (!session) return;
      const proof = await signWalletLink(session.user.id, addr);
      await api("/customers/me/wallet", { method: "PUT", body: proof });
      await refresh();
    },
    [session, refresh],
  );

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const addr = await connectWallet();
      setAddress(addr);
      await loadBalances(addr);
      if (linkedAddress !== addr.toLowerCase()) await link(addr);
    } catch (err: any) {
      setError(err?.code === 4001 ? "Request cancelled in MetaMask." : err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }, [link, linkedAddress, loadBalances]);

  const relink = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await link(address);
    } catch (err: any) {
      setError(err?.code === 4001 ? "Signature cancelled in MetaMask." : err instanceof Error ? err.message : "Could not link wallet");
    } finally {
      setBusy(false);
    }
  }, [address, link]);

  return {
    address,
    linked,
    balances,
    busy,
    error,
    setError,
    connect,
    relink,
    reloadBalances: () => (address ? loadBalances(address) : Promise.resolve()),
  };
}
