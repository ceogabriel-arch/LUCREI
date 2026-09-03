-- AlterEnum
ALTER TYPE "SubscriptionProvider" ADD VALUE 'asaas';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "lastInvoiceUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "document" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);
