-- AlterEnum
ALTER TYPE "SubscriptionProvider" ADD VALUE 'mercado_pago_pix';

-- CreateEnum
CREATE TYPE "PixChargeStatus" AS ENUM ('pending', 'approved', 'expired', 'canceled');

-- CreateTable
CREATE TABLE "PixCharge" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "mercadoPagoPaymentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PixChargeStatus" NOT NULL DEFAULT 'pending',
    "qrCode" TEXT NOT NULL,
    "qrCodeBase64" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PixCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PixCharge_mercadoPagoPaymentId_key" ON "PixCharge"("mercadoPagoPaymentId");

-- CreateIndex
CREATE INDEX "PixCharge_subscriptionId_idx" ON "PixCharge"("subscriptionId");

-- AddForeignKey
ALTER TABLE "PixCharge" ADD CONSTRAINT "PixCharge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
