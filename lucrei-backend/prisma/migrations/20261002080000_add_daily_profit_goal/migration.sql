-- AlterTable
ALTER TABLE "User" ADD COLUMN "dailyProfitGoal" DECIMAL(12,2);
ALTER TABLE "User" ADD COLUMN "dailyGoalNotifiedAt" TIMESTAMP(3);
