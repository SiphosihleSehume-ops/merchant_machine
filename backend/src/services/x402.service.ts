import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import {
  EVM_ADDRESS_RE,
  HttpError,
  InvoiceQuote,
  PAYMENT_TOKENS,
  PaymentOptionQuote,
  TOKENS,
  zarPerToken,
  zarToTokenAtomic,
} from '../lib/x402.js';
import { decimalsOf } from '../lib/tokenBalance.js';
import { WebhookService } from './webhook.service.js';

export class X402Service {
  static async createIntent(data: any) {
    const { invoiceId, network, payTo } = data;

    // 1. Find the invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.status !== 'PENDING') {
      throw new Error(`Cannot create intent. Invoice is already ${invoice.status}`);
    }

    // 2. Set intent expiry (e.g., 5 minutes)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    // 3. Create Transaction and x402 Intent in a database transaction
    const intent = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create the base transaction
      const transaction = await tx.transaction.create({
        data: {
          invoiceId: invoice.id,
          merchantId: invoice.merchantId,
          amount: invoice.totalAmount,
          currency: invoice.currency,
          type: 'CRYPTO',
          status: 'PENDING', // Awaiting x402 signature
        },
      });

      // Create the x402 intent details
      const x402Intent = await tx.x402PaymentIntent.create({
        data: {
          transactionId: transaction.id,
          merchantId: invoice.merchantId,
          network,
          payTo,
          expiresAt,
        },
      });

