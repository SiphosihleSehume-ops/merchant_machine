import { Router } from 'express';
import { handle } from '../lib/http.js';
import { customerKycSchema, linkWalletSchema } from '../lib/validators.js';
import { AuthRequest, authenticateToken, requireRole } from '../middleware/auth.middleware.js';
import { CustomerService } from '../services/customer.service.js';

const router = Router();

// GET /api/v1/customers/me  -> customer profile, linked wallet, and KYC tier limits
router.get('/me', authenticateToken, requireRole('CUSTOMER'), handle<AuthRequest>(async (req, res) => {
  const data = await CustomerService.getProfile(req.user!.userId, req.user!.customerId!);
  res.json({ success: true, data });
}));

// POST /api/v1/customers/me/kyc  { fullName, countryCode?, popiaConsent: true }
router.post('/me/kyc', authenticateToken, requireRole('CUSTOMER'), handle<AuthRequest>(async (req, res) => {
  const input = customerKycSchema.parse(req.body);
  const data = await CustomerService.submitKyc(req.user!.userId, req.user!.customerId!, input);
  res.json({ success: true, data });
}));

// PUT /api/v1/customers/me/wallet  { address, issuedAt, signature }
// Links a MetaMask wallet after verifying a personal_sign ownership proof.
router.put('/me/wallet', authenticateToken, requireRole('CUSTOMER'), handle<AuthRequest>(async (req, res) => {
  const input = linkWalletSchema.parse(req.body);
  const customer = await CustomerService.linkWallet(req.user!.userId, req.user!.customerId!, input);
  res.json({ success: true, data: { walletAddress: customer.walletAddress } });
}));

export default router;
