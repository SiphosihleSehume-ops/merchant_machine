import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { APP_URL, sendVerificationEmail } from '../lib/mailer.js';
import { EVM_ADDRESS_RE, HttpError } from '../lib/x402.js';
import { ActiveRole, signToken } from '../middleware/auth.middleware.js';
import { isAdminEmail } from '../lib/admin.js';

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFY_OTP_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 15 * 1000;

// Same message whether or not the email exists, to avoid account enumeration
const GENERIC_SENT = 'We sent a 6-digit verification code to your email.';

// Real hash so bcrypt.compare does equal work for unknown emails
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const otpHash = (userId: string, otp: string) => sha256(`otp:${userId}:${otp}`);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEV_MAIL_NOTICE =
  "Email delivery is currently unavailable on this host — your 6-digit verification code has been provided below.";

/** Returns { delivered, otp } so verification can always continue even if SMTP is blocked. */
async function issueVerification(userId: string, email: string): Promise<{ delivered: boolean; otp?: string }> {
  const recent = await prisma.emailVerificationToken.findFirst({
    where: { userId, usedAt: null, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
  });
  if (recent) return { delivered: true }; // throttle rapid resends (previous code still valid)

  // Invalidate any previous unused tokens for this user before issuing a fresh OTP + link
  await prisma.emailVerificationToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(32).toString('base64url');
  const otp = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();

  await prisma.emailVerificationToken.createMany({
    data: [
      {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(now + VERIFY_TOKEN_TTL_MS),
      },
      {
        userId,
        tokenHash: otpHash(userId, otp),
        expiresAt: new Date(now + VERIFY_OTP_TTL_MS),
      },
    ],
  });

  try {
    await sendVerificationEmail(email, token, otp);
    return { delivered: true };
  } catch (error: any) {
    console.error(`[mail] could not send verification email to ${email}: ${error?.code ?? ''} ${error?.message ?? error}`);
    console.warn(
      `\n[mail] FALLBACK for ${email}\n  Verification code: ${otp}\n  Link: ${APP_URL}/verify-email?token=${encodeURIComponent(token)}\n`,
    );
    return { delivered: false, otp };
  }
}

/** API response for register/resend: includes the code itself only when the email could not be sent. */
function verificationResponse({ delivered, otp }: { delivered: boolean; otp?: string }) {
  return {
    message: delivered ? GENERIC_SENT : DEV_MAIL_NOTICE,
    emailDelivered: delivered,
    ...(delivered ? {} : { fallbackOtp: otp }),
  };
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
      firstName: user.firstName,
      lastName: user.lastName,
      role: role ?? null,
      kycStatus: user.kycStatus,
      isAdmin: isAdminEmail(user.email),
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
  static async register(email: string, password: string, names: { firstName: string; lastName: string }) {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      // Unverified: resend a fresh OTP. Verified: say nothing (no enumeration).
      if (!existing.emailVerifiedAt) {
        // Still unverified, so the person re-registering owns this account: keep their latest name
        if (names.firstName || names.lastName) {
          await prisma.user.update({ where: { id: existing.id }, data: names });
        }
        return verificationResponse(await issueVerification(existing.id, email));
      }
      return { message: GENERIC_SENT, emailDelivered: true };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, passwordHash, ...names } });
    return verificationResponse(await issueVerification(user.id, email));
  }

  static async resendVerification(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      return verificationResponse(await issueVerification(user.id, email));
    }
    return { message: GENERIC_SENT, emailDelivered: true };
  }

  static async verifyEmail(token: string) {
    const record = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new HttpError(400, 'This verification link is invalid or has expired.', 'INVALID_TOKEN');
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.emailVerificationToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } }),
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } }),
    ]);

    return { message: 'Email verified. You can now sign in.' };
  }

  /**
   * Verifies the 6-digit OTP sent to the user's email and returns a signed-in session
   * so the user can proceed directly to role selection.
   */
  static async verifyOtp(email: string, otp: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new HttpError(400, 'Invalid or expired verification code.', 'INVALID_OTP');
    }

    const record = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: otpHash(user.id, otp) },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new HttpError(400, 'Invalid or expired verification code.', 'INVALID_OTP');
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
      prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.emailVerifiedAt ?? now } }),
    ]);

    const session = await sessionFor(user.id);
    return {
      message: 'Email verified.',
      ...session,
    };
  }

  static async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    // Compare even when the user is missing to keep timing similar
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (!user.emailVerifiedAt) {
      await issueVerification(user.id, email).catch(() => undefined);
      throw new HttpError(403, 'Please enter the 6-digit verification code sent to your email.', 'EMAIL_NOT_VERIFIED');
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
