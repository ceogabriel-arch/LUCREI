-- AlterTable
ALTER TABLE "Order" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Backfill: sem o update_time histórico da Shopee, orderDate (data da
-- compra) é a melhor aproximação disponível pra pedido já sincronizado
-- antes dessa coluna existir. Sincronizações futuras gravam o valor real.
UPDATE "Order" SET "completedAt" = "orderDate" WHERE "completedAt" IS NULL;

-- CreateIndex
CREATE INDEX "Order_shopId_completedAt_idx" ON "Order"("shopId", "completedAt");
