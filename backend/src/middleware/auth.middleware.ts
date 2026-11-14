import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AUTH_DISABLED, demoUserFor } from '../lib/demoAuth.js';
import { prisma } from '../lib/prisma.js';

/**
 * A token can outlive its account (e.g. the database was reset). Check the user and the
 * profile the token refers to still exist, so stale sessions get a clean 401 instead of
 * crashing deeper in the request.
 */
async function sessionStillValid(p: AuthTokenPayload): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: p.userId },
    select: { merchant: { select: { id: true } }, customer: { select: { id: true } } },
  });
  if (!user) return false;
  if (p.merchantId && user.merchant?.id !== p.merchantId) return false;
  if (p.customerId && user.customer?.id !== p.customerId) return false;
  return true;
}

const SESSION_INVALID = { error: 'Your session is no longer valid. Please sign in again.', code: 'SESSION_INVALID' };

/** Verifies a JWT and the account behind it, then continues or answers 401/403. */
function acceptToken(token: string, req: AuthRequest, res: Response, next: NextFunction) {
  let payload: AuthTokenPayload;
  try {
    payload = jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
  sessionStillValid(payload)
    .then((ok) => {
      if (!ok) return res.status(401).json(SESSION_INVALID);
      req.user = payload;
      next();
    })
    .catch((error) => {
      console.error('[auth] session check failed', error);
      res.status(500).json({ error: 'Could not verify your session' });
    });
}

export type ActiveRole = 'MERCHANT' | 'CUSTOMER';

export interface AuthTokenPayload {
  userId: string;
  email?: string;
  /** Role chosen on the role picker for this session; absent until chosen. */
  role?: ActiveRole;
  merchantId?: string;
  customerId?: string;
  /** Set only for the shared test-mode demo user (AUTH_DISABLED). */
  demo?: boolean;
}

// Extend the Express Request type so we can attach the user data to it
export interface AuthRequest extends Request {
  user?: AuthTokenPayload;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || (AUTH_DISABLED ? 'auth-disabled-dev-secret' : undefined);
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '24h' });
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  // 1. Get the token from the Authorization header (Format: "Bearer <token>")
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // TEMPORARY TEST MODE: no/invalid token -> act as the demo user (see lib/demoAuth.ts)
  if (AUTH_DISABLED) {
    // A real signed-in session still wins over the demo user
    if (token) {
      try {
        jwt.verify(token, getJwtSecret());
        return acceptToken(token, req, res, next);
      } catch {
        /* invalid token: fall through to demo user */
      }
    }
    return demoUserFor(req.headers['x-demo-role'])
      .then((user) => {
        req.user = user;
        next();
      })
      .catch((error) => {
        console.error('[auth] could not create demo user', error);
        res.status(500).json({ error: 'Demo user unavailable' });
      });
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  // 2. Verify the token and that its account still exists, then attach it to the request
  return acceptToken(token, req, res, next);
};

/** Requires the session's active role (set via the role picker). */
export const requireRole = (role: ActiveRole) => (req: AuthRequest, res: Response, next: NextFunction) => {
  const user = req.user;
  const profileId = role === 'MERCHANT' ? user?.merchantId : user?.customerId;
  if (user?.role !== role || !profileId) {
    return res.status(403).json({ error: `This action requires the ${role.toLowerCase()} role.` });
  }
  next();
};

/** Blocks the shared test-mode demo user: the action needs a real, signed-in account. */
export const requireRegisteredAccount = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.demo) {
    return res.status(403).json({
      error: 'Sign in with a registered account to use devices.',
      code: 'REGISTERED_ACCOUNT_REQUIRED',
    });
  }
  next();
};

/**
 * Optional sign-in for public endpoints (e.g. paying an invoice): attaches the user when a
 * valid token is sent, and otherwise just continues. Never rejects the request.
 */
export const optionalAuth = (req: AuthRequest, _res: Response, next: NextFunction) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return next();
  try {
    req.user = jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
  } catch {
    /* ignore invalid tokens on public endpoints */
  }
  next();
};
