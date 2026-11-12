import { Request, Response } from 'express';
import { InvoiceService } from '../services/invoice.service.js';
import { createInvoiceSchema } from '../lib/validators.js';
import { AuthRequest } from '../middleware/auth.middleware.js';

export class InvoiceController {
  static async create(req: AuthRequest, res: Response) {
    try {
      // 1. Validate input
      const validatedData = createInvoiceSchema.parse({ body: req.body });

      // 2. Attach merchantId from the authenticated user to the invoice data
      const secureData = {
        ...validatedData.body,
        merchantId: req.user?.merchantId as string, 
      };

      // 3. Call Service
      const invoice = await InvoiceService.createInvoice(secureData);

      // 4. Return response
      res.status(201).json({
        success: true,
        message: 'Invoice created successfully',
        data: invoice,
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
        error: error.message || 'Failed to create invoice',
      });
    }
  }
}