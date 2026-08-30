-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'OPEN_FOR_REGISTRATION', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ENDED_EARLY');

-- CreateEnum
CREATE TYPE "DoctorPresence" AS ENUM ('NOT_PRESENT', 'PRESENT', 'ON_BREAK', 'LEFT');

-- CreateEnum
CREATE TYPE "OrderingStrategy" AS ENUM ('TOKEN_ORDER');

-- CreateEnum
CREATE TYPE "RequeueBehavior" AS ENUM ('END_OF_QUEUE', 'NO_REQUEUE');

-- AlterTable
-- Config is deactivated, never deleted: Doctor and OPDSession reference these rows
-- with onDelete: Restrict, so a hard DELETE stops working the day a row is first used.
ALTER TABLE "Department" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Doctor" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DoctorSchedule" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "weekday" INTEGER,
    "date" DATE,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "defaultFeePaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueuePolicy" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "orderingStrategy" "OrderingStrategy" NOT NULL,
    "checkInRequired" BOOLEAN NOT NULL,
    "walkInEnabled" BOOLEAN NOT NULL,
    "priorityEnabled" BOOLEAN NOT NULL,
    "gracePeriodSec" INTEGER NOT NULL,
    "recallAttempts" INTEGER NOT NULL,
    "requeueBehavior" "RequeueBehavior" NOT NULL,
    "cutoffOnEtaOverrun" BOOLEAN NOT NULL,
    "cutoffMinsBeforeEnd" INTEGER,
    "maxOnlineTokens" INTEGER,
    "arriveBeforeMins" INTEGER NOT NULL,
    "cancellationRules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueuePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OPDSession" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "originalDoctorId" TEXT NOT NULL,
    "currentProviderDoctorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN_FOR_REGISTRATION',
    "doctorPresence" "DoctorPresence" NOT NULL DEFAULT 'NOT_PRESENT',
    "tokenPrefix" TEXT NOT NULL DEFAULT 'A',
    "feePaise" INTEGER NOT NULL,
    "registrationClosedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OPDSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorSchedule_hospitalId_idx" ON "DoctorSchedule"("hospitalId");

-- CreateIndex
CREATE INDEX "DoctorSchedule_doctorId_idx" ON "DoctorSchedule"("doctorId");

-- CreateIndex
CREATE UNIQUE INDEX "QueuePolicy_hospitalId_key" ON "QueuePolicy"("hospitalId");

-- CreateIndex
CREATE INDEX "OPDSession_hospitalId_date_idx" ON "OPDSession"("hospitalId", "date");

-- CreateIndex
CREATE INDEX "OPDSession_hospitalId_status_idx" ON "OPDSession"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "OPDSession_departmentId_idx" ON "OPDSession"("departmentId");

-- CreateIndex
CREATE INDEX "OPDSession_scheduleId_idx" ON "OPDSession"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "OPDSession_originalDoctorId_date_scheduledStart_key" ON "OPDSession"("originalDoctorId", "date", "scheduledStart");

-- AddForeignKey
ALTER TABLE "DoctorSchedule" ADD CONSTRAINT "DoctorSchedule_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorSchedule" ADD CONSTRAINT "DoctorSchedule_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueuePolicy" ADD CONSTRAINT "QueuePolicy_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OPDSession" ADD CONSTRAINT "OPDSession_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OPDSession" ADD CONSTRAINT "OPDSession_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OPDSession" ADD CONSTRAINT "OPDSession_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "DoctorSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OPDSession" ADD CONSTRAINT "OPDSession_originalDoctorId_fkey" FOREIGN KEY ("originalDoctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OPDSession" ADD CONSTRAINT "OPDSession_currentProviderDoctorId_fkey" FOREIGN KEY ("currentProviderDoctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma cannot express. docs/Rules.md 5: prefer a database constraint
-- over an application check - an application check loses races.
-- Kept to the invariants the Phase-4 engine actually relies on; the rest are Zod's job.
-- ---------------------------------------------------------------------------

-- A schedule is EITHER recurring (weekday) OR a one-off (date). Never both, never neither.
ALTER TABLE "DoctorSchedule"
  ADD CONSTRAINT "DoctorSchedule_recurrence_exclusive"
  CHECK (("weekday" IS NULL) <> ("date" IS NULL));

-- 0=Sunday .. 6=Saturday, in Asia/Kolkata.
ALTER TABLE "DoctorSchedule"
  ADD CONSTRAINT "DoctorSchedule_weekday_range"
  CHECK ("weekday" IS NULL OR ("weekday" BETWEEN 0 AND 6));

-- Zero-padded 24-hour HH:mm, which is what makes the ordering check below a valid
-- string comparison.
ALTER TABLE "DoctorSchedule"
  ADD CONSTRAINT "DoctorSchedule_time_format"
  CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND "endTime"   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "DoctorSchedule"
  ADD CONSTRAINT "DoctorSchedule_end_after_start"
  CHECK ("endTime" > "startTime");

ALTER TABLE "DoctorSchedule"
  ADD CONSTRAINT "DoctorSchedule_fee_non_negative"
  CHECK ("defaultFeePaise" >= 0);

ALTER TABLE "OPDSession"
  ADD CONSTRAINT "OPDSession_end_after_start"
  CHECK ("scheduledEnd" > "scheduledStart");

ALTER TABLE "OPDSession"
  ADD CONSTRAINT "OPDSession_fee_non_negative"
  CHECK ("feePaise" >= 0);

-- The engine reads these on every decision; a negative one fails silently and weirdly.
ALTER TABLE "QueuePolicy"
  ADD CONSTRAINT "QueuePolicy_non_negative_thresholds"
  CHECK ("gracePeriodSec" >= 0
     AND "recallAttempts" >= 0
     AND "arriveBeforeMins" >= 0
     AND ("cutoffMinsBeforeEnd" IS NULL OR "cutoffMinsBeforeEnd" >= 0)
     AND ("maxOnlineTokens" IS NULL OR "maxOnlineTokens" >= 1));
