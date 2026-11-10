-- AlterTable
ALTER TABLE "User" ADD COLUMN "appleAppAccountToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_appleAppAccountToken_key" ON "User"("appleAppAccountToken");
