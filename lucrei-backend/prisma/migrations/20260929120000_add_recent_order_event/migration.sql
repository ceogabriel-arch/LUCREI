-- CreateTable
CREATE TABLE "RecentOrderEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopeeOrderSn" TEXT NOT NULL,
    "orderStatus" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecentOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecentOrderEvent_shopeeOrderSn_key" ON "RecentOrderEvent"("shopeeOrderSn");

-- CreateIndex
CREATE INDEX "RecentOrderEvent_shopId_idx" ON "RecentOrderEvent"("shopId");

-- AddForeignKey
ALTER TABLE "RecentOrderEvent" ADD CONSTRAINT "RecentOrderEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
