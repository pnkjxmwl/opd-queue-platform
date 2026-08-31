-- Phase 5 - join, payment and refund (docs/Phases.md Phase 5, docs/Architecture.md 10).
--
-- Two tables, two enums, three enum values and one column. The parts worth reading
-- twice:
--
--   * QueueEntry.reservationExpiresAt is what RELEASES an unpaid slot. Not a job -
--     the column. Every rule that counts people in a session treats a RESERVED entry
--     past this instant as not holding a place, so the slot frees at exactly the
--     right moment whether or not a worker is running, and clock skew between a
--     scheduler and the database cannot oversell a session. The sweeper that later
--     marks such rows CANCELLED only writes down what is already true. BullMQ stays
--     in Phase 8, where its kill switches and jobId conventions are designed.
--
--   * Payment.razorpayPaymentId is UNIQUE, and that is the replay guard. A duplicate
--     payment.captured hits the constraint and the handler treats the violation as
--     success. docs/Phases.md asks for exactly this: an application check loses that
--     race, a unique index does not (docs/Rules.md 5).
--
--   * Payment.queueEntryId is UNIQUE - one order per reservation. A retried checkout
--     re-uses the order rather than creating a second, which is what stops a flaky
--     mobile connection charging someone twice.
--
-- ALTER TYPE ... ADD VALUE runs inside a transaction on Postgres 12+ (we are on 16)
-- as long as the new value is not USED in the same transaction. It is not: nothing
-- here writes a QueueEvent. BEFORE 'ENTRY_CHECKED_IN' keeps pg_enum's sort order
-- matching the order in schema.prisma, so `migrate diff` stays quiet.
--
-- Financial rows are append-only in spirit: corrected with a compensating Refund,
-- never edited into a different story and never deleted. The foreign keys enforce
-- the half of that a constraint can - both Payment.entry and Refund.payment are
-- RESTRICT, and so is Payment.account, so an account with money against it cannot be
-- deleted out from under its own payment record.

-- AlterEnum
ALTER TYPE "QueueEventType" ADD VALUE 'ENTRY_RESERVED' BEFORE 'ENTRY_CHECKED_IN';
ALTER TYPE "QueueEventType" ADD VALUE 'ENTRY_CONFIRMED' BEFORE 'ENTRY_CHECKED_IN';
ALTER TYPE "QueueEventType" ADD VALUE 'ENTRY_CANCELLED' BEFORE 'ENTRY_CHECKED_IN';

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN     "reservationExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "refundedPaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "razorpayRefundId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_queueEntryId_key" ON "Payment"("queueEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "Payment_hospitalId_idx" ON "Payment"("hospitalId");

-- CreateIndex
CREATE INDEX "Payment_accountId_idx" ON "Payment"("accountId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_razorpayRefundId_key" ON "Refund"("razorpayRefundId");

-- CreateIndex
CREATE INDEX "Refund_hospitalId_idx" ON "Refund"("hospitalId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
