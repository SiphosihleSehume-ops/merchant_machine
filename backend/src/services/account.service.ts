import { getAddress, verifyMessage } from 'viem';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { EXPLORER_TX_URL, HttpError } from '../lib/x402.js';
import { kycContractConfigured, verifyOnChain } from '../lib/kycContract.js';
import { zarkBalanceOf } from '../lib/tokenBalance.js';

const WALLET_PROOF_WINDOW_MS = 10 * 60 * 1000;

/**
 * Message the merchant signs to prove control of a NEW branch wallet.
 * MUST match frontend lib/wallet.ts branchWalletMessage().
 */
export function branchWalletMessage(userId: string, address: string, issuedAt: string) {
  return [
    'Merchant Machine: add this wallet as a business account.',
    `Account: ${userId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Issued at: ${issuedAt}`,
  ].join('\n');
}

/** The owner's approved merchant KYC application (null if not approved). */
async function approvedKyc(userId: string) {
  return prisma.kycApplication.findFirst({
    where: { userId, role: 'MERCHANT', status: 'APPROVED' },
    orderBy: { reviewedAt: 'desc' },
  });
}

export type BusinessAccountView = {
  id: string; // "main" for the shop itself, otherwise the branch id
  kind: 'MAIN' | 'BRANCH';
  name: string;
  category: string | null;
  walletAddress: string | null;
  verified: boolean;
  explorerUrl: string | null;
  balance: string;
};

export class AccountService {
  /** Main shop + branches, each with verification status and live ZARK balance. */
  static async list(userId: string, merchantId: string): Promise<{ kycApproved: boolean; accounts: BusinessAccountView[] }> {
    const [merchant, kyc] = await Promise.all([
      prisma.merchant.findUniqueOrThrow({ where: { id: merchantId }, include: { branches: { orderBy: { createdAt: 'asc' } } } }),
      approvedKyc(userId),
    ]);

    const mainVerified =
      !!kyc && !!merchant.cryptoWallet && kyc.walletAddress.toLowerCase() === merchant.cryptoWallet.toLowerCase();

    const rows = [
      {
        id: 'main',
        kind: 'MAIN' as const,
        name: merchant.name,
        category: merchant.category,
        walletAddress: merchant.cryptoWallet,
        verified: mainVerified,
        explorerUrl: mainVerified && kyc?.chainTxHash ? `${EXPLORER_TX_URL}${kyc.chainTxHash}` : null,
      },
      ...merchant.branches.map((b) => ({
        id: b.id,
        kind: 'BRANCH' as const,
        name: b.name,
        category: b.category,
        walletAddress: b.walletAddress,
        // Branches inherit the owner's KYC; they stay verified only while it is approved
        verified: !!kyc && !!b.verifiedAt,
        explorerUrl: b.chainTxHash ? `${EXPLORER_TX_URL}${b.chainTxHash}` : null,
      })),
    ];

    const balances = await Promise.all(rows.map((r) => zarkBalanceOf(r.walletAddress)));
    return {
      kycApproved: !!kyc,
      accounts: rows.map((r, i) => ({ ...r, balance: balances[i].balance })),
    };
  }

  /**
   * Adds a branch that reuses the owner's approved KYC: only the business name, category and
   * a new (signature-proven) wallet are needed. The wallet is then recorded on the
   * KYCVerification contract so other apps also see it as verified.
   */
  static async addBranch(
    userId: string,
    merchantId: string,
    input: { name: string; category: string; wallet: { address: string; issuedAt: string; signature: string } },
  ) {
    if (!(await approvedKyc(userId))) {
      throw new HttpError(403, 'Your KYC must be approved before you can add business accounts (Profile → My address)', 'KYC_REQUIRED');
    }

    const { address, issuedAt, signature } = input.wallet;
    if (Math.abs(Date.now() - new Date(issuedAt).getTime()) > WALLET_PROOF_WINDOW_MS) {
      throw new HttpError(400, 'Wallet signature expired, please connect again', 'SIGNATURE_EXPIRED');
    }
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message: branchWalletMessage(userId, address, issuedAt),
      signature: signature as `0x${string}`,
    }).catch(() => false);
    if (!valid) throw new HttpError(400, 'Signature does not match this wallet', 'INVALID_SIGNATURE');

    const wallet = getAddress(address);
    const takenByShop = await prisma.merchant.findFirst({
      where: { cryptoWallet: { equals: wallet, mode: 'insensitive' } },
    });
    if (takenByShop) {
      throw new HttpError(409, 'This wallet is already used by an account. Connect a different wallet for the new business.', 'WALLET_IN_USE');
    }
    if (!kycContractConfigured()) {
      throw new HttpError(503, 'KYC contract not configured: set KYC_CONTRACT_ADDRESS in backend/.env', 'KYC_CHAIN_NOT_CONFIGURED');
    }

    let branch;
    try {
      branch = await prisma.businessAccount.create({
        data: { merchantId, name: input.name, category: input.category, walletAddress: wallet },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'This wallet is already used by a business account', 'WALLET_IN_USE');
      }
      throw error;
    }

    // Record the inherited verification on-chain; undo the branch if that fails
    try {
      const chain = await verifyOnChain(wallet);
      branch = await prisma.businessAccount.update({
        where: { id: branch.id },
        data: { chainTxHash: chain.txHash, verifiedAt: new Date() },
      });
    } catch (error) {
      await prisma.businessAccount.delete({ where: { id: branch.id } }).catch(() => undefined);
      throw error;
    }
    return branch;
  }
}