      return { transaction, x402Intent };
    });

    return intent;
  }

  /**
   * Loads an invoice (with items and merchant) and checks it can be paid right now.
   * Throws HttpError 404 / 409 / 410 / 422 so the challenge never quotes a stale or
   * unpayable invoice.
   */
  static async getPayableQuote(invoiceId: string): Promise<InvoiceQuote> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true, merchant: true },
    });

    if (!invoice) {
      throw new HttpError(404, 'Invoice not found');
    }

    if (invoice.status !== 'PENDING') {
      throw new HttpError(409, `Invoice is ${invoice.status}`);
    }

    if (invoice.expiresAt <= new Date()) {
      // Lazily record the expiry; conditional so we never overwrite a concurrent PAID.
      await prisma.invoice.updateMany({
        where: { id: invoice.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      throw new HttpError(410, 'Invoice has expired');
    }

    const wallet = invoice.merchant.cryptoWallet;
    if (!wallet || !EVM_ADDRESS_RE.test(wallet)) {
      throw new HttpError(422, 'Merchant has no valid crypto wallet configured');
    }

    // Token decimals are read on-chain (our test tokens use 6, other ERC-20s often 18)
    const options: PaymentOptionQuote[] = (
      await Promise.all(
        PAYMENT_TOKENS.map(async (symbol) => {
          const token = TOKENS[symbol];
          if (!token.address) return null; // not deployed / not configured
          const decimals = await decimalsOf(token.address).catch(() => token.decimals);
          const rate = zarPerToken(symbol);
          return {
            symbol,
            asset: token.address,
            amountAtomic: zarToTokenAtomic(invoice.totalAmount, rate, decimals),
            decimals,
            zarPerToken: rate.toString(),
            eip712: { name: token.eip712Name, version: token.eip712Version },
          };
        }),
      )
    ).filter((o): o is NonNullable<typeof o> => o !== null);
    if (options.length === 0) {
      throw new HttpError(503, 'Payments not configured: no token addresses set');
    }

    const serviceFee = invoice.totalAmount
      .mul(new Prisma.Decimal(invoice.merchant.feePercentage))
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    return {
      invoiceId: invoice.id,
      merchantId: invoice.merchantId,
      merchantName: invoice.merchant.name,
      merchantCategory: invoice.merchant.category,
      payTo: wallet,
      currency: invoice.currency,
      subtotal: invoice.subtotal.toFixed(2),
      totalAmount: invoice.totalAmount.toFixed(2),
      serviceFee: serviceFee.toFixed(2),
      feePercentage: invoice.merchant.feePercentage,
      expiresAt: invoice.expiresAt,
      items: invoice.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        total: item.total.toFixed(2),
      })),
      options,
    };
  }

  /**
   * Claims the invoice for a verified payment before the facilitator settles on-chain.
   * Moves its Transaction to PROCESSING atomically, so two concurrent payers cannot
   * both reach settlement. Returns false if someone else already holds the claim.
   */
  static async claimForSettlement(quote: InvoiceQuote): Promise<boolean> {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Ensure a Transaction exists (the intent endpoint is optional for x402 clients)
      await tx.transaction.upsert({
        where: { invoiceId: quote.invoiceId },
        create: {
          invoiceId: quote.invoiceId,
          merchantId: quote.merchantId,
          amount: new Prisma.Decimal(quote.totalAmount),
          currency: quote.currency,
          type: 'CRYPTO',
          status: 'PENDING',
        },
        update: {},
      });

      // FAILED is claimable again so a customer can retry after a failed settlement
      const claimed = await tx.transaction.updateMany({
        where: { invoiceId: quote.invoiceId, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'PROCESSING' },
      });

      return claimed.count === 1;
    });
  }

  /** Releases a claim when on-chain settlement fails, so the invoice can be retried. */
  static async markSettlementFailed(invoiceId: string, reason?: string) {
    const tx = await prisma.transaction.findUnique({ where: { invoiceId } });
    await prisma.transaction.updateMany({
      where: { invoiceId, status: 'PROCESSING' },
      data: { status: 'FAILED' },
    });
    if (tx) {
      await WebhookService.record(tx.merchantId, 'payment.failed', `payment.failed:${tx.id}`, {
        transactionId: tx.id,
        invoiceId,
        reason: reason ?? 'On-chain settlement failed',
      }).catch(() => undefined);
    }
  }

  /**
   * Records a settled payment: Transaction SETTLED, Invoice PAID, Settlement row,
   * the double-entry ledger split (merchant payable / platform fee), and an idempotent
   * WebhookEvent.
   */
  static async settlePayment(
    invoiceId: string,
    txHash: string,
    opts: { fxSnapshot?: Prisma.Decimal; asset?: string; payer?: string; merchantId?: string } = {},
  ) {
    const payer = opts.payer?.toLowerCase();
    // Link the payment to a customer account if the paying wallet is registered
    const customer = payer
      ? await prisma.customer.findUnique({ where: { walletAddress: payer } })
      : null;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { transaction: true, merchant: true },
    });

    if (!invoice) {
      throw new HttpError(404, 'Invoice not found');
    }

    if (opts.merchantId && invoice.merchantId !== opts.merchantId) {
      throw new HttpError(403, 'You do not have permission to settle this invoice');
    }

    if (invoice.status === 'PAID') {
      throw new HttpError(409, 'Invoice is already paid');
    }

    if (invoice.status !== 'PENDING') {
      throw new HttpError(409, `Invoice is ${invoice.status}`);
    }

    const destination = invoice.merchant.cryptoWallet;
    if (!destination) {
      throw new HttpError(422, 'Merchant has no crypto wallet configured');
    }

    // 2. Calculate fees (PDF Section 3.4) with Decimal arithmetic.
    // The fee is rounded to the ledger precision and the merchant gets the remainder,
    // so the two credits always sum exactly to the invoice total.
    const totalAmount = invoice.totalAmount;
    const feePercentage = new Prisma.Decimal(invoice.merchant.feePercentage);
    const platformFee = totalAmount
      .mul(feePercentage)
      .div(100)
      .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
    const merchantAmount = totalAmount.minus(platformFee);

    // 3. Update DB in a transaction
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Conditional update guards against a concurrent settlement of the same invoice
      const paid = await tx.invoice.updateMany({
        where: { id: invoiceId, status: { not: 'PAID' } },
        data: { status: 'PAID' },
      });
      if (paid.count !== 1) {
        throw new HttpError(409, 'Invoice is already paid');
      }

      const baseTransaction =
        invoice.transaction ??
        (await tx.transaction.create({
          data: {
            invoiceId: invoice.id,
            merchantId: invoice.merchantId,
            amount: invoice.totalAmount,
            currency: invoice.currency,
            type: 'CRYPTO',
            status: 'PENDING',
          },
        }));

      const updatedTransaction = await tx.transaction.update({
        where: { id: baseTransaction.id },
        data: {
          status: 'SETTLED',
          asset: opts.asset ?? baseTransaction.asset ?? 'ZARK',
          payerAddress: payer ?? baseTransaction.payerAddress,
          customerId: customer?.id ?? baseTransaction.customerId,
          idempotencyKey: `settle:${invoice.id}`,
        },
      });

      await tx.settlement.create({
        data: {
          transactionId: updatedTransaction.id,
          destination,
          rail: 'X402_FACILITATOR',
          txHash,
          fxSnapshot: opts.fxSnapshot,
        },
      });

      // Create Double-Entry Ledger Records (PDF Section 3.8)
      await tx.ledgerEntry.create({
        data: {
          merchantId: invoice.merchantId,
          transactionId: updatedTransaction.id,
          account: 'MERCHANT_PAYABLE',
          type: 'CREDIT',
          amount: merchantAmount,
          description: `Payment for Invoice #${invoice.id.substring(0, 8)}`,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          merchantId: invoice.merchantId,
          transactionId: updatedTransaction.id,
          account: 'PLATFORM_FEE',
          type: 'CREDIT',
          amount: platformFee,
          description: `${feePercentage.toString()}% Service Fee for Invoice #${invoice.id.substring(0, 8)}`,
        },
      });

      await WebhookService.record(
        invoice.merchantId,
        'payment.settled',
        `payment.settled:${updatedTransaction.id}`,
        {
          transactionId: updatedTransaction.id,
          invoiceId: invoice.id,
          amount: totalAmount.toFixed(2),
          serviceFee: platformFee.toFixed(2),
          netAmount: merchantAmount.toFixed(2),
          currency: invoice.currency,
          asset: updatedTransaction.asset,
          txHash,
        },
        tx,
      );

      return updatedTransaction;
    });

    return result;
  }
}
