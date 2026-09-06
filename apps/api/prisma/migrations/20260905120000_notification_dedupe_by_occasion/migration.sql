-- Notifications dedupe by OCCASION, not by booking.
--
-- `unique(entryId, type)` meant one CALLED per booking for all time. The no-show
-- flow is: called -> grace -> recalled -> grace -> skipped -> requeued -> **called
-- again**. That second call is a second CALLED for the same entry, so the constraint
-- swallowed it and the one patient who had already missed a call was the only one
-- never told about the next one - while the SKIPPED push they had just received
-- said "you will be called again".
--
-- Two columns replace it:
--   dedupeKey     - the constraint. The QueueEvent id for anything an event caused,
--                   so each call is its own occasion; `<entryId>:<type>` for a
--                   prediction like LEAVE_NOW, which still fires once per booking.
--   sourceEventId - a real FK, so the notifier can ask for events with no
--                   notification and have Postgres apply that BEFORE the row limit.
--
-- Backfilled, not destructive: every existing row keeps its identity and its
-- once-per-booking meaning, because `<entryId>:<type>` is exactly what the old
-- constraint enforced. Rows with no entry (account-level messages) fall back to the
-- row id, which is unique by construction.

ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN "sourceEventId" TEXT;

UPDATE "Notification"
   SET "dedupeKey" = COALESCE("entryId" || ':' || "type", "id");

ALTER TABLE "Notification" ALTER COLUMN "dedupeKey" SET NOT NULL;

DROP INDEX IF EXISTS "Notification_entryId_type_key";

CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_sourceEventId_idx" ON "Notification"("sourceEventId");

-- CASCADE: a QueueEvent is append-only and never deleted on its own, so this only
-- ever fires when the hospital above it is removed - at which point the notification
-- it produced should go too.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_sourceEventId_fkey"
    FOREIGN KEY ("sourceEventId") REFERENCES "QueueEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
