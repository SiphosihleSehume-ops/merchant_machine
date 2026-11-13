-- KYC applications (My Address). Additive only.
-- CreateEnum
CREATE TYPE "KycApplicationStatus" AS ENUM ('PENDING', 'APPROVING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "KycStatus" ADD VALUE 'REJECTED';

-- CreateTable
CREATE TABLE "KycApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "streetAddress" TEXT NOT NULL,
    "suburb" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'South Africa',
    "idDocumentFile" TEXT NOT NULL,
    "idDocumentMime" TEXT NOT NULL,
    "proofOfAddressFile" TEXT NOT NULL,
    "proofOfAddressMime" TEXT NOT NULL,
    "popiaConsentAt" TIMESTAMP(3) NOT NULL,
    "status" "KycApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "chainTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycApplication_userId_idx" ON "KycApplication"("userId");

-- CreateIndex
CREATE INDEX "KycApplication_status_idx" ON "KycApplication"("status");

-- AddForeignKey
ALTER TABLE "KycApplication" ADD CONSTRAINT "KycApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

