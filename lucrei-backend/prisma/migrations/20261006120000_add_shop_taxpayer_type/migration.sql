-- CreateEnum
CREATE TYPE "TaxpayerType" AS ENUM ('cnpj', 'cpf');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "taxpayerType" "TaxpayerType" NOT NULL DEFAULT 'cnpj';
