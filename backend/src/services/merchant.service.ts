import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signToken } from '../middleware/auth.middleware.js';

export class MerchantService {
  static async registerMerchant(data: any) {
    const { email, password, name, fiatWallet, cryptoWallet } = data;
    const normalizedEmail = String(email).trim().toLowerCase();

    // 1. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new Error('A user with this email already exists');
    }

    // 2. Hash the password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Create User and Merchant in a single transaction
    const newMerchant = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: 'MERCHANT',
          kycStatus: 'VERIFIED', // Auto-verify for demo purposes
          emailVerifiedAt: new Date(),
        },
      });

      const merchant = await tx.merchant.create({
        data: {
          userId: user.id,
          name,
          fiatWallet,
          cryptoWallet,
          feePercentage: 3.0, // From PDF Section 3.4
        },
      });

      return { user, merchant };
    });

    // Return safe data (never return passwordHash)
    return {
      id: newMerchant.merchant.id,
      userId: newMerchant.user.id,
      email: newMerchant.user.email,
      name: newMerchant.merchant.name,
      feePercentage: newMerchant.merchant.feePercentage,
    };
  }

  // Login method for merchants
  static async loginMerchant(data: any) {
    const { email, password } = data;
    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { merchant: true },
    });

    if (!user || !user.merchant) {
      throw new Error('Invalid email or password');
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      throw new Error('Invalid email or password');
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      merchantId: user.merchant.id,
      role: 'MERCHANT',
    });

    return { token, merchant: user.merchant };
  }

  /**
   * PDF Section 3.8: Double-entry ledger summary and entry history for a merchant.
   */
  static async getLedgerSummary(merchantId: string) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const all = await prisma.ledgerEntry.groupBy({
      by: ['account', 'type'],
      where: { merchantId },
      _sum: { amount: true },
    });

    const sumFor = (account: 'MERCHANT_PAYABLE' | 'PLATFORM_FEE' | 'MERCHANT_RESERVE', type: 'CREDIT' | 'DEBIT') =>
      all.find((row) => row.account === account && row.type === type)?._sum.amount ?? new Prisma.Decimal(0);

    const merchantPayable = sumFor('MERCHANT_PAYABLE', 'CREDIT').minus(sumFor('MERCHANT_PAYABLE', 'DEBIT'));
    const platformFees = sumFor('PLATFORM_FEE', 'CREDIT').minus(sumFor('PLATFORM_FEE', 'DEBIT'));
    const merchantReserve = sumFor('MERCHANT_RESERVE', 'CREDIT').minus(sumFor('MERCHANT_RESERVE', 'DEBIT'));

    return {
      balances: {
        merchantPayable: merchantPayable.toFixed(2),
        platformFees: platformFees.toFixed(2),
        merchantReserve: merchantReserve.toFixed(2),
        currency: 'ZAR',
      },
      entries: entries.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        reversalId: e.reversalId,
        account: e.account,
        type: e.type,
        amount: e.amount.toFixed(2),
        description: e.description,
        createdAt: e.createdAt,
      })),
    };
  }
}