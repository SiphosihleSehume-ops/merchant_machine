import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type ActiveRole = 'MERCHANT' | 'CUSTOMER';

export interface AuthTokenPayload {
  userId: string;
  email?: string;
  /** Role chosen on the role picker for this session; absent until chosen. */
  role?: ActiveRole;
  merchantId?: string;
  customerId?: string;
}

// Extend the Express Request type so we can attach the user data to it
export interface AuthRequest extends Request {
  user?: AuthTokenPayload;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
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

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    // 2. Verify the token and attach the decoded user data to the request
    req.user = jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
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
