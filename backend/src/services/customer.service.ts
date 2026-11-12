import { KycStatus, Prisma } from '@prisma/client';
import { verifyMessage } from 'viem';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/x402.js';

const LINK_WINDOW_MS = 10 * 60 * 1000;

/**
 * PDF Section 3.6: Tiered KYC limits in ZAR (small limits first; POPIA data minimisation).
 */
export function kycTierFor(status: KycStatus) {
  if (status === 'VERIFIED') {
    return {
      tier: 'TIER_2_VERIFIED',
      kycStatus: status,
      singlePaymentLimitZar: '50000.00',
      dailyLimitZar: '250000.00',
    };
  }
  return {
    tier: 'TIER_1_BASIC',
    kycStatus: status,
    singlePaymentLimitZar: '5000.00',
    dailyLimitZar: '15000.00',
  };
}

/**
 * Message the customer signs in MetaMask to prove wallet ownership.
 * MUST match frontend lib/wallet.ts walletLinkMessage().
 */
export function walletLinkMessage(userId: string, address: string, issuedAt: string) {
  return [
    'Merchant Machine: link this wallet to my account.',
    `Account: ${userId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Issued at: ${issuedAt}`,
  ].join('\n');
}

export class CustomerService {
  static async getProfile(userId: string, customerId: string) {
    const [user, customer] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.customer.findUniqueOrThrow({ where: { id: customerId } }),
    ]);
    return {
      id: customer.id,
      userId: user.id,
      email: user.email,
      walletAddress: customer.walletAddress,
      ...kycTierFor(user.kycStatus),
    };
  }

  /**
   * PDF Section 3.6: Upgrades the customer's KYC status without storing sensitive ID
   * documents or national ID numbers under POPIA.
   */
  static async submitKyc(
    userId: string,
    customerId: string,
    _input: { fullName: string; countryCode: string; popiaConsent: true },
  ) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'VERIFIED' },
    });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    return {
      id: customer.id,
      walletAddress: customer.walletAddress,
      ...kycTierFor(user.kycStatus),
    };
  }

  static async linkWallet(userId: string, customerId: string, input: { address: string; issuedAt: string; signature: string }) {
    const issued = new Date(input.issuedAt).getTime();
    if (Math.abs(Date.now() - issued) > LINK_WINDOW_MS) {
      throw new HttpError(400, 'Signature expired, please sign again', 'SIGNATURE_EXPIRED');
    }

    const valid = await verifyMessage({
      address: input.address as `0x${string}`,
      message: walletLinkMessage(userId, input.address, input.issuedAt),
      signature: input.signature as `0x${string}`,
    }).catch(() => false);
    if (!valid) {
      throw new HttpError(400, 'Signature does not match wallet', 'INVALID_SIGNATURE');
    }

    const walletAddress = input.address.toLowerCase();
    try {
      return await prisma.customer.update({ where: { id: customerId }, data: { walletAddress } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'This wallet is linked to another account', 'WALLET_IN_USE');
      }
      throw error;
    }
  }
}
