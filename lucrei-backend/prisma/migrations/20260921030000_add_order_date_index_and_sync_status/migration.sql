-- CreateIndex
CREATE INDEX "Order_shopId_orderDate_idx" ON "Order"("shopId", "orderDate");

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "syncStatus" TEXT;
ALTER TABLE "Shop" ADD COLUMN "syncStartedAt" TIMESTAMP(3);
ALTER TABLE "Shop" ADD COLUMN "syncOrdersSynced" INTEGER;
ALTER TABLE "Shop" ADD COLUMN "syncError" TEXT;
