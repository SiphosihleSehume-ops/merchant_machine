import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signToken } from '../middleware/auth.middleware.js';
import { getAddress, verifyMessage } from 'viem';
import { HttpError } from '../lib/x402.js';

const WALLET_PROOF_WINDOW_MS = 10 * 60 * 1000;

/**
 * Message the merchant signs in MetaMask to prove they control the payout wallet.
 * MUST match frontend lib/wallet.ts shopWalletMessage().
 */
export function shopWalletMessage(userId: string, address: string, issuedAt: string) {
  return [
    'Merchant Machine: receive my shop payments at this wallet.',
    `Account: ${userId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Issued at: ${issuedAt}`,
  ].join('\n');
}

function presentShop(m: { id: string; name: string; category: string | null; cryptoWallet: string | null; feePercentage: number }) {
  return { id: m.id, name: m.name, category: m.category, cryptoWallet: m.cryptoWallet, feePercentage: m.feePercentage };
}

export class MerchantService {
  static async getShop(merchantId: string) {
    return presentShop(await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } }));
  }

  /**
   * Updates shop name/category and, when provided, the payout wallet. The wallet is only
   * accepted with a fresh signature from that wallet, so payments can't be routed to an
   * address the merchant doesn't control. Pending invoices pick up the new wallet, because
   * the x402 challenge reads it from the database on every scan.
   */
  static async updateShop(
    userId: string,
    merchantId: string,
    input: { name: string; category: string; wallet?: { address: string; issuedAt: string; signature: string } },
  ) {
    let cryptoWallet: string | undefined;
    if (input.wallet) {
      const { address, issuedAt, signature } = input.wallet;
      if (Math.abs(Date.now() - new Date(issuedAt).getTime()) > WALLET_PROOF_WINDOW_MS) {
        throw new HttpError(400, 'Wallet signature expired, please connect again', 'SIGNATURE_EXPIRED');
      }
      const valid = await verifyMessage({
        address: address as `0x${string}`,
        message: shopWalletMessage(userId, address, issuedAt),
        signature: signature as `0x${string}`,
      }).catch(() => false);
      if (!valid) throw new HttpError(400, 'Signature does not match this wallet', 'INVALID_SIGNATURE');
      cryptoWallet = getAddress(address); // checksummed
    }

    const merchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: { name: input.name, category: input.category, ...(cryptoWallet ? { cryptoWallet } : {}) },
    });
    return presentShop(merchant);
  }

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