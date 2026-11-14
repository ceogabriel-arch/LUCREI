-- AlterEnum
ALTER TYPE "Marketplace" ADD VALUE 'tiktok_shop';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "tiktokShopOrderId" TEXT;

-- AlterTable
ALTER TABLE "OrderLineItem" ADD COLUMN     "tiktokShopItemId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "tiktokShopItemId" TEXT;

-- AlterTable
ALTER TABLE "RecentOrderEvent" ADD COLUMN     "tiktokShopOrderId" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "tiktokShopId" TEXT;

-- CreateTable
CREATE TABLE "TiktokShopOAuthToken" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopCipher" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TiktokShopOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TiktokShopOAuthToken_shopId_key" ON "TiktokShopOAuthToken"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tiktokShopOrderId_key" ON "Order"("tiktokShopOrderId");

-- CreateIndex
CREATE INDEX "OrderLineItem_tiktokShopItemId_idx" ON "OrderLineItem"("tiktokShopItemId");

-- CreateIndex
CREATE INDEX "Product_tiktokShopItemId_idx" ON "Product"("tiktokShopItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RecentOrderEvent_tiktokShopOrderId_key" ON "RecentOrderEvent"("tiktokShopOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_tiktokShopId_key" ON "Shop"("tiktokShopId");

-- AddForeignKey
ALTER TABLE "TiktokShopOAuthToken" ADD CONSTRAINT "TiktokShopOAuthToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
