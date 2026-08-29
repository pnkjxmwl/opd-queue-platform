import { z } from 'zod';

/**
 * Queue entry lifecycle. See docs/PRD.md 7.3 and docs/Architecture.md 5.1.
 *
 * Happy path:
 *   CONFIRMED -> VIRTUAL_WAITING -> CHECKED_IN -> READY -> CALLED
 *             -> IN_CONSULTATION -> COMPLETED
 *
 * RESERVED is the pre-payment hold (Phase 5). The terminal/alternate states are
 * CANCELLED, NO_SHOW, SKIPPED and RESCHEDULED.
 *
 * The legal transitions between these live in the Phase-4 state machine, NOT here.
 * This enum only names the states.
 */
export const QueueEntryStatus = z.enum([
  'RESERVED',
  'CONFIRMED',
  'VIRTUAL_WAITING',
  'CHECKED_IN',
  'READY',
  'CALLED',
  'IN_CONSULTATION',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'SKIPPED',
  'RESCHEDULED',
]);

export type QueueEntryStatus = z.infer<typeof QueueEntryStatus>;
