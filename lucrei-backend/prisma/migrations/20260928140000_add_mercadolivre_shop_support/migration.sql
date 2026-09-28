-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('shopee', 'mercado_livre');

-- AlterTable: shopeeShopId vira nullable (loja Mercado Livre não tem um) -
-- todas as linhas existentes já têm shopeeShopId preenchido, então
-- DROP NOT NULL é seguro sem backfill.
ALTER TABLE "Shop" ALTER COLUMN "shopeeShopId" DROP NOT NULL;
ALTER TABLE "Shop" ADD COLUMN "mercadoLivreShopId" TEXT;
ALTER TABLE "Shop" ADD COLUMN "provider" "Marketplace" NOT NULL DEFAULT 'shopee';

-- CreateIndex
CREATE UNIQUE INDEX "Shop_mercadoLivreShopId_key" ON "Shop"("mercadoLivreShopId");

-- CreateTable
CREATE TABLE "MercadoLivreOAuthToken" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MercadoLivreOAuthToken_shopId_key" ON "MercadoLivreOAuthToken"("shopId");

-- AddForeignKey
ALTER TABLE "MercadoLivreOAuthToken" ADD CONSTRAINT "MercadoLivreOAuthToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
