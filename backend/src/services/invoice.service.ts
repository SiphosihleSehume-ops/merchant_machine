import { prisma } from '../lib/prisma.js';

export class InvoiceService {
  static async createInvoice(data: any) {
    const { merchantId, currency, items } = data;

    // 1. Verify the merchant exists
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    // 2. Calculate totals on the server (PDF Section 3.5)
    let subtotal = 0;
    const invoiceItemsData = items.map((item: any) => {
      const itemTotal = item.quantity * item.unitPrice;
      subtotal += itemTotal;
      
      return {
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: itemTotal,
      };
    });

    // 3. Set expiry (e.g., 15 minutes from now)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    // 4. Create the Invoice and nested Items in Prisma
    const invoice = await prisma.invoice.create({
      data: {
        merchantId,
        currency,
        subtotal,
        totalAmount: subtotal, // Assuming no additional tax for now
        expiresAt,
        items: {
          create: invoiceItemsData,
        },
      },
      include: {
        items: true, // Return the items in the response
      },
    });

    return invoice;
  }

  /** Merchant-scoped invoice lookup (used to poll payment status on the QR screen). */
  static async getForMerchant(invoiceId: string, merchantId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, merchantId },
      include: { items: true, transaction: { include: { settlement: true } } },
    });
    if (!invoice) return null;
    const expired = invoice.status === 'PENDING' && invoice.expiresAt <= new Date();
    return {
      id: invoice.id,
      status: expired ? 'EXPIRED' : invoice.status,
      totalAmount: invoice.totalAmount.toFixed(2),
      currency: invoice.currency,
      expiresAt: invoice.expiresAt,
      items: invoice.items,
      payment: invoice.transaction
        ? {
            status: invoice.transaction.status,
            asset: invoice.transaction.asset,
            payerAddress: invoice.transaction.payerAddress,
            txHash: invoice.transaction.settlement?.txHash ?? null,
          }
        : null,
    };
  }
}
