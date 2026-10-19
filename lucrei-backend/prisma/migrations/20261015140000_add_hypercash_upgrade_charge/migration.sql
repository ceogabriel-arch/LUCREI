-- CreateTable
CREATE TABLE "HypercashUpgradeCharge" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "targetPlanId" TEXT NOT NULL,
    "paymentLinkId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "HypercashUpgradeCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HypercashUpgradeCharge_paymentLinkId_key" ON "HypercashUpgradeCharge"("paymentLinkId");

-- CreateIndex
CREATE INDEX "HypercashUpgradeCharge_subscriptionId_idx" ON "HypercashUpgradeCharge"("subscriptionId");

-- AddForeignKey
ALTER TABLE "HypercashUpgradeCharge" ADD CONSTRAINT "HypercashUpgradeCharge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HypercashUpgradeCharge" ADD CONSTRAINT "HypercashUpgradeCharge_targetPlanId_fkey" FOREIGN KEY ("targetPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
