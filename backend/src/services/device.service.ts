import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/x402.js';
import { kycContractConfigured, readOnChainStatus } from '../lib/kycContract.js';

export class DeviceService {
  static list(merchantId: string) {
    return prisma.device.findMany({ where: { merchantId }, orderBy: { linkedAt: 'asc' } });
  }

  static async get(merchantId: string, id: string) {
    const device = await prisma.device.findFirst({ where: { id, merchantId } });
    if (!device) throw new HttpError(404, 'Device not found');
    return device;
  }

  static async link(merchantId: string, input: { name: string; serial: string }) {
    try {
      return await prisma.device.create({ data: { merchantId, name: input.name, serial: input.serial.toUpperCase() } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'This device is already linked to an account', 'DEVICE_IN_USE');
      }
      throw error;
    }
  }

  static async unlink(merchantId: string, id: string) {
    const removed = await prisma.device.deleteMany({ where: { id, merchantId } });
    if (removed.count === 0) throw new HttpError(404, 'Device not found');
  }

  /**
   * Transfer recipients: shops whose KYC a verifier APPROVED, searched by shop name.
   * Returns only public business info (shop name, category, wallet), never email,
   * street address or documents. When the KYC contract is configured, the wallet must
   * also still be verified on-chain (revoked wallets drop out).
   */
  static async searchVerifiedRecipients(merchantId: string, query: string) {
    const q = query.trim();
    if (q.length < 2) throw new HttpError(400, 'Type at least 2 letters of the shop name');

    const merchants = await prisma.merchant.findMany({
      where: {
        id: { not: merchantId }, // not yourself
        name: { contains: q, mode: 'insensitive' },
        cryptoWallet: { not: null },
        user: { kycApplications: { some: { role: 'MERCHANT', status: 'APPROVED' } } },
      },
      include: {
        user: {
          select: {
            kycApplications: {
              where: { role: 'MERCHANT', status: 'APPROVED' },
              orderBy: { reviewedAt: 'desc' },
              take: 1,
              select: { walletAddress: true, reviewedAt: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 10,
    });

    const results = await Promise.all(
      merchants.map(async (m) => {
        const approved = m.user.kycApplications[0];
        // The approved wallet must still be the shop's payout wallet
        if (!approved || approved.walletAddress.toLowerCase() !== m.cryptoWallet!.toLowerCase()) return null;
        if (kycContractConfigured()) {
          const chain = await readOnChainStatus(m.cryptoWallet!);
          if (!chain?.verified) return null;
        }
        return {
          merchantId: m.id,
          name: m.name,
          category: m.category,
          walletAddress: m.cryptoWallet!,
          verifiedAt: approved.reviewedAt,
        };
      }),
    );
    return results.filter((r) => r !== null);
  }
}
