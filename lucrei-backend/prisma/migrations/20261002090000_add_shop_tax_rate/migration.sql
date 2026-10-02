-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "taxRatePercent" DECIMAL(5,2);
ALTER TABLE "OrderLineItem" ADD COLUMN "taxAllocated" DECIMAL(12,2) NOT NULL DEFAULT 0;
