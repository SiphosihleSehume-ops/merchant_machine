import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { EXPLORER_TX_URL, HttpError } from '../lib/x402.js';
import { ActiveRole } from '../middleware/auth.middleware.js';

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
    items: tx.invoice?.items.map((i) => ({ name: i.name, quantity: i.quantity, total: i.total.toFixed(2) })) ?? [],
    txHash: tx.settlement?.txHash ?? null,
    explorerUrl: tx.settlement?.txHash ? `${EXPLORER_TX_URL}${tx.settlement.txHash}` : null,
    reversal: tx.reversal
      ? {
          id: tx.reversal.id,
          status: tx.reversal.status,
          amount: tx.reversal.amount.toFixed(2),
          reversalFee: tx.reversal.reversalFee.toFixed(2),
          expiresAt: tx.reversal.expiresAt,
        }
      : null,
  };
}

async function customerScope(customerId: string): Promise<Prisma.TransactionWhereInput> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  // Payments are linked by account, or by the wallet that paid (before linking)
  return {
    OR: [
      { customerId },
      ...(customer.walletAddress ? [{ payerAddress: customer.walletAddress }] : []),
    ],
  };
}

export class PaymentsService {
  static async listTransactions(auth: { role: ActiveRole; merchantId?: string; customerId?: string }) {
    const where =
      auth.role === 'MERCHANT'
        ? { merchantId: auth.merchantId! }
        : await customerScope(auth.customerId!);

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
   * reversal amount is the payment minus that fee. The merchant must respond before expiresAt.
   */
  static async requestReversal(customerId: string, input: { transactionId: string; reason?: string }) {
    const scope = await customerScope(customerId);
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
    const now = new Date();

    try {
      const reversal = await prisma.$transaction(async (db) => {
        if (!tx.customerId) {
          await db.transaction.update({ where: { id: tx.id }, data: { customerId } });
        }
        return db.reversal.create({
          data: {
            transactionId: tx.id,
            merchantId: tx.merchantId,
            customerId,
            amount: tx.amount.minus(fee),
            reversalFee: fee,
            reason: input.reason,
            feeAcknowledgedAt: now,
            expiresAt: new Date(now.getTime() + REVERSAL_APPROVAL_MS),
          },
        });
      });
      return {
        id: reversal.id,
        status: reversal.status,
        amount: reversal.amount.toFixed(2),
        reversalFee: reversal.reversalFee.toFixed(2),
        expiresAt: reversal.expiresAt,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'A reversal already exists for this payment');
      }
      throw error;
    }
  }

  static async listReversals(auth: { role: ActiveRole; merchantId?: string; customerId?: string }) {
    const where = auth.role === 'MERCHANT' ? { merchantId: auth.merchantId! } : { customerId: auth.customerId! };
    const rows = await prisma.reversal.findMany({
      where,
      include: { transaction: { include: { merchant: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      transactionId: r.transactionId,
      merchantName: r.transaction.merchant.name,
      status: r.status,
      amount: r.amount.toFixed(2),
      reversalFee: r.reversalFee.toFixed(2),
      reason: r.reason,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  }
}

