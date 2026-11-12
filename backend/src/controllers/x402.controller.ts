import { Request, Response } from 'express';
import { X402Service } from '../services/x402.service.js';
import { createIntentSchema } from '../lib/validators.js';

export class X402Controller {
  // 1. Creates the database record for the payment intent
  static async createIntent(req: Request, res: Response) {
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

  // 2. Simulates the x402 middleware challenge (Returns 402 Payment Required)
  static async payInvoice(req: Request, res: Response) {
    try {
      // FIX: Cast params to string
      const invoiceId = req.params.invoiceId as string;
      
      // In a real implementation, the @x402/express middleware 
      // handles this automatically.
      // For now, we simulate the 402 response.
      
      res.status(402).json({
        error: 'Payment Required',
        message: 'This resource requires payment.',
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:84532', // Base Sepolia
            maxAmountRequired: '116000000', // 116 ZAR in USDC decimals (mock)
            resource: `http://localhost:4000/api/v1/x402/pay/${invoiceId}`,
            description: 'Cape Town Coffee Co. Invoice',
            mimeType: 'application/json',
            payTo: '0x1234567890abcdef1234567890abcdef12345678', // Merchant Wallet
            maxTimeoutSeconds: 300,
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC Contract
            extra: null
          }
        ]
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // 3. Settles the payment and updates the double-entry ledger
  static async settlePayment(req: Request, res: Response) {
    try {
      // FIX: Cast params to string
      const invoiceId = req.params.invoiceId as string; 
      const { txHash } = req.body;

      if (!txHash) {
        return res.status(400).json({ 
          success: false,
          error: 'txHash is required to settle the payment' 
        });
      }

      const transaction = await X402Service.settlePayment(invoiceId, txHash);

      res.status(200).json({
        success: true,
        message: 'Payment settled successfully and ledger updated',
        data: transaction,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to settle payment',
      });
    }
  }
}