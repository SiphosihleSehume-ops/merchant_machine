import { Prisma } from '@prisma/client';
import { isRelayerConfigured, sendTreasuryRefund } from '../lib/facilitator.js';
import { prisma } from '../lib/prisma.js';
import { decimalsOf } from '../lib/tokenBalance.js';
import {
  EVM_ADDRESS_RE,
  EXPLORER_TX_URL,
  HttpError,
  TOKENS,
  TokenSymbol,
  zarPerToken,
  zarToTokenAtomic,
} from '../lib/x402.js';
import { ActiveRole } from '../middleware/auth.middleware.js';
import { WebhookService } from './webhook.service.js';

// OPEN DECISION: approval window length is not specified; configurable, default 24h.
const REVERSAL_APPROVAL_MS = Number(process.env.REVERSAL_APPROVAL_HOURS || 24) * 60 * 60 * 1000;

type TxRow = Prisma.TransactionGetPayload<{
  include: { merchant: { select: { name: true } }; invoice: { include: { items: true } }; settlement: true; reversal: true };
}>;

/** UI state: PENDING | SETTLED | FAILED | REVERSED */
function displayStatus(tx: TxRow) {
  if (tx.reversal?.status === 'COMPLETED') return 'REVERSED';
  if (tx.status === 'PENDING' || tx.status === 'PROCESSING') return 'PENDING';
  return tx.status;
}

function present(tx: TxRow, serviceFee?: Prisma.Decimal) {
  return {
    id: tx.id,
    invoiceId: tx.invoiceId,
    merchantName: tx.merchant.name,
    amount: tx.amount.toFixed(2),
    currency: tx.currency,
    serviceFee: serviceFee?.toFixed(2) ?? null,
    asset: tx.asset,
    payerAddress: tx.payerAddress,
    status: displayStatus(tx),
    rawStatus: tx.status,
    createdAt: tx.createdAt,
    items:
      tx.invoice?.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toFixed(2),
        total: i.total.toFixed(2),
      })) ?? [],
    txHash: tx.settlement?.txHash ?? null,
    explorerUrl: tx.settlement?.txHash ? `${EXPLORER_TX_URL}${tx.settlement.txHash}` : null,
    reversal: tx.reversal
      ? {
          id: tx.reversal.id,
          status: tx.reversal.status,
          amount: tx.reversal.amount.toFixed(2),
          reversalFee: tx.reversal.reversalFee.toFixed(2),
          reason: tx.reversal.reason,
          expiresAt: tx.reversal.expiresAt,
          merchantApprovedAt: tx.reversal.merchantApprovedAt,
          completedAt: tx.reversal.completedAt,
          refundTxHash: tx.reversal.refundTxHash,
          refundExplorerUrl: tx.reversal.refundTxHash ? `${EXPLORER_TX_URL}${tx.reversal.refundTxHash}` : null,
        }
      : null,
  };
}

async function customerScope(customerId: string, extraWallet?: string): Promise<Prisma.TransactionWhereInput> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const extra = extraWallet && EVM_ADDRESS_RE.test(extraWallet) ? extraWallet.toLowerCase() : null;
  // Payments are linked by account, by the verified wallet, or by the currently connected MetaMask wallet
  return {
    OR: [
      { customerId },
      ...(customer.walletAddress ? [{ payerAddress: customer.walletAddress }] : []),
      ...(extra && extra !== customer.walletAddress ? [{ payerAddress: extra }] : []),
    ],
  };
}

/**
 * PDF Section 3.3: Lazily expires any PENDING_MERCHANT reversals whose approval
 * timeout (`expiresAt`) has passed so requests do not sit forever.
 */
async function expireStaleReversals(where: Prisma.ReversalWhereInput) {
  const now = new Date();
  const stale = await prisma.reversal.findMany({
    where: { ...where, status: 'PENDING_MERCHANT', expiresAt: { lte: now } },
  });
  for (const r of stale) {
    const updated = await prisma.reversal.updateMany({
      where: { id: r.id, status: 'PENDING_MERCHANT' },
      data: { status: 'FAILED', completedAt: now },
    });
    if (updated.count === 1) {
      await WebhookService.record(r.merchantId, 'reversal.expired', `reversal.expired:${r.id}`, {
        reversalId: r.id,
        transactionId: r.transactionId,
        amount: r.amount.toFixed(2),
      }).catch(() => undefined);
    }
  }
}

