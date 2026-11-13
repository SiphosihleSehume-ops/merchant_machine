-- Per-invoice platform fee terms (2.5% via MerchantPayments). Additive only.
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "paymentsContract" TEXT,
ADD COLUMN     "platformFeeBps" INTEGER;
