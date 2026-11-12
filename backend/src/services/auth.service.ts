import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { sendVerificationEmail } from '../lib/mailer.js';
import { EVM_ADDRESS_RE, HttpError } from '../lib/x402.js';
import { ActiveRole, signToken } from '../middleware/auth.middleware.js';

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

// Same message whether or not the email exists, to avoid account enumeration
const GENERIC_SENT = 'If that email can be used, a verification link has been sent.';

// Real hash so bcrypt.compare does equal work for unknown emails
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

async function issueVerification(userId: string, email: string) {
  const recent = await prisma.emailVerificationToken.findFirst({
    where: { userId, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
  });
  if (recent) return; // throttle resends

  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    },
  });
  await sendVerificationEmail(email, token);
}

async function sessionFor(userId: string, role?: ActiveRole) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { merchant: true, customer: true },
  });

  const token = signToken({
    userId: user.id,
    email: user.email,
    role,
    merchantId: role === 'MERCHANT' ? user.merchant?.id : undefined,
    customerId: role === 'CUSTOMER' ? user.customer?.id : undefined,
  });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: role ?? null,
      hasMerchantProfile: !!user.merchant,
      hasCustomerProfile: !!user.customer,
      merchant: user.merchant
        ? { id: user.merchant.id, name: user.merchant.name, cryptoWallet: user.merchant.cryptoWallet, feePercentage: user.merchant.feePercentage }
        : null,
      customer: user.customer ? { id: user.customer.id, walletAddress: user.customer.walletAddress } : null,
    },
  };
}

export class AuthService {
  static async register(email: string, password: string) {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      // Unverified: resend. Verified: say nothing (no enumeration).
      if (!existing.emailVerifiedAt) await issueVerification(existing.id, email);
      return { message: GENERIC_SENT };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, passwordHash } });
    await issueVerification(user.id, email);
    return { message: GENERIC_SENT };
  }

  static async resendVerification(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) await issueVerification(user.id, email);
    return { message: GENERIC_SENT };
  }

  static async verifyEmail(token: string) {
    const record = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new HttpError(400, 'This verification link is invalid or has expired.', 'INVALID_TOKEN');
    }

    await prisma.$transaction([
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);

    return { message: 'Email verified. You can now sign in.' };
  }

  static async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    // Compare even when the user is missing to keep timing similar
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (!user.emailVerifiedAt) {
      throw new HttpError(403, 'Please verify your email before signing in.', 'EMAIL_NOT_VERIFIED');
    }

    // No active role yet: the frontend shows the role picker next
    return sessionFor(user.id);
  }

  /** Role picker: activates (and on first use creates) the merchant or customer profile. */
  static async selectRole(
    userId: string,
    input: { role: 'CUSTOMER' } | { role: 'MERCHANT'; businessName?: string; cryptoWallet?: string },
  ) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { merchant: true, customer: true },
    });

    if (input.role === 'MERCHANT' && !user.merchant) {
      if (!input.businessName) {
        throw new HttpError(400, 'Business name is required to set up your merchant profile', 'BUSINESS_NAME_REQUIRED');
      }
      if (!input.cryptoWallet || !EVM_ADDRESS_RE.test(input.cryptoWallet)) {
        throw new HttpError(400, 'A wallet address to receive payments is required', 'WALLET_REQUIRED');
      }
      await prisma.merchant.create({
        data: { userId, name: input.businessName, cryptoWallet: input.cryptoWallet, feePercentage: 3.0 },
      });
    }

    if (input.role === 'CUSTOMER' && !user.customer) {
      await prisma.customer.create({ data: { userId } });
    }

    await prisma.user.update({ where: { id: userId }, data: { role: input.role } });
    return sessionFor(userId, input.role);
  }

  static async me(userId: string, role?: ActiveRole) {
    const { user } = await sessionFor(userId, role);
    return user;
  }
}
