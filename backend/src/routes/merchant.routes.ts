import { Router } from 'express';
import { MerchantController } from '../controllers/merchant.controller.js';

const router = Router();

// POST /api/v1/merchants/register
router.post('/register', MerchantController.register);

export default router;