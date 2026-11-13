import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from './prisma.js';
import type { ActiveRole, AuthTokenPayload } from '../middleware/auth.middleware.js';

/**
 * TEMPORARY TEST MODE: AUTH_DISABLED=true skips sign-in so other features can be tested.
 *
 * Every request without a valid token acts as one shared demo user that owns BOTH a
 * merchant and a customer profile. The frontend picks the active side with the
 * `x-demo-role: MERCHANT | CUSTOMER` header. Never honoured when NODE_ENV=production.
 *
 * To re-enable auth: remove AUTH_DISABLED (backend) and NEXT_PUBLIC_AUTH_DISABLED (frontend).
 */
export const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true' && process.env.NODE_ENV !== 'production';

if (process.env.AUTH_DISABLED === 'true' && process.env.NODE_ENV === 'production') {
  console.error('[auth] AUTH_DISABLED is ignored in production. Authentication stays ON.');
} else if (AUTH_DISABLED) {
  console.warn('\n[auth] ⚠️  AUTH_DISABLED=true: authentication is OFF. All requests act as the demo user.\n');
}

const DEMO_EMAIL = 'demo@merchantmachine.test';

type DemoIdentity = { userId: string; merchantId: string; customerId: string };
let demo: Promise<DemoIdentity> | null = null;

/** Creates (once) the demo user with a merchant and a customer profile. */
function ensureDemoIdentity(): Promise<DemoIdentity> {
  demo ??= (async () => {
    const wallet = process.env.DEMO_MERCHANT_WALLET?.trim() || null;
    const user = await prisma.user.upsert({
      where: { email: DEMO_EMAIL },
      update: {},
      create: {
        email: DEMO_EMAIL,
        // Random unusable password: the demo user can't sign in once auth is back on
        passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
        emailVerifiedAt: new Date(),
        role: 'MERCHANT',
      },
    });
    const merchant = await prisma.merchant.upsert({
      where: { userId: user.id },
      update: wallet ? { cryptoWallet: wallet } : {},
      create: {
        userId: user.id,
        name: process.env.DEMO_MERCHANT_NAME || 'Demo Shop',
        cryptoWallet: wallet,
        feePercentage: 3.0,
      },
    });
    const customer = await prisma.customer.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
    return { userId: user.id, merchantId: merchant.id, customerId: customer.id };
  })().catch((error) => {
    demo = null; // retry on next request
    throw error;
  });
  return demo;
}

export async function demoUserFor(roleHeader: unknown): Promise<AuthTokenPayload> {
  const role: ActiveRole = roleHeader === 'CUSTOMER' ? 'CUSTOMER' : 'MERCHANT';
  const id = await ensureDemoIdentity();
  return {
    userId: id.userId,
    email: DEMO_EMAIL,
    demo: true,
    role,
    merchantId: role === 'MERCHANT' ? id.merchantId : undefined,
    customerId: role === 'CUSTOMER' ? id.customerId : undefined,
  };
}
