/** Token definitions shared by the deploy script and tests. All tokens use 6 decimals. */
export const TOKENS = [
  // ZAR-pegged settlement token; invoices are priced in ZAR so it pays 1:1
  { key: "ZARK", name: "ZARK Rand", symbol: "ZARK", version: "1", faucet: 10_000n },
  // Mimics Circle USDC (EIP-712 version "2", like the real contract)
  { key: "USDC", name: "USD Coin", symbol: "USDC", version: "2", faucet: 1_000n },
  // Naira token for the cross-border payment simulation
  { key: "NGN", name: "NGN Naira", symbol: "NGN", version: "1", faucet: 1_000_000n },
] as const;

export const DECIMALS = 6;
export const ONE = 10n ** BigInt(DECIMALS);
