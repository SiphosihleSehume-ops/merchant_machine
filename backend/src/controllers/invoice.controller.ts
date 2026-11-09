import { Request, Response } from 'express';
import { InvoiceService } from '../services/invoice.service.js';
import { createInvoiceSchema } from '../lib/validators.js';

export class InvoiceController {
  static async create(req: Request, res: Response) {
    try {
      // 1. Validate input
      const validatedData = createInvoiceSchema.parse({ body: req.body });

      // 2. Call Service
      const invoice = await InvoiceService.createInvoice(validatedData.body);

      // 3. Return response
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