ALTER TABLE "Shop" ADD COLUMN "historyBackfillStatus" TEXT;
ALTER TABLE "Shop" ADD COLUMN "historyBackfillStartedAt" TIMESTAMP(3);
ALTER TABLE "Shop" ADD COLUMN "historyBackfillDoneAt" TIMESTAMP(3);
ALTER TABLE "Shop" ADD COLUMN "historyBackfillSynced" INTEGER;
ALTER TABLE "Shop" ADD COLUMN "historyBackfillError" TEXT;
