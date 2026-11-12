import { Prisma } from '@prisma/client';
import { verifyMessage } from 'viem';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/x402.js';

const LINK_WINDOW_MS = 10 * 60 * 1000;

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
