-- AlterTable: switch Plan from annual/installment pricing to monthly "de/por" pricing
ALTER TABLE "Plan"
  DROP COLUMN "salesPerYear",
  DROP COLUMN "priceUpfront",
  DROP COLUMN "priceInstallment",
  DROP COLUMN "installments",
  ADD COLUMN     "salesLimit" INTEGER,
  ADD COLUMN     "integrationsLimit" INTEGER,
  ADD COLUMN     "priceOriginal" DECIMAL(12,2),
  ADD COLUMN     "priceCurrent" DECIMAL(12,2);

-- ReplaceSeedData: existing users referencing a removed plan fall back to
-- no plan (User.planId has ON DELETE SET NULL).
DELETE FROM "Plan";

INSERT INTO "Plan" ("id", "key", "name", "salesLimit", "integrationsLimit", "priceOriginal", "priceCurrent", "sortOrder", "updatedAt") VALUES
    ('plan_start',      'start',      'Start',       300,  1,    97.00,  49.90,  1, CURRENT_TIMESTAMP),
    ('plan_pro',        'pro',        'Pro',         1500, 1,    197.00, 149.00, 2, CURRENT_TIMESTAMP),
    ('plan_master',     'master',     'Master',      5000, NULL, 349.90, 297.00, 3, CURRENT_TIMESTAMP),
    ('plan_enterprise', 'enterprise', 'Empresarial', NULL, NULL, NULL,   NULL,   4, CURRENT_TIMESTAMP);
