import { Response, NextFunction } from 'express';
import { AUTH_DISABLED } from './demoAuth.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';

/** Verifiers/admins: comma-separated ADMIN_EMAILS in backend/.env. */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  if (AUTH_DISABLED && email === 'demo@merchantmachine.test') return true; // test mode
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!isAdminEmail(req.user?.email)) {
    return res.status(403).json({ error: 'Only KYC verifiers can do this.' });
  }
  next();
};
