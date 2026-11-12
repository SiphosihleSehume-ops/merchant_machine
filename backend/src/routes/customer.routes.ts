import { Router } from 'express';
import { handle } from '../lib/http.js';
import { linkWalletSchema } from '../lib/validators.js';
import { AuthRequest, authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import { CustomerService } from '../services/customer.service.js';

const router = Router();

// PUT /api/v1/customers/me/wallet  { address, issuedAt, signature }
// Links a MetaMask wallet after verifying a personal_sign ownership proof.
router.put('/me/wallet', authenticateToken, requireRole('CUSTOMER'), handle<AuthRequest>(async (req, res) => {
  const input = linkWalletSchema.parse(req.body);
  const customer = await CustomerService.linkWallet(req.user!.userId, req.user!.customerId!, input);
  res.json({ success: true, data: { walletAddress: customer.walletAddress } });
}));

export default router;
