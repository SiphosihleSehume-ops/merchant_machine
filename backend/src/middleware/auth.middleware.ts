import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extend the Express Request type so we can attach the user data to it
export interface AuthRequest extends Request {
  user?: {
    userId: string;
    merchantId: string;
    role: string;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  // 1. Get the token from the Authorization header (Format: "Bearer <token>")
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    // 2. Verify the token using our secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    
    // 3. Attach the decoded user data (userId, merchantId, role) to the request
    req.user = decoded;
    
    // 4. Let the request continue to the actual route
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
};