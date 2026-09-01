import { z } from 'zod';

/**
 * P7-CONTRACT-01 · the realtime wire (docs/Architecture.md 9).
 *
 * **Realtime is a distribution mechanism, never a source of truth** (docs/Rules.md 8).
 * Everything here is therefore deliberately thin: an event says *that* something
 * changed and carries only what a client needs to decide whether it cares. The state
 * itself comes from the REST snapshot the client already knows how to fetch.
 *
 * That is not minimalism for its own sake. A client that applies deltas can drift
 * from the server the moment one event is missed, reordered or replayed - and the
 * whole point of a queue is that everyone is looking at the same one. A client that
 * re-reads cannot drift, so a dropped connection costs a refetch instead of
 * correctness.
 */

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/**
 * Everyone watching one session's queue: patients browsing it, the doctor, and
 * reception. **Nothing patient-identifying is ever broadcast here** - see
 * `SessionUpdatedEvent`.
 */
export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;

/**
 * One account's private channel: their own entries, and nothing else. The server
 * joins it from the JWT at connect, so a client cannot ask for somebody else's.
 */
export const accountRoom = (accountId: string): string => `account:${accountId}`;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Wire names. String constants rather than an enum so they read the same in a log,
 * a test and a browser devtools frame.
 */
export const REALTIME_EVENT = {
  /** To `session:{id}` after any command commits. */
  sessionUpdated: 'session.updated',
  /** To `account:{id}` when one of that account's entries moved. */
  entryUpdated: 'entry.updated',
} as const;

export type RealtimeEventName = (typeof REALTIME_EVENT)[keyof typeof REALTIME_EVENT];

/** Client → server. The only thing a client may ask for. */
export const SubscribeRequest = z.object({ sessionId: z.string().uuid() });
export type SubscribeRequest = z.infer<typeof SubscribeRequest>;

export const SubscribeAck = z.object({
  ok: z.boolean(),
  /** Present only on a refusal, and deliberately vague - see the gateway. */
  error: z.string().optional(),
});
export type SubscribeAck = z.infer<typeof SubscribeAck>;

/**
 * Broadcast to everyone watching a session: "this queue moved - re-read it."
 *
 * **It carries no queue state, deliberately.** The first draft of this shape carried
 * a whole `QueueSnapshot` so a client could drop it into cache without a refetch.
 * Two things killed that:
 *
 * 1. **Nobody wanted it.** The console re-renders on the server and ignores any
 *    payload; the mobile app invalidates a TanStack query and refetches. Neither
 *    would have read a field of it.
 * 2. **It needed a second definition of "the live queue".** Those numbers are an
 *    aggregation `discovery` builds, batched across a page of cards; rebuilding them
 *    inside the queue engine, per command, would be a duplicate that could disagree
 *    with the REST read - and disagreeing about the queue is the one thing this
 *    product cannot do.
 *
 * So the event is a doorbell. The REST snapshot stays the only description of the
 * queue, which is the reconnect contract (docs/Rules.md 8) applied all the time
 * rather than only after a drop. It also makes the DPDP question trivial: a payload
 * with no queue data in it cannot leak another patient's anything.
 */
export const SessionUpdatedEvent = z.object({
  sessionId: z.string().uuid(),
  /**
   * `OPDSession.version`, bumped by every command.
   *
   * A client discards this event only when it already holds a **strictly greater**
   * version - that is how an out-of-order delivery is dropped instead of applied
   * backwards. An EQUAL version still means re-read: the periodic ETA tick
   * re-broadcasts the current version precisely because nothing was commanded and
   * the window moved anyway, time having passed.
   */
  version: z.number().int().nonnegative(),
});
export type SessionUpdatedEvent = z.infer<typeof SessionUpdatedEvent>;

/**
 * "Something about your entry changed - go and look."
 *
 * Carries no status and no ETA **on purpose**. The client refetches
 * `GET /me/queue-entries`, which is the same path it uses on cold start and after a
 * reconnect, so there is exactly one way for a patient's screen to learn what is
 * true. An event that carried the status would create a second one, and the two
 * would disagree the first time an event arrived late.
 */
export const EntryUpdatedEvent = z.object({
  entryId: z.string().uuid(),
  sessionId: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
export type EntryUpdatedEvent = z.infer<typeof EntryUpdatedEvent>;
