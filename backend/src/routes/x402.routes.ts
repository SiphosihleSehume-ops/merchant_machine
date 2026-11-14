import { Router } from 'express';
import { X402Controller } from '../controllers/x402.controller.js';
import { AuthRequest, authenticateToken, optionalAuth } from '../middleware/auth.middleware.js';
import { claimInvoice, loadPayableInvoice, x402InvoicePayment } from '../middleware/x402.middleware.js';
import { handle } from '../lib/http.js';
import { HttpError } from '../lib/x402.js';
import { DirectPayService } from '../services/directPay.service.js';

const router = Router();

// 1. Create the database intent (requires authenticated session)
router.post('/intent', authenticateToken, X402Controller.createIntent);

// 2. The x402 challenge (402 with real merchant/invoice) and verified payment
router.get('/pay/:invoiceId', loadPayableInvoice, x402InvoicePayment, claimInvoice, X402Controller.payInvoice);

// 3. Manual/fallback settlement (requires authenticated session + valid 32-byte txHash)
router.post('/settle/:invoiceId', authenticateToken, X402Controller.settlePayment);

// 4. Direct ZARK payment (any ERC-20, customer pays gas):
//    GET receipt shown before Confirm, then POST the tx hash for on-chain verification
router.get('/invoice/:invoiceId', handle(async (req, res) => {
  res.json({ success: true, data: await DirectPayService.receipt(req.params.invoiceId as string) });
}));
router.post('/invoice/:invoiceId/transfer', optionalAuth, handle<AuthRequest>(async (req, res) => {
  const txHash = String(req.body?.txHash ?? '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new HttpError(400, 'A valid transaction hash is required');
  // A signed-in customer gets the payment linked to their account (shows under Refunds)
  const customerId = req.user?.role === 'CUSTOMER' ? req.user.customerId : undefined;
  res.json({ success: true, data: await DirectPayService.confirm(req.params.invoiceId as string, txHash as `0x${string}`, customerId) });
}));

export default router;