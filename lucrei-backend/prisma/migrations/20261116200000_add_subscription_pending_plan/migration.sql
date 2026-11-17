-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "pendingPlanId" TEXT;

-- AlterTable
ALTER TABLE "PixCharge" ADD COLUMN     "previousPlanId" TEXT;
