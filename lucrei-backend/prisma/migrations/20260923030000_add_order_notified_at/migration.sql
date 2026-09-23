-- AlterTable
ALTER TABLE "Order" ADD COLUMN "notifiedAt" TIMESTAMP(3);

-- Backfill: marca todo pedido já existente como "já notificado" (mesmo que
-- não tenha sido de verdade) - sem isso, o próximo deploy dispararia uma
-- notificação de "pedido concluído" pra cada pedido antigo já sincronizado
-- assim que a sincronização normal rodasse de novo.
UPDATE "Order" SET "notifiedAt" = COALESCE("completedAt", "syncedAt") WHERE "notifiedAt" IS NULL;
