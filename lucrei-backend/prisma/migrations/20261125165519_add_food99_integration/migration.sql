-- AlterEnum
ALTER TYPE "Marketplace" ADD VALUE 'food99';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "food99OrderId" TEXT;

-- AlterTable
ALTER TABLE "OrderLineItem" ADD COLUMN     "food99ItemId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "food99ItemId" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "food99ShopId" TEXT;

-- CreateTable
CREATE TABLE "Food99OAuthToken" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "authToken" TEXT NOT NULL,
    "authTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Food99OAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Food99OAuthToken_shopId_key" ON "Food99OAuthToken"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_food99OrderId_key" ON "Order"("food99OrderId");

-- CreateIndex
CREATE INDEX "OrderLineItem_food99ItemId_idx" ON "OrderLineItem"("food99ItemId");

-- CreateIndex
CREATE INDEX "Product_food99ItemId_idx" ON "Product"("food99ItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_food99ShopId_key" ON "Shop"("food99ShopId");

-- AddForeignKey
ALTER TABLE "Food99OAuthToken" ADD CONSTRAINT "Food99OAuthToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