export class PaymentsService {
  static async listTransactions(
    auth: { role: ActiveRole; merchantId?: string; customerId?: string },
    walletAddress?: string,
  ) {
    if (auth.role === 'MERCHANT') {
      await expireStaleReversals({ merchantId: auth.merchantId! });
    } else if (auth.customerId) {
      await expireStaleReversals({ customerId: auth.customerId });
    }

    const where =
      auth.role === 'MERCHANT'
        ? { merchantId: auth.merchantId! }
        : await customerScope(auth.customerId!, walletAddress);

    const rows = await prisma.transaction.findMany({
      where,
      include: { merchant: { select: { name: true } }, invoice: { include: { items: true } }, settlement: true, reversal: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    // Ledger entries reference transactions by id (no relation), so fetch fees separately
    const fees = await prisma.ledgerEntry.findMany({
      where: { transactionId: { in: rows.map((r) => r.id) }, account: 'PLATFORM_FEE', type: 'CREDIT' },
    });
    const feeByTx = new Map(fees.map((f) => [f.transactionId, f.amount]));
    return rows.map((r) => present(r, feeByTx.get(r.id)));
  }

  /**
   * Customer asks for a reversal. The platform service fee is non-refundable, so the
   * maximum reversal amount is the payment minus that fee. Supports partial refunds
   * (`input.amount <= maxRefundable`) as well as full net refunds. The merchant must
   * respond before `expiresAt` (or when `autoApprove: true` is passed and the treasury
   * relayer is configured, executes the on-chain refund immediately).
   */
  static async requestReversal(
    customerId: string,
    input: {
      transactionId: string;
      amount?: number;
      reason?: string;
      walletAddress?: string;
      autoApprove?: boolean;
    },
  ) {
    const scope = await customerScope(customerId, input.walletAddress);
    const tx = await prisma.transaction.findFirst({
      where: { AND: [{ id: input.transactionId }, scope] },
      include: { reversal: true },
    });

    if (!tx) throw new HttpError(404, 'Payment not found');
    if (tx.status !== 'SETTLED') throw new HttpError(409, 'Only settled payments can be reversed');
    if (tx.reversal) throw new HttpError(409, `A reversal already exists (${tx.reversal.status})`);

    const feeEntries = await prisma.ledgerEntry.aggregate({
      where: { transactionId: tx.id, account: 'PLATFORM_FEE', type: 'CREDIT' },
      _sum: { amount: true },
    });
    const fee = feeEntries._sum.amount ?? new Prisma.Decimal(0);
    const maxRefundable = tx.amount.minus(fee);

    let refundAmount = maxRefundable;
    if (input.amount !== undefined) {
      const requested = new Prisma.Decimal(input.amount).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
      if (requested.lte(0) || requested.gt(maxRefundable)) {
        throw new HttpError(
          400,
          `Refund amount must be between 0.01 and ${maxRefundable.toFixed(2)} (payment minus non-refundable service fee)`,
          'INVALID_REFUND_AMOUNT',
        );
      }
      refundAmount = requested;
    }

    const now = new Date();

    let createdReversal;
    try {
      createdReversal = await prisma.$transaction(async (db) => {
        if (!tx.customerId) {
          await db.transaction.update({ where: { id: tx.id }, data: { customerId } });
        }
        const created = await db.reversal.create({
          data: {
            transactionId: tx.id,
            merchantId: tx.merchantId,
            customerId,
            amount: refundAmount,
            reversalFee: fee,
            reason: input.reason,
            feeAcknowledgedAt: now,
            expiresAt: new Date(now.getTime() + REVERSAL_APPROVAL_MS),
          },
        });

        await WebhookService.record(
          tx.merchantId,
          'reversal.requested',
          `reversal.requested:${created.id}`,
          {
            reversalId: created.id,
            transactionId: tx.id,
            amount: created.amount.toFixed(2),
            reversalFee: created.reversalFee.toFixed(2),
            reason: created.reason,
            expiresAt: created.expiresAt.toISOString(),
          },
          db,
        );

        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'A reversal already exists for this payment');
      }
      throw error;
    }

    if (input.autoApprove && isRelayerConfigured()) {
      try {
        return await PaymentsService.respondToReversal(
          tx.merchantId,
          createdReversal.id,
          { decision: 'APPROVE' },
          { revertToPendingOnError: true, recipientOverride: input.walletAddress },
        );
      } catch {
        // Fallback to PENDING_MERCHANT if relayer on-chain transfer could not complete automatically
      }
    }

    return {
      id: createdReversal.id,
      status: createdReversal.status,
      amount: createdReversal.amount.toFixed(2),
      reversalFee: createdReversal.reversalFee.toFixed(2),
      expiresAt: createdReversal.expiresAt,
      refundTxHash: createdReversal.refundTxHash,
      refundExplorerUrl: null,
    };
  }

  /**
   * Allows a customer to trigger/claim an on-chain refund for a pending or failed reversal
   * when the treasury relayer is configured.
   */
  static async claimReversal(customerId: string, reversalId: string, walletAddress?: string) {
    const reversal = await prisma.reversal.findFirst({
      where: { id: reversalId, customerId },
    });
    if (!reversal) {
      throw new HttpError(404, 'Reversal not found');
    }
    if (reversal.status === 'COMPLETED') {
      return {
        id: reversal.id,
        transactionId: reversal.transactionId,
        status: reversal.status,
        amount: reversal.amount.toFixed(2),
        reversalFee: reversal.reversalFee.toFixed(2),
        expiresAt: reversal.expiresAt,
        completedAt: reversal.completedAt,
        refundTxHash: reversal.refundTxHash,
        refundExplorerUrl: reversal.refundTxHash ? `${EXPLORER_TX_URL}${reversal.refundTxHash}` : null,
      };
    }
    if (reversal.status === 'FAILED') {
      await prisma.reversal.update({
        where: { id: reversal.id },
        data: { status: 'PENDING_MERCHANT', completedAt: null },
      });
    }
    return PaymentsService.respondToReversal(
      reversal.merchantId,
      reversal.id,
      { decision: 'APPROVE' },
      { revertToPendingOnError: true, recipientOverride: walletAddress },
    );
  }

  /**
   * PDF Section 3.2 & 3.3: Merchant approves or declines a reversal request within
   * the timeout window.
   *
   * - Idempotent: a reversal can only transition out of `PENDING_MERCHANT` once.
   * - Never uses `transferFrom`: on approval, executes a new on-chain payment back to
   *   the customer from the platform treasury/facilitator and records reversing `DEBIT`
   *   ledger entries (`MERCHANT_PAYABLE` up to available balance, then `MERCHANT_RESERVE`).
   */
  static async respondToReversal(
    merchantId: string,
    reversalId: string,
    input: { decision: 'APPROVE' | 'DECLINE'; reason?: string; refundTxHash?: `0x${string}` },
    opts: { revertToPendingOnError?: boolean; recipientOverride?: string } = {},
  ) {
    const reversal = await prisma.reversal.findFirst({
      where: { id: reversalId, merchantId },
      include: {
        transaction: { include: { settlement: true } },
        customer: true,
      },
    });

    if (!reversal) {
      throw new HttpError(404, 'Reversal not found');
    }

    if (reversal.status !== 'PENDING_MERCHANT') {
      throw new HttpError(409, `Reversal is already ${reversal.status}`, 'REVERSAL_ALREADY_PROCESSED');
    }

    const now = new Date();
    if (reversal.expiresAt <= now) {
      await prisma.reversal.updateMany({
        where: { id: reversal.id, status: 'PENDING_MERCHANT' },
        data: { status: 'FAILED', completedAt: now },
      });
      await WebhookService.record(merchantId, 'reversal.expired', `reversal.expired:${reversal.id}`, {
        reversalId: reversal.id,
        transactionId: reversal.transactionId,
        amount: reversal.amount.toFixed(2),
      }).catch(() => undefined);
      throw new HttpError(410, 'Reversal approval window has expired', 'REVERSAL_EXPIRED');
    }

    // ---------- Merchant Declines ----------
    if (input.decision === 'DECLINE') {
      const declined = await prisma.$transaction(async (db) => {
        const claimed = await db.reversal.updateMany({
          where: { id: reversal.id, status: 'PENDING_MERCHANT' },
          data: {
            status: 'DECLINED',
            reason: input.reason ?? reversal.reason,
            completedAt: now,
          },
        });
        if (claimed.count !== 1) {
          throw new HttpError(409, 'Reversal has already been processed', 'REVERSAL_ALREADY_PROCESSED');
        }
        const updated = await db.reversal.findUniqueOrThrow({ where: { id: reversal.id } });
        await WebhookService.record(
          merchantId,
          'reversal.declined',
          `reversal.declined:${reversal.id}`,
          {
            reversalId: reversal.id,
            transactionId: reversal.transactionId,
            amount: reversal.amount.toFixed(2),
            reason: updated.reason,
          },
          db,
        );
        return updated;
      });

      return {
        id: declined.id,
        transactionId: declined.transactionId,
        status: declined.status,
        amount: declined.amount.toFixed(2),
        reversalFee: declined.reversalFee.toFixed(2),
        expiresAt: declined.expiresAt,
        completedAt: declined.completedAt,
        refundTxHash: declined.refundTxHash,
      };
    }

    // ---------- Merchant Approves ----------
    // 1. Atomically claim the reversal (`PENDING_MERCHANT` -> `APPROVED`) so concurrent calls cannot double-refund
    const claimed = await prisma.reversal.updateMany({
      where: { id: reversal.id, status: 'PENDING_MERCHANT' },
      data: { status: 'APPROVED', merchantApprovedAt: now },
    });
    if (claimed.count !== 1) {
      throw new HttpError(409, 'Reversal has already been processed', 'REVERSAL_ALREADY_PROCESSED');
    }

    // 2. Execute new on-chain refund payment back to the customer (without conversion markup)
    let refundTxHash: string | null = input.refundTxHash ?? null;
    const recipient = (
      reversal.transaction.payerAddress ??
      reversal.customer.walletAddress ??
      opts.recipientOverride
    )?.toLowerCase();
    const assetSymbol = ((reversal.transaction.asset as TokenSymbol | null) ?? 'ZARK') as TokenSymbol;
    const token = TOKENS[assetSymbol] ?? TOKENS.ZARK;

    if (!refundTxHash && isRelayerConfigured() && token?.address && recipient && EVM_ADDRESS_RE.test(recipient)) {
      try {
        const decimals = await decimalsOf(token.address).catch(() => token.decimals);
        const rate = reversal.transaction.settlement?.fxSnapshot ?? zarPerToken(token.symbol);
        const amountAtomic = BigInt(zarToTokenAtomic(reversal.amount, rate, decimals));
        refundTxHash = await sendTreasuryRefund({
          tokenAddress: token.address,
          to: recipient as `0x${string}`,
          amountAtomic,
        });
      } catch (error: any) {
        if (opts.revertToPendingOnError) {
          await prisma.reversal.update({
            where: { id: reversal.id },
            data: { status: 'PENDING_MERCHANT', merchantApprovedAt: null },
          });
          throw new HttpError(
            502,
            error?.message || 'Automatic treasury refund unavailable; awaiting merchant approval',
            'REFUND_TX_FAILED',
          );
        }
        await prisma.reversal.update({
          where: { id: reversal.id },
          data: { status: 'FAILED', completedAt: new Date() },
        });
        await WebhookService.record(merchantId, 'reversal.failed', `reversal.failed:${reversal.id}`, {
          reversalId: reversal.id,
          transactionId: reversal.transactionId,
          error: error?.message || 'On-chain refund failed',
        }).catch(() => undefined);
        throw new HttpError(502, error?.message || 'On-chain refund transaction failed', 'REFUND_TX_FAILED');
      }
    }

    // 3. Complete the reversal and write reversing double-entry DEBIT ledger records
    const completed = await prisma.$transaction(async (db) => {
      // Compute current net MERCHANT_PAYABLE balance (credits minus debits)
      const [credits, debits] = await Promise.all([
        db.ledgerEntry.aggregate({
          where: { merchantId, account: 'MERCHANT_PAYABLE', type: 'CREDIT' },
          _sum: { amount: true },
        }),
        db.ledgerEntry.aggregate({
          where: { merchantId, account: 'MERCHANT_PAYABLE', type: 'DEBIT' },
          _sum: { amount: true },
        }),
      ]);
      const availablePayable = (credits._sum.amount ?? new Prisma.Decimal(0)).minus(
        debits._sum.amount ?? new Prisma.Decimal(0),
      );

      // Debit MERCHANT_PAYABLE up to available balance; any shortfall is debited against MERCHANT_RESERVE (PDF §3.2)
      const payableDebit = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        Prisma.Decimal.min(availablePayable, reversal.amount),
      );
      const reserveDebit = reversal.amount.minus(payableDebit);

      if (payableDebit.gt(0)) {
        await db.ledgerEntry.create({
          data: {
            merchantId,
            transactionId: reversal.transactionId,
            reversalId: reversal.id,
            account: 'MERCHANT_PAYABLE',
            type: 'DEBIT',
            amount: payableDebit,
            description: `Reversal #${reversal.id.substring(0, 8)} for Tx #${reversal.transactionId.substring(0, 8)}`,
          },
        });
      }

      if (reserveDebit.gt(0)) {
        await db.ledgerEntry.create({
          data: {
            merchantId,
            transactionId: reversal.transactionId,
            reversalId: reversal.id,
            account: 'MERCHANT_RESERVE',
            type: 'DEBIT',
            amount: reserveDebit,
            description: `Reserve Debit on Reversal #${reversal.id.substring(0, 8)}`,
          },
        });
      }

      const updated = await db.reversal.update({
        where: { id: reversal.id },
        data: {
          status: 'COMPLETED',
          refundTxHash,
          completedAt: new Date(),
        },
      });

      await WebhookService.record(
        merchantId,
        'reversal.completed',
        `reversal.completed:${reversal.id}`,
        {
          reversalId: reversal.id,
          transactionId: reversal.transactionId,
          amount: reversal.amount.toFixed(2),
          reversalFee: reversal.reversalFee.toFixed(2),
          refundTxHash,
        },
        db,
      );

      return updated;
    });

    return {
      id: completed.id,
      transactionId: completed.transactionId,
      status: completed.status,
      amount: completed.amount.toFixed(2),
      reversalFee: completed.reversalFee.toFixed(2),
      expiresAt: completed.expiresAt,
      merchantApprovedAt: completed.merchantApprovedAt,
      completedAt: completed.completedAt,
      refundTxHash: completed.refundTxHash,
      refundExplorerUrl: completed.refundTxHash ? `${EXPLORER_TX_URL}${completed.refundTxHash}` : null,
    };
  }

  static async listReversals(auth: { role: ActiveRole; merchantId?: string; customerId?: string }) {
    const where = auth.role === 'MERCHANT' ? { merchantId: auth.merchantId! } : { customerId: auth.customerId! };
    await expireStaleReversals(where);

    const rows = await prisma.reversal.findMany({
      where,
      include: {
        customer: { select: { walletAddress: true } },
        transaction: { include: { merchant: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      merchantName: r.transaction.merchant.name,
      originalAmount: r.transaction.amount.toFixed(2),
      asset: r.transaction.asset ?? 'ZARK',
      payerAddress: r.transaction.payerAddress ?? r.customer?.walletAddress ?? null,
      status: r.status,
      amount: r.amount.toFixed(2),
      reversalFee: r.reversalFee.toFixed(2),
      reason: r.reason,
      expiresAt: r.expiresAt,
      merchantApprovedAt: r.merchantApprovedAt,
      completedAt: r.completedAt,
      refundTxHash: r.refundTxHash,
      refundExplorerUrl: r.refundTxHash ? `${EXPLORER_TX_URL}${r.refundTxHash}` : null,
      createdAt: r.createdAt,
    }));
  }
}

