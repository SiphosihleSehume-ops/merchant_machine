import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import type { Network } from '@x402/core/types';

// ------------------------------------------------------------------
// Chain: Ethereum Sepolia by default (our own test tokens live there)
// ------------------------------------------------------------------
export const CHAIN_ID = Number(process.env.CHAIN_ID || 11155111);
export const X402_NETWORK = `eip155:${CHAIN_ID}` as Network;
export const RPC_URL = process.env.SEPOLIA_RPC_URL || '';
export const EXPLORER_TX_URL = process.env.EXPLORER_TX_URL || 'https://sepolia.etherscan.io/tx/';

// ------------------------------------------------------------------
// Tokens deployed from contracts/ (TestStablecoin). Name/version MUST match the
// on-chain EIP-712 domain or customer signatures will not verify.
// ------------------------------------------------------------------
export type TokenSymbol = 'ZARK' | 'USDC' | 'NGN';

export interface TokenConfig {
  symbol: TokenSymbol;
  address: `0x${string}` | undefined;
  eip712Name: string;
  eip712Version: string;
  decimals: number;
}

export const TOKENS: Record<TokenSymbol, TokenConfig> = {
  ZARK: {
    symbol: 'ZARK',
    address: process.env.TOKEN_ZARK_ADDRESS as `0x${string}` | undefined,
    eip712Name: 'ZARK Rand',
    eip712Version: '1',
    decimals: 6,
  },
  USDC: {
    symbol: 'USDC',
    address: process.env.TOKEN_USDC_ADDRESS as `0x${string}` | undefined,
    eip712Name: 'USD Coin',
    eip712Version: '2',
    decimals: 6,
  },
  NGN: {
    symbol: 'NGN',
    address: process.env.TOKEN_NGN_ADDRESS as `0x${string}` | undefined,
    eip712Name: 'NGN Naira',
    eip712Version: '1',
    decimals: 6,
  },
};

/** Tokens a customer may pay a ZAR invoice with (NGN is reserved for cross-border later). */
export const PAYMENT_TOKENS: TokenSymbol[] = ['ZARK', 'USDC'];

export function tokenByAddress(address: string): TokenConfig | undefined {
  return Object.values(TOKENS).find((t) => t.address?.toLowerCase() === address.toLowerCase());
}

// OPEN DECISION: ZAR conversion is demo-only. ZARK is pegged 1:1 to ZAR; USDC uses a
// fixed rate from env. The rate used is persisted on Settlement.fxSnapshot.
export function getZarPerUsd(): Prisma.Decimal {
  const raw = process.env.ZAR_PER_USD || '18.50';
  const rate = new Prisma.Decimal(raw);
  if (!rate.isFinite() || rate.lte(0)) {
    throw new Error(`Invalid ZAR_PER_USD rate: ${raw}`);
  }
  return rate;
}

/** ZAR per one unit of the token. */
export function zarPerToken(symbol: TokenSymbol): Prisma.Decimal {
  if (symbol === 'ZARK') return new Prisma.Decimal(1);
  if (symbol === 'USDC') return getZarPerUsd();
  throw new Error(`${symbol} is not a payment token`);
}

/** Converts a ZAR amount into token atomic units, rounded up so the merchant is never short. */
export function zarToTokenAtomic(zarAmount: Prisma.Decimal, rate: Prisma.Decimal, decimals: number): string {
  return zarAmount
    .div(rate)
    .mul(new Prisma.Decimal(10).pow(decimals))
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_UP)
    .toFixed(0);
}

export const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export interface PaymentOptionQuote {
  symbol: TokenSymbol;
  asset: `0x${string}`;
  amountAtomic: string;
  zarPerToken: string;
  eip712: { name: string; version: string };
}

/**
 * Everything the x402 challenge needs about one invoice. Loaded once per request by the
 * pre-check middleware and exposed to the x402 dynamic price/payTo callbacks and the
 * settlement hooks through AsyncLocalStorage (they only receive the HTTP context).
 */
export interface InvoiceQuote {
  invoiceId: string;
  merchantId: string;
  merchantName: string;
  merchantCategory: string | null;
  payTo: string;
  currency: string;
  subtotal: string;
  totalAmount: string;
  serviceFee: string;
  feePercentage: number;
  expiresAt: Date;
  items: { name: string; quantity: number; unitPrice: string; total: string }[];
  options: PaymentOptionQuote[];
}

export const quoteContext = new AsyncLocalStorage<InvoiceQuote>();

export function currentQuote(): InvoiceQuote {
  const quote = quoteContext.getStore();
  if (!quote) {
    throw new Error('x402: invoice quote missing from request context');
  }
  return quote;
}

/** Error carrying an HTTP status for the controller layer. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
