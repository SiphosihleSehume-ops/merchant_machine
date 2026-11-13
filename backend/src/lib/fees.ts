import { Prisma } from '@prisma/client';
import { keccak256, toHex } from 'viem';

/**
 * Platform fee: a percentage DEDUCTED FROM THE MERCHANT on each payment (the customer pays
 * the invoice total). Default 2.5%. When PAYMENTS_CONTRACT_ADDRESS is set, the fee is
 * collected on-chain by the MerchantPayments contract (merchant gets total - fee, treasury
 * gets fee); otherwise it is only recorded in the ledger.
 *
 * Every invoice snapshots its terms at creation, so changing these settings never changes
 * the price of an invoice that already exists. Invoices created before this existed keep
 * their original terms (merchant.feePercentage, ledger only).
 */
export function platformFeeBps(): number {
  const pct = Number(process.env.PLATFORM_FEE_PERCENT ?? '2.5');
  if (!Number.isFinite(pct) || pct < 0 || pct > 10) throw new Error(`Invalid PLATFORM_FEE_PERCENT: ${process.env.PLATFORM_FEE_PERCENT}`);
  return Math.round(pct * 100);
}

export function paymentsContract(): `0x${string}` | null {
  const a = process.env.PAYMENTS_CONTRACT_ADDRESS?.trim();
  return a && /^0x[a-fA-F0-9]{40}$/.test(a) ? (a as `0x${string}`) : null;
}

/** Terms stored on a NEW invoice. */
export function newInvoiceFeeTerms() {
  return { platformFeeBps: platformFeeBps(), paymentsContract: paymentsContract() };
}

type FeeSource = {
  platformFeeBps: number | null;
  paymentsContract: string | null;
  merchant: { feePercentage: number };
};

/** Effective fee terms of an invoice (snapshot, or legacy merchant percentage). */
export function feeTermsOf(inv: FeeSource) {
  const percent =
    inv.platformFeeBps !== null ? new Prisma.Decimal(inv.platformFeeBps).div(100) : new Prisma.Decimal(inv.merchant.feePercentage);
  return { percent, viaContract: inv.platformFeeBps !== null && !!inv.paymentsContract, contract: inv.paymentsContract };
}

/** Fee on an amount, rounded to ledger precision; merchant gets the remainder. */
export function splitAmount(total: Prisma.Decimal, percent: Prisma.Decimal) {
  const fee = total.mul(percent).div(100).toDecimalPlaces(6, Prisma.Decimal.ROUND_DOWN); // rounds in the merchant's favour, like the contract
  return { fee, net: total.minus(fee) };
}

/** On-chain reference for an invoice (MerchantPayments.PaymentMade.invoiceRef). */
export const invoiceRef = (invoiceId: string) => keccak256(toHex(invoiceId));
