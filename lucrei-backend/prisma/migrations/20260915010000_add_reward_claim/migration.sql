-- CreateTable
CREATE TABLE "RewardClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierThreshold" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RewardClaim_userId_idx" ON "RewardClaim"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardClaim_userId_tierThreshold_key" ON "RewardClaim"("userId", "tierThreshold");

-- AddForeignKey
ALTER TABLE "RewardClaim" ADD CONSTRAINT "RewardClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
