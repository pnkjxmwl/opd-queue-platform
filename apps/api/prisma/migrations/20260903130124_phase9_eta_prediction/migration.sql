-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN     "predictedCallFrom" TIMESTAMP(3),
ADD COLUMN     "predictedCallTo" TIMESTAMP(3);
