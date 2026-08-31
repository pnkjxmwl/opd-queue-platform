-- Phase 4 - the queue engine (docs/Phases.md Phase 4, docs/Architecture.md 7).
--
-- Four tables and five enums. Two of the changes are to EXISTING tables and are the
-- ones worth reading twice:
--
--   * Patient.accountId becomes nullable, because a walk-in registered at reception
--     has no app account at all (docs/PRD.md 6.3). The alternatives were a shell
--     Account per walk-in, attributing the patient to the receptionist (a lie in the
--     data), or holding a walk-in's name on QueueEntry so the same person is modelled
--     two ways depending on how they arrived. This widens a constraint, so it applies
--     to existing rows without touching them.
--
--   * OPDSession.pausedAt, rather than a PAUSED value in SessionStatus. A paused
--     session is still ACTIVE - it has not ended and it still accepts joins and
--     check-ins - so a new status value would force every existing status check to
--     learn it in order to keep behaving the same.
--
-- unique(sessionId, tokenNumber) is a DATABASE constraint, never an application
-- check: two staff registering a walk-in at the same instant is a race an
-- application check loses (docs/Rules.md 5).

-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'VIRTUAL_WAITING', 'CHECKED_IN', 'READY', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'SKIPPED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "QueueEntryType" AS ENUM ('ONLINE', 'WALK_IN', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "QueueEntryPriority" AS ENUM ('NORMAL', 'PRIORITY', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('PATIENT', 'STAFF', 'DOCTOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "QueueEventType" AS ENUM ('ENTRY_CHECKED_IN', 'ENTRY_CALLED', 'ENTRY_RECALLED', 'ENTRY_CONSULTATION_STARTED', 'ENTRY_CONSULTATION_COMPLETED', 'ENTRY_SKIPPED', 'ENTRY_NO_SHOW', 'ENTRY_REQUEUED', 'ENTRY_PRIORITY_CHANGED', 'ENTRY_RESCHEDULED', 'WALK_IN_ADDED', 'SESSION_ACTIVATED', 'SESSION_PAUSED', 'SESSION_RESUMED', 'SESSION_ENDED', 'DOCTOR_PRESENCE_CHANGED');

-- DropForeignKey
ALTER TABLE "Patient" DROP CONSTRAINT "Patient_accountId_fkey";

-- AlterTable
ALTER TABLE "Patient" ALTER COLUMN "accountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OPDSession" ADD COLUMN     "pausedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "accountId" TEXT,
    "tokenNumber" INTEGER NOT NULL,
    "tokenLabel" TEXT NOT NULL,
    "type" "QueueEntryType" NOT NULL,
    "priority" "QueueEntryPriority" NOT NULL DEFAULT 'NORMAL',
    "priorityAt" TIMESTAMP(3),
    "status" "QueueEntryStatus" NOT NULL,
    "checkInCode" TEXT,
    "recallCount" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInAt" TIMESTAMP(3),
    "calledAt" TIMESTAMP(3),
    "consultStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEvent" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "entryId" TEXT,
    "type" "QueueEventType" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consultation" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_checkInCode_key" ON "QueueEntry"("checkInCode");

-- CreateIndex
CREATE INDEX "QueueEntry_hospitalId_idx" ON "QueueEntry"("hospitalId");

-- CreateIndex
CREATE INDEX "QueueEntry_sessionId_status_idx" ON "QueueEntry"("sessionId", "status");

-- CreateIndex
CREATE INDEX "QueueEntry_accountId_idx" ON "QueueEntry"("accountId");

-- CreateIndex
CREATE INDEX "QueueEntry_patientId_idx" ON "QueueEntry"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_sessionId_tokenNumber_key" ON "QueueEntry"("sessionId", "tokenNumber");

-- CreateIndex
CREATE INDEX "QueueEvent_sessionId_createdAt_idx" ON "QueueEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueEvent_hospitalId_createdAt_idx" ON "QueueEvent"("hospitalId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueEvent_entryId_idx" ON "QueueEvent"("entryId");

-- CreateIndex
CREATE INDEX "AuditLog_hospitalId_createdAt_idx" ON "AuditLog"("hospitalId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_queueEntryId_key" ON "Consultation"("queueEntryId");

-- CreateIndex
CREATE INDEX "Consultation_hospitalId_idx" ON "Consultation"("hospitalId");

-- CreateIndex
CREATE INDEX "Consultation_doctorId_endedAt_idx" ON "Consultation"("doctorId", "endedAt");

-- CreateIndex
CREATE INDEX "Consultation_patientId_idx" ON "Consultation"("patientId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OPDSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OPDSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "QueueEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
