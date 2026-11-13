-- Merchant branch accounts (Accounts page). Additive only.
-- CreateTable
CREATE TABLE "BusinessAccount" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chainTxHash" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessAccount_walletAddress_key" ON "BusinessAccount"("walletAddress");

-- CreateIndex
CREATE INDEX "BusinessAccount_merchantId_idx" ON "BusinessAccount"("merchantId");

-- AddForeignKey
ALTER TABLE "BusinessAccount" ADD CONSTRAINT "BusinessAccount_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

