import { useMemo } from 'react';
import type { MyQueueEntry, Paginated, QueueEntryStatus } from '@opd/contracts';
import type { IconName } from './icon';
import { useApi } from './api';
import { Pill } from './discovery';

/**
 * The ONE path every screen uses for "my active visits".
 *
 * A constant rather than a literal per screen, because the path IS the TanStack
 * cache key: a single character of drift silently becomes a second cache entry and a
 * second poller for the same data.
 */
export const MY_ACTIVE_ENTRIES = '/me/queue-entries?scope=active&limit=50';

/**
 * How a patient's own entry is described on screen.
 *
 * docs/Design.md 5.3 and 8: status is never colour alone - every value here carries
 * a written label and an icon, so it still reads for a colour-blind user or on a
 * phone in bright sunlight outside a hospital.
 *
 * The wording is the PATIENT's, not the system's. "SKIPPED" is a state machine
 * value; "Missed - see reception" is what a person needs to be told, and it says
 * what to do rather than what happened.
 */
const ENTRY_LABEL: Record<
  QueueEntryStatus,
  { label: string; tone: 'success' | 'info' | 'warning' | 'neutral'; icon: IconName }
> = {
  RESERVED: { label: 'Awaiting payment', tone: 'warning', icon: 'clock' },
  CONFIRMED: { label: 'Booked', tone: 'info', icon: 'check-circle' },
  VIRTUAL_WAITING: { label: 'Waiting from home', tone: 'info', icon: 'home' },
  CHECKED_IN: { label: 'Checked in', tone: 'success', icon: 'check-circle' },
  // Reserved and unreachable in v1, but the map must be total for the type to hold.
  READY: { label: 'Ready', tone: 'success', icon: 'check-circle' },
  CALLED: { label: 'Your turn - go in', tone: 'success', icon: 'bell' },
  IN_CONSULTATION: { label: 'With the doctor', tone: 'success', icon: 'activity' },
  COMPLETED: { label: 'Completed', tone: 'neutral', icon: 'check' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: 'slash' },
  NO_SHOW: { label: 'Missed', tone: 'warning', icon: 'user-x' },
  SKIPPED: { label: 'Missed - see reception', tone: 'warning', icon: 'alert-triangle' },
  RESCHEDULED: { label: 'To be rescheduled', tone: 'warning', icon: 'calendar' },
};

export function EntryStatusPill({ status }: { status: QueueEntryStatus }) {
  return <Pill {...ENTRY_LABEL[status]} />;
}

/**
 * The one line that answers "what do I do now?".
 *
 * Every string here is derived from server state and never from a client-side rule
 * about the queue (docs/CLAUDE.md 9). It only rephrases what the server said.
 */
export function nextStepFor(entry: MyQueueEntry): string {
  switch (entry.status) {
    case 'RESERVED':
      return 'Your place is held until you pay. Finish the payment to get your token.';
    case 'CONFIRMED':
    case 'VIRTUAL_WAITING':
      return entry.checkedInAheadCount === 0 && entry.bookedAheadCount === 0
        ? 'You are first in line. Reach the hospital and check in at reception.'
        : 'Wait comfortably. Reach the hospital in time to check in at reception.';
    case 'CHECKED_IN':
    case 'READY':
      return 'You are checked in. Stay nearby - you will be called by token number.';
    case 'CALLED':
      return 'You have been called. Please go in now.';
    case 'IN_CONSULTATION':
      return 'You are with the doctor.';
    case 'SKIPPED':
      return 'Your turn was missed. Speak to reception to be put back in the queue.';
    case 'NO_SHOW':
      return 'This visit was marked as missed.';
    case 'RESCHEDULED':
      return 'The session ended before your turn. The hospital will rebook you.';
    case 'CANCELLED':
      return 'This booking was cancelled.';
    case 'COMPLETED':
      return 'This visit is complete.';
  }
}

/** Minutes and seconds left on an unpaid hold, or null once it has lapsed. */
export function holdRemaining(expiresAt: string | null, now: number): string | null {
  if (expiresAt === null) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// "Have I already booked this session?"
// ---------------------------------------------------------------------------

/**
 * What this account holds in one session.
 *
 * `reserved` outranks `booked` deliberately: an unfinished payment is the thing the
 * patient needs to act on, and burying it behind a token they have not paid for is
 * how a hold quietly lapses.
 */
export type BookingState =
  | { kind: 'none' }
  | { kind: 'reserved'; entry: MyQueueEntry }
  | { kind: 'booked'; entry: MyQueueEntry; count: number };

export function bookingStateFor(entries: MyQueueEntry[] | undefined): BookingState {
  if (entries === undefined || entries.length === 0) {
    return { kind: 'none' };
  }
  const reserved = entries.find((entry) => entry.status === 'RESERVED');
  if (reserved !== undefined) {
    return { kind: 'reserved', entry: reserved };
  }
  // Lowest token first, so a family with two bookings always sees the same one named
  // rather than whichever the API happened to return first.
  const sorted = [...entries].sort((a, b) => a.tokenNumber - b.tokenNumber);
  return { kind: 'booked', entry: sorted[0]!, count: sorted.length };
}

/**
 * Every active entry this account holds, grouped by session.
 *
 * Used by discovery screens to answer "have I already booked this?" without the
 * server having to tell them. Both halves of that answer are server truth - this
 * only joins them for rendering, which is not the client deciding queue state
 * (docs/Rules.md 1).
 *
 * **The discovery response deliberately does NOT carry this.** `SessionCard` is
 * impersonal by design and docs/Phases.md Phase 9 plans to CACHE discovery; adding a
 * per-account field would make every response caller-specific and destroy that, for
 * a fact the client can derive from data it already holds.
 *
 * No extra request: this is the same path - and therefore the same cache entry - the
 * My Visits tab and the token card already use.
 */
export function useMyActiveEntries(enabled = true): {
  bySession: Map<string, MyQueueEntry[]>;
  isPending: boolean;
} {
  const query = useApi<Paginated<MyQueueEntry>>(MY_ACTIVE_ENTRIES, enabled);

  const bySession = useMemo(() => {
    const map = new Map<string, MyQueueEntry[]>();
    for (const entry of query.data?.items ?? []) {
      const existing = map.get(entry.sessionId);
      if (existing === undefined) {
        map.set(entry.sessionId, [entry]);
      } else {
        existing.push(entry);
      }
    }
    return map;
  }, [query.data]);

  return { bySession, isPending: query.isPending };
}
