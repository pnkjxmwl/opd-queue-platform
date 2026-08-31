-- "Move to end" (docs/PRD.md 8.8, RequeueBehavior.END_OF_QUEUE) needs somewhere to
-- record that an entry went to the back, because the call order is COMPUTED and the
-- token number is immutable - so there is nothing else to change.
--
-- Requeued entries sort after everyone who has never been requeued, then among
-- themselves by when they were requeued. Without this column a skipped patient with
-- an early token is handed straight back to the doctor, which is the loop the grace
-- period exists to prevent.

-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN     "requeuedAt" TIMESTAMP(3);
