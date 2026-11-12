import { Router } from 'express';
import { handle } from '../lib/http.js';
import { createReversalSchema } from '../lib/validators.js';
import { AuthRequest, authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import { PaymentsService } from '../services/payments.service.js';
import { HttpError } from '../lib/x402.js';

function activeAuth(req: AuthRequest) {
  const u = req.user!;
  if (!u.role) throw new HttpError(403, 'Choose a role first', 'ROLE_REQUIRED');
  return { role: u.role, merchantId: u.merchantId, customerId: u.customerId };
}

// GET /api/v1/transactions  (scoped to the active merchant or customer)
export const transactionsRouter = Router();
transactionsRouter.get('/', authenticateToken, handle<AuthRequest>(async (req, res) => {
  res.json({ success: true, data: await PaymentsService.listTransactions(activeAuth(req)) });
}));

// /api/v1/reversals
export const reversalsRouter = Router();
reversalsRouter.get('/', authenticateToken, handle<AuthRequest>(async (req, res) => {
  res.json({ success: true, data: await PaymentsService.listReversals(activeAuth(req)) });
}));
reversalsRouter.post('/', authenticateToken, requireRole('CUSTOMER'), handle<AuthRequest>(async (req, res) => {
  const input = createReversalSchema.parse(req.body);
  const reversal = await PaymentsService.requestReversal(req.user!.customerId!, input);
  res.status(201).json({ success: true, data: reversal });
}));
