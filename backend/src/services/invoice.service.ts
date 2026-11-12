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
}