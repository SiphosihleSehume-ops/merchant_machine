// Public runtime config. Next.js inlines NEXT_PUBLIC_* at build time, so every
// reference must be a literal `process.env.NEXT_PUBLIC_...` expression.

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1").replace(/\/$/, "");

/** 11155111 = Ethereum Sepolia, 31337 = local `hardhat node` */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);

export const EXPLORER_TX_URL = process.env.NEXT_PUBLIC_EXPLORER_TX_URL || "https://sepolia.etherscan.io/tx/";

export type TokenSymbol = "ZARK" | "USDC" | "NGN";

export type TokenInfo = { symbol: TokenSymbol; label: string; address?: `0x${string}`; decimals: number };

export const TOKENS: TokenInfo[] = [
  { symbol: "ZARK", label: "South African Rand", address: process.env.NEXT_PUBLIC_TOKEN_ZARK_ADDRESS as `0x${string}` | undefined, decimals: 6 },
  { symbol: "USDC", label: "US Dollar", address: process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS as `0x${string}` | undefined, decimals: 6 },
  { symbol: "NGN", label: "Nigerian Naira", address: process.env.NEXT_PUBLIC_TOKEN_NGN_ADDRESS as `0x${string}` | undefined, decimals: 6 },
];

export const tokenByAddress = (address: string) =>
  TOKENS.find((t) => t.address?.toLowerCase() === address.toLowerCase());
