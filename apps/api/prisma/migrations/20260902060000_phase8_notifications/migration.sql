-- Phase 8 (P8-DB-01): push tokens and the notification outbox.
--
-- Hand-written rather than generated (trap 7 in docs/PROGRESS.md), then proved
-- equivalent to the datamodel with `prisma migrate diff --exit-code`.
--
-- Additive only: two new tables, no column dropped, no data rewritten. Nothing here
-- can fail on a database that already has patients in it.

CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "disabledAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- On the TOKEN alone, not on (accountId, token): a physical device can be handed to
-- somebody else, and re-registering must MOVE the token to the new account rather
-- than leave two rows routing one device's pushes to two people.
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");
CREATE INDEX "PushToken_accountId_idx" ON "PushToken"("accountId");
CREATE INDEX "PushToken_disabledAt_idx" ON "PushToken"("disabledAt");

ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entryId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- THE STORM GUARD. One message of one type per booking, enforced by the database
-- because an application check loses the race the first time two ticks overlap
-- (docs/Rules.md 5, docs/Phases.md "cap and dedupe per patient").
CREATE UNIQUE INDEX "Notification_entryId_type_key" ON "Notification"("entryId", "type");
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");
CREATE INDEX "Notification_accountId_idx" ON "Notification"("accountId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "QueueEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
