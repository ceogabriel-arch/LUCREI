-- AlterEnum
ALTER TYPE "Marketplace" ADD VALUE 'ifood';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "ifoodOrderId" TEXT;

-- AlterTable
ALTER TABLE "OrderLineItem" ADD COLUMN     "ifoodItemId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "ifoodItemId" TEXT;

-- AlterTable
ALTER TABLE "RecentOrderEvent" ADD COLUMN     "ifoodOrderId" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "ifoodCommissionPercent" DECIMAL(5,2),
ADD COLUMN     "ifoodShopId" TEXT;

-- CreateTable
CREATE TABLE "IfoodOAuthToken" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IfoodOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IfoodOAuthToken_shopId_key" ON "IfoodOAuthToken"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_ifoodOrderId_key" ON "Order"("ifoodOrderId");

-- CreateIndex
CREATE INDEX "OrderLineItem_ifoodItemId_idx" ON "OrderLineItem"("ifoodItemId");

-- CreateIndex
CREATE INDEX "Product_ifoodItemId_idx" ON "Product"("ifoodItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RecentOrderEvent_ifoodOrderId_key" ON "RecentOrderEvent"("ifoodOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_ifoodShopId_key" ON "Shop"("ifoodShopId");

-- AddForeignKey
ALTER TABLE "IfoodOAuthToken" ADD CONSTRAINT "IfoodOAuthToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

