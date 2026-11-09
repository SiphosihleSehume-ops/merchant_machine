import { Request, Response } from 'express';
import { MerchantService } from '../services/merchant.service.js';
import { createMerchantSchema } from '../lib/validators.js';

export class MerchantController {
  static async register(req: Request, res: Response) {
    try {
      // 1. Validate request body
      const validatedData = createMerchantSchema.parse({ body: req.body });

      // 2. Call service
      const merchant = await MerchantService.registerMerchant(validatedData.body);
      
      // 3. Send response
      res.status(201).json({
        success: true,
        message: 'Merchant registered successfully',
        data: merchant,
      });
    } catch (error: any) {
      // Handle Zod validation errors
      if (error instanceof Error && 'errors' in error) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: (error as any).errors,
        });
      }

      res.status(400).json({
        success: false,
        error: error.message || 'Registration failed',
      });
    }
  }
}