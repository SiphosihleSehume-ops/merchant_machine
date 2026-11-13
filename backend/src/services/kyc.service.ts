import { KycApplication } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError, EXPLORER_TX_URL } from '../lib/x402.js';
import { readDecrypted, sniffDocumentType, storeEncrypted } from '../lib/kycStorage.js';
import { readOnChainStatus, verifyOnChain } from '../lib/kycContract.js';
import type { ActiveRole } from '../middleware/auth.middleware.js';

export type KycAddressInput = {
  streetAddress: string;
  suburb?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

type UploadedFile = { buffer: Buffer; size: number };

/** Applicant-safe view: never exposes file names or internals. */
function present(a: KycApplication) {
  return {
    id: a.id,
    status: a.status,
    role: a.role,
    walletAddress: a.walletAddress,
    address: {
      streetAddress: a.streetAddress,
      suburb: a.suburb,
      city: a.city,
      province: a.province,
      postalCode: a.postalCode,
      country: a.country,
    },
    submittedAt: a.createdAt,
    reviewedAt: a.reviewedAt,
    rejectionReason: a.rejectionReason,
    chainTxHash: a.chainTxHash,
    explorerUrl: a.chainTxHash ? `${EXPLORER_TX_URL}${a.chainTxHash}` : null,
  };
}

/** The wallet that gets verified: the merchant payout wallet or the customer's linked wallet. */
async function walletFor(userId: string, role: ActiveRole) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { merchant: true, customer: true } });
  return role === 'MERCHANT' ? user.merchant?.cryptoWallet ?? null : user.customer?.walletAddress ?? null;
}

function checkDocument(file: UploadedFile | undefined, label: string) {
  if (!file) throw new HttpError(400, `${label} is required`);
  const type = sniffDocumentType(file.buffer);
  if (!type) throw new HttpError(400, `${label} must be a PDF, JPG or PNG file`);
  return type;
}

export class KycService {
  static async getMine(userId: string, role: ActiveRole) {
    const [latest, wallet] = await Promise.all([
      prisma.kycApplication.findFirst({ where: { userId, role }, orderBy: { createdAt: 'desc' } }),
      walletFor(userId, role),
    ]);
    const statusWallet = latest?.walletAddress ?? wallet;
    return {
      wallet,
      application: latest ? present(latest) : null,
      onChain: statusWallet ? await readOnChainStatus(statusWallet) : null,
    };
  }

  static async submit(
    userId: string,
    role: ActiveRole,
    input: KycAddressInput,
    files: { idDocument?: UploadedFile; proofOfAddress?: UploadedFile },
  ) {
    const wallet = await walletFor(userId, role);
    if (!wallet) {
      throw new HttpError(
        400,
        role === 'MERCHANT' ? 'Connect your payout wallet in My shop first' : 'Connect your wallet first',
        'WALLET_REQUIRED',
      );
    }

    const open = await prisma.kycApplication.findFirst({
      where: { userId, role, status: { in: ['PENDING', 'APPROVING', 'APPROVED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (open?.status === 'APPROVED' && open.walletAddress.toLowerCase() === wallet.toLowerCase()) {
      throw new HttpError(409, 'This wallet is already KYC verified', 'ALREADY_VERIFIED');
    }
    if (open && open.status !== 'APPROVED') {
      throw new HttpError(409, 'Your application is already being reviewed', 'ALREADY_PENDING');
    }

    const idMime = checkDocument(files.idDocument, 'ID document');
    const proofMime = checkDocument(files.proofOfAddress, 'Proof of address');
    const [idFile, proofFile] = await Promise.all([
      storeEncrypted(files.idDocument!.buffer),
      storeEncrypted(files.proofOfAddress!.buffer),
    ]);

    const [application] = await prisma.$transaction([
      prisma.kycApplication.create({
        data: {
          userId,
          role,
          walletAddress: wallet,
          ...input,
          suburb: input.suburb || null,
          idDocumentFile: idFile,
          idDocumentMime: idMime,
          proofOfAddressFile: proofFile,
          proofOfAddressMime: proofMime,
          popiaConsentAt: new Date(),
        },
      }),
      prisma.user.update({ where: { id: userId }, data: { kycStatus: 'PENDING' } }),
    ]);
    return present(application);
  }

  // ---------------- Verifier ----------------

  static async list(status?: KycApplication['status']) {
    const rows = await prisma.kycApplication.findMany({
      where: status ? { status } : undefined,
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 100,
    });
    return rows.map((r) => ({ ...present(r), email: r.user.email, reviewedBy: r.reviewedBy }));
  }

  static async document(id: string, kind: 'id' | 'proof') {
    const a = await prisma.kycApplication.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, 'Application not found');
    const file = kind === 'id' ? a.idDocumentFile : a.proofOfAddressFile;
    const mime = kind === 'id' ? a.idDocumentMime : a.proofOfAddressMime;
    return { data: await readDecrypted(file), mime };
  }

  /** Approve: record the wallet on-chain first, then mark approved. */
  static async approve(id: string, reviewer: string) {
    // Claim so two verifiers can't send two transactions
    const claimed = await prisma.kycApplication.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVING' } });
    if (claimed.count !== 1) throw new HttpError(409, 'Application is not pending');

    const a = await prisma.kycApplication.findUniqueOrThrow({ where: { id } });
    let chain: Awaited<ReturnType<typeof verifyOnChain>>;
    try {
      chain = await verifyOnChain(a.walletAddress);
    } catch (error) {
      await prisma.kycApplication.update({ where: { id }, data: { status: 'PENDING' } });
      throw error;
    }

    const [updated] = await prisma.$transaction([
      prisma.kycApplication.update({
        where: { id },
        data: { status: 'APPROVED', reviewedBy: reviewer, reviewedAt: new Date(), chainTxHash: chain.txHash, rejectionReason: null },
      }),
      prisma.user.update({ where: { id: a.userId }, data: { kycStatus: 'VERIFIED' } }),
    ]);
    return present(updated);
  }

  static async reject(id: string, reviewer: string, reason: string) {
    const a = await prisma.kycApplication.findUnique({ where: { id } });
    if (!a) throw new HttpError(404, 'Application not found');
    if (a.status !== 'PENDING') throw new HttpError(409, 'Application is not pending');

    const [updated] = await prisma.$transaction([
      prisma.kycApplication.update({
        where: { id },
        data: { status: 'REJECTED', reviewedBy: reviewer, reviewedAt: new Date(), rejectionReason: reason },
      }),
      prisma.user.update({ where: { id: a.userId }, data: { kycStatus: 'REJECTED' } }),
    ]);
    return present(updated);
  }
}
