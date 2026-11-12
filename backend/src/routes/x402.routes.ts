import { Router } from 'express';
import { X402Controller } from '../controllers/x402.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { claimInvoice, loadPayableInvoice, x402InvoicePayment } from '../middleware/x402.middleware.js';

const router = Router();

// 1. Create the database intent (requires authenticated session)
router.post('/intent', authenticateToken, X402Controller.createIntent);

// 2. The x402 challenge (402 with real merchant/invoice) and verified payment
router.get('/pay/:invoiceId', loadPayableInvoice, x402InvoicePayment, claimInvoice, X402Controller.payInvoice);

// 3. Manual/fallback settlement (requires authenticated session + valid 32-byte txHash)
router.post('/settle/:invoiceId', authenticateToken, X402Controller.settlePayment);

export default router;