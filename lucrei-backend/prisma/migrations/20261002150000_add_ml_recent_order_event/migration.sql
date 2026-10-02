-- AlterTable
ALTER TABLE "RecentOrderEvent" ALTER COLUMN "shopeeOrderSn" DROP NOT NULL;
ALTER TABLE "RecentOrderEvent" ADD COLUMN "mercadoLivreOrderId" TEXT;
CREATE UNIQUE INDEX "RecentOrderEvent_mercadoLivreOrderId_key" ON "RecentOrderEvent"("mercadoLivreOrderId");
