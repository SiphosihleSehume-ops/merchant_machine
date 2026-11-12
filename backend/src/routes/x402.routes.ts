import { Router } from 'express';
import { X402Controller } from '../controllers/x402.controller.js';

const router = Router();

// 1. Create the database intent
router.post('/intent', X402Controller.createIntent);

// 2. The x402 challenge (Returns 402)
router.get('/pay/:invoiceId', X402Controller.payInvoice);

// 3. Settle the payment (Updates Ledger)
router.post('/settle/:invoiceId', X402Controller.settlePayment);

export default router;