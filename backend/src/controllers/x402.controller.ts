import { Request, Response } from 'express';
import { X402Service } from '../services/x402.service.js';
import { createIntentSchema, settlePaymentSchema } from '../lib/validators.js';
import { currentQuote, HttpError } from '../lib/x402.js';
import { AuthRequest } from '../middleware/auth.middleware.js';

export class X402Controller {
  // 1. Creates the database record for the payment intent
  static async createIntent(req: AuthRequest, res: Response) {
    try {
      const validatedData = createIntentSchema.parse({ body: req.body });
      const intent = await X402Service.createIntent(validatedData.body);

      res.status(201).json({
        success: true,
        message: 'x402 Payment Intent created successfully',
        data: intent,
      });
    } catch (error: any) {
      if (error instanceof Error && 'errors' in error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: (error as any).errors,
        });
      }

      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create intent',
      });
    }
  }

  // 2. Runs only after @x402/express has verified the payment signature and the
  //    invoice has been claimed. The facilitator settles on-chain once this responds,
  //    and the onAfterSettle hook writes the ledger.
  static async payInvoice(req: Request, res: Response) {
    const quote = currentQuote();
    res.status(200).json({
      success: true,
      message: 'Payment verified; settlement in progress',
      data: {
        invoiceId: quote.invoiceId,
        merchantName: quote.merchantName,
        items: quote.items,
        subtotal: quote.subtotal,
        serviceFee: quote.serviceFee,
        feePercentage: quote.feePercentage,
        total: quote.totalAmount,
        currency: quote.currency,
        // The on-chain tx hash is returned in the PAYMENT-RESPONSE header
      },
    });
  }

  // 3. Settles the payment and updates the double-entry ledger (authenticated fallback)
  static async settlePayment(req: AuthRequest, res: Response) {
    try {
      const invoiceId = req.params.invoiceId as string;
      const { txHash } = settlePaymentSchema.parse(req.body);

      const transaction = await X402Service.settlePayment(invoiceId, txHash, {
        merchantId: req.user?.role === 'MERCHANT' ? req.user.merchantId : undefined,
      });

      res.status(200).json({
        success: true,
        message: 'Payment settled successfully and ledger updated',
        data: transaction,
      });
    } catch (error: any) {
      if (error instanceof Error && 'errors' in error) {
        return res.status(400).json({
          success: false,
          error: (error as any).errors[0]?.message || 'Validation failed',
          details: (error as any).errors,
        });
      }
      const status = error instanceof HttpError ? error.status : 400;
      res.status(status).json({
        success: false,
        error: error.message || 'Failed to settle payment',
      });
    }
  }
}