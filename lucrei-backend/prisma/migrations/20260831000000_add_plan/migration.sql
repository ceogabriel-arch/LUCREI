-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "salesPerYear" INTEGER NOT NULL,
    "priceUpfront" DECIMAL(12,2) NOT NULL,
    "priceInstallment" DECIMAL(12,2) NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 12,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

-- SeedData
INSERT INTO "Plan" ("id", "key", "name", "salesPerYear", "priceUpfront", "priceInstallment", "installments", "sortOrder", "updatedAt") VALUES
    ('plan_start',    'start',    'Start',    3600,   931.20,  89.71,  12, 1, CURRENT_TIMESTAMP),
    ('plan_pro',      'pro',      'Pro',      18000,  1891.20, 182.19, 12, 2, CURRENT_TIMESTAMP),
    ('plan_advanced', 'advanced', 'Advanced', 60000,  3811.20, 367.15, 12, 3, CURRENT_TIMESTAMP),
    ('plan_business', 'business', 'Business', 120000, 6691.20, 644.99, 12, 4, CURRENT_TIMESTAMP);
