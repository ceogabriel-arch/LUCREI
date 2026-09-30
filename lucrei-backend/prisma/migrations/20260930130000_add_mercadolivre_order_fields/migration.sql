-- AlterTable: shopeeOrderSn vira nullable (pedido Mercado Livre não tem) -
-- mesmo padrão já usado em Shop.shopeeShopId na Fase 1.
ALTER TABLE "Order" ALTER COLUMN "shopeeOrderSn" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN "mercadoLivreOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_mercadoLivreOrderId_key" ON "Order"("mercadoLivreOrderId");

-- AlterTable
ALTER TABLE "OrderLineItem" ADD COLUMN "mercadoLivreItemId" TEXT;

-- CreateIndex
CREATE INDEX "OrderLineItem_mercadoLivreItemId_idx" ON "OrderLineItem"("mercadoLivreItemId");

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "mercadoLivreItemId" TEXT;

-- CreateIndex
CREATE INDEX "Product_mercadoLivreItemId_idx" ON "Product"("mercadoLivreItemId");
