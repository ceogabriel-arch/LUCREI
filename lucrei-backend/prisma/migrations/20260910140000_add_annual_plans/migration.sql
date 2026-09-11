-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('monthly', 'annual');

-- AlterTable: add nullable first so existing rows don't fail, then backfill, then enforce NOT NULL
ALTER TABLE "Plan" ADD COLUMN "groupKey" TEXT;
ALTER TABLE "Plan" ADD COLUMN "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'monthly';
ALTER TABLE "Plan" ADD COLUMN "trialEligible" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing rows: groupKey mirrors the current key, only Start keeps its trial
UPDATE "Plan" SET "groupKey" = "key";
UPDATE "Plan" SET "trialEligible" = true WHERE "key" = 'start';

ALTER TABLE "Plan" ALTER COLUMN "groupKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Plan_groupKey_billingPeriod_key" ON "Plan"("groupKey", "billingPeriod");

-- Novos planos anuais (10 meses no preço de 12 - ~17% de desconto)
INSERT INTO "Plan" ("id", "key", "name", "salesLimit", "integrationsLimit", "priceOriginal", "priceCurrent", "sortOrder", "groupKey", "billingPeriod", "trialEligible", "createdAt", "updatedAt")
VALUES
  ('plan_start_annual', 'start_annual', 'Start', 300, 1, 598.80, 499.00, 1, 'start', 'annual', true, now(), now()),
  ('plan_pro_annual', 'pro_annual', 'Pro', 1500, 1, 1788.00, 1490.00, 2, 'pro', 'annual', false, now(), now()),
  ('plan_master_annual', 'master_annual', 'Master', 5000, NULL, 3564.00, 2970.00, 3, 'master', 'annual', false, now(), now());
