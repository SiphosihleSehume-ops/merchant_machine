"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "mm.hideBalance";
const EVENT = "mm:hide-balance";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Shared show/hide state for balances (remembered across reloads, synced across components). */
export function useHideBalance() {
  const hidden = useSyncExternalStore(subscribe, read, () => false);
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(KEY, read() ? "0" : "1");
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { hidden, toggle };
}
