import { Prisma } from '@prisma/client';
import { createPublicClient, decodeEventLog, erc20Abi, formatUnits, getAddress, http, parseAbi } from 'viem';
import { hardhat, sepolia } from 'viem/chains';
import { prisma } from '../lib/prisma.js';
import { CHAIN_ID, EXPLORER_TX_URL, HttpError, RPC_URL, TOKENS } from '../lib/x402.js';
import { X402Service } from './x402.service.js';
import { invoiceRef } from '../lib/fees.js';

const paymentsAbi = parseAbi([
  'event PaymentMade(bytes32 indexed invoiceRef, address indexed payer, address indexed merchant, address token, uint256 amount, uint256 fee)',
]);

/** Fee terms snapshotted on the invoice (see lib/fees.ts). */
async function invoiceTerms(invoiceId: string) {
  return prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { platformFeeBps: true, paymentsContract: true },
  });
}

const chain = CHAIN_ID === hardhat.id ? hardhat : sepolia;
const client = () => createPublicClient({ chain, transport: http(RPC_URL) });

/**
 * Direct ZARK payment for an invoice: the customer sends a normal ERC-20 transfer from
 * MetaMask (works with any ERC-20, no EIP-3009 needed), then submits the tx hash. The
 * backend only marks the invoice paid after verifying ON-CHAIN that the transaction:
 *   - succeeded, on the configured ZARK token
 *   - transferred at least the invoice total to the merchant's registered wallet
 *   - has not already been used for another payment
 */
export class DirectPayService {
  /** Public receipt the customer sees before confirming. */
  static async receipt(invoiceId: string) {
    const quote = await X402Service.getPayableQuote(invoiceId);
    const zark = quote.options.find((o) => o.symbol === 'ZARK');
    if (!zark) throw new HttpError(503, 'ZARK payments are not configured (TOKEN_ZARK_ADDRESS)');
    const terms = await invoiceTerms(invoiceId);
    return {
      invoiceId: quote.invoiceId,
      merchant: { name: quote.merchantName, category: quote.merchantCategory ?? null, wallet: quote.payTo },
      items: quote.items,
      subtotal: quote.subtotal,
      total: quote.totalAmount,
      currency: quote.currency,
      expiresAt: quote.expiresAt,
      // Customer pays the total; the platform fee is deducted from the merchant's side
      platformFee: { percent: quote.feePercentage, amount: quote.serviceFee, paidBy: 'MERCHANT' as const },
      pay: {
        symbol: 'ZARK',
        token: zark.asset,
        amountAtomic: zark.amountAtomic,
        decimals: zark.decimals,
        chainId: CHAIN_ID,
        // Set -> pay through MerchantPayments.pay(token, merchant, amount, invoiceRef); null -> plain transfer
        contract: terms.paymentsContract,
        invoiceRef: invoiceRef(invoiceId),
      },
    };
  }

  static async confirm(invoiceId: string, txHash: `0x${string}`, customerId?: string) {
    const used = await prisma.settlement.findFirst({ where: { txHash } });
    if (used) throw new HttpError(409, 'This transaction was already used for a payment', 'TX_ALREADY_USED');

    // Validates the invoice is still payable and gives the exact amount + merchant wallet
    const quote = await X402Service.getPayableQuote(invoiceId);
    const zark = quote.options.find((o) => o.symbol === 'ZARK');
    const token = TOKENS.ZARK.address;
    if (!zark || !token) throw new HttpError(503, 'ZARK payments are not configured');

    let receipt;
    try {
      receipt = await client().waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
    } catch {
      throw new HttpError(504, 'Transaction not confirmed yet. Wait a moment and try again.', 'TX_PENDING');
    }
    if (receipt.status !== 'success') throw new HttpError(400, 'That transaction failed on-chain', 'TX_FAILED');

    const merchantWallet = getAddress(quote.payTo);
    const required = BigInt(zark.amountAtomic);
    const terms = await invoiceTerms(invoiceId);
    let payer: `0x${string}`;
    let paidAmount: bigint;
    let feeAtomic: bigint | null = null;

    if (terms.paymentsContract) {
      // Invoice must be paid through MerchantPayments (fee collected on-chain)
      const event = receipt.logs
        .filter((l) => l.address.toLowerCase() === terms.paymentsContract!.toLowerCase())
        .map((l) => {
          try {
            return decodeEventLog({ abi: paymentsAbi, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === 'PaymentMade' && e.args.invoiceRef === invoiceRef(invoiceId));
      if (!event) {
        throw new HttpError(400, "That transaction isn't a payment for this invoice through the payments contract", 'TX_NOT_CONTRACT_PAYMENT');
      }
      if (getAddress(event.args.merchant) !== merchantWallet) {
        throw new HttpError(400, "That payment went to a different shop's wallet", 'TX_WRONG_RECIPIENT');
      }
      if (event.args.token.toLowerCase() !== token.toLowerCase()) {
        throw new HttpError(400, 'That payment used a different token', 'TX_WRONG_TOKEN');
      }
      if (event.args.amount < required) {
        throw new HttpError(400, 'The amount paid is less than the invoice total', 'TX_UNDERPAID');
      }
      payer = event.args.payer;
      paidAmount = event.args.amount;
      feeAtomic = event.args.fee;
    } else {
      // Legacy / no contract configured: plain ERC-20 transfer to the merchant
      const transfer = receipt.logs
        .filter((l) => l.address.toLowerCase() === token.toLowerCase())
        .map((l) => {
          try {
            return decodeEventLog({ abi: erc20Abi, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === 'Transfer' && getAddress(e.args.to) === merchantWallet);

      if (!transfer || transfer.eventName !== 'Transfer') {
        throw new HttpError(400, "That transaction didn't send ZARK to this shop's wallet", 'TX_WRONG_RECIPIENT');
      }
      if (transfer.args.value < required) {
        throw new HttpError(400, 'The amount sent is less than the invoice total', 'TX_UNDERPAID');
      }
      payer = transfer.args.from;
      paidAmount = transfer.args.value;
    }

    if (!(await X402Service.claimForSettlement(quote))) {
      throw new HttpError(409, 'This invoice is already being paid', 'INVOICE_BUSY');
    }
    try {
      await X402Service.settlePayment(invoiceId, txHash, {
        fxSnapshot: new Prisma.Decimal(1), // ZARK is 1:1 with ZAR
        asset: 'ZARK',
        payer,
        customerId,
        rail: terms.paymentsContract ? 'MERCHANT_PAYMENTS_CONTRACT' : 'DIRECT_TRANSFER',
        // Ledger records the fee that was actually collected on-chain (ZARK is 1:1 with ZAR)
        platformFee: feeAtomic !== null ? new Prisma.Decimal(formatUnits(feeAtomic, zark.decimals)) : undefined,
      });
    } catch (error) {
      await X402Service.markSettlementFailed(invoiceId).catch(() => undefined);
      throw error;
    }

    return {
      invoiceId,
      merchantName: quote.merchantName,
      total: quote.totalAmount,
      currency: quote.currency,
      paid: { symbol: 'ZARK', amountAtomic: paidAmount.toString(), decimals: zark.decimals },
      platformFeeAtomic: feeAtomic?.toString() ?? null,
      payer,
      txHash,
      explorerUrl: `${EXPLORER_TX_URL}${txHash}`,
    };
  }
}
