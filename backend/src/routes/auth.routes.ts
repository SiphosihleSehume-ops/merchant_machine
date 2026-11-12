import { Router } from 'express';
import { handle } from '../lib/http.js';
import {
  emailOnlySchema,
  loginSchema,
  registerSchema,
  selectRoleSchema,
  verifyEmailSchema,
} from '../lib/validators.js';
import { AuthRequest, authenticateToken } from '../middleware/auth.middleware.js';
import { AuthService } from '../services/auth.service.js';

const router = Router();

// POST /api/v1/auth/register  { email, password } -> sends verification email
router.post('/register', handle(async (req, res) => {
  const { email, password } = registerSchema.parse(req.body);
  res.status(201).json({ success: true, data: await AuthService.register(email, password) });
}));

// POST /api/v1/auth/resend-verification  { email }
router.post('/resend-verification', handle(async (req, res) => {
  const { email } = emailOnlySchema.parse(req.body);
  res.json({ success: true, data: await AuthService.resendVerification(email) });
}));

// POST /api/v1/auth/verify-email  { token }
router.post('/verify-email', handle(async (req, res) => {
  const { token } = verifyEmailSchema.parse(req.body);
  res.json({ success: true, data: await AuthService.verifyEmail(token) });
}));

// POST /api/v1/auth/login  { email, password } -> session without an active role
router.post('/login', handle(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  res.json({ success: true, data: await AuthService.login(email, password) });
}));

// POST /api/v1/auth/select-role  { role, businessName?, cryptoWallet? } -> new token with role
router.post('/select-role', authenticateToken, handle<AuthRequest>(async (req, res) => {
  const input = selectRoleSchema.parse(req.body);
  res.json({ success: true, data: await AuthService.selectRole(req.user!.userId, input) });
}));

// GET /api/v1/auth/me
router.get('/me', authenticateToken, handle<AuthRequest>(async (req, res) => {
  res.json({ success: true, data: await AuthService.me(req.user!.userId, req.user!.role) });
}));

export default router;
