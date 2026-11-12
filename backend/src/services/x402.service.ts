import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';

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
  } // <-- CLOSING BRACE FOR createIntent

  // NEW METHOD STARTS HERE
  static async settlePayment(invoiceId: string, txHash: string) {
    // 1. Find the invoice and its transaction
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { transaction: true },
    });

    if (!invoice || !invoice.transaction) {
      throw new Error('Invoice or Transaction not found');
    }

    if (invoice.status === 'PAID') {
      throw new Error('Invoice is already paid');
    }

    // 2. Calculate fees (PDF Section 3.4)
    const totalAmount = invoice.totalAmount;
    const feePercentage = 3.0;
    const platformFee = totalAmount * (feePercentage / 100);
    const merchantAmount = totalAmount - platformFee;

    // 3. Update DB in a transaction
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Update Transaction
      const updatedTransaction = await tx.transaction.update({
        where: { id: invoice.transaction!.id },
        data: { status: 'SETTLED' },
      });

      // Update Invoice
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID' },
      });

      // Create Settlement record
      await tx.settlement.create({
        data: {
          transactionId: updatedTransaction.id,
          destination: '0xMerchantWalletAddressHere', // In reality, pull from Merchant profile
          rail: 'X402_FACILITATOR',
          txHash: txHash,
        },
      });

      // Create Double-Entry Ledger Records (PDF Section 3.8)
      // Credit the Merchant Payable Account
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

      // Credit the Platform Fee Account
      await tx.ledgerEntry.create({
        data: {
          merchantId: invoice.merchantId,
          transactionId: updatedTransaction.id,
          account: 'PLATFORM_FEE',
          type: 'CREDIT',
          amount: platformFee,
          description: `3% Fee for Invoice #${invoice.id.substring(0, 8)}`,
        },
      });

      return updatedTransaction;
    });

    return result;
  } // <-- CLOSING BRACE FOR settlePayment
} // <-- CLOSING BRACE FOR CLASS