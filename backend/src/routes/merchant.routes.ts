import { Router } from 'express';
import { MerchantController } from '../controllers/merchant.controller.js';
import { handle } from '../lib/http.js';
import { AuthRequest, authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import { MerchantService } from '../services/merchant.service.js';
import { WebhookService } from '../services/webhook.service.js';

const router = Router();

// POST /api/v1/merchants/register & /login
router.post('/register', MerchantController.register);
router.post('/login', MerchantController.login);

// GET /api/v1/merchants/me/ledger -> double-entry balances and entries
router.get('/me/ledger', authenticateToken, requireRole('MERCHANT'), handle<AuthRequest>(async (req, res) => {
  const data = await MerchantService.getLedgerSummary(req.user!.merchantId!);
  res.json({ success: true, data });
}));

// GET /api/v1/merchants/me/webhooks -> idempotent webhook event log
router.get('/me/webhooks', authenticateToken, requireRole('MERCHANT'), handle<AuthRequest>(async (req, res) => {
  const data = await WebhookService.listForMerchant(req.user!.merchantId!);
  res.json({ success: true, data });
}));

export default router;