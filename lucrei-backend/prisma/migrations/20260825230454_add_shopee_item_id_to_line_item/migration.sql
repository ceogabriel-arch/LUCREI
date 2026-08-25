-- AlterTable
ALTER TABLE "OrderLineItem" ADD COLUMN     "shopeeItemId" TEXT;

-- CreateIndex
CREATE INDEX "OrderLineItem_shopeeItemId_idx" ON "OrderLineItem"("shopeeItemId");
