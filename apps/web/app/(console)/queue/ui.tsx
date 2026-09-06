import type { OPDSession, QueueEntryPriority, QueueEntryStatus } from '@opd/contracts';
import { Badge, type BadgeTone } from '../../../components/ui';
import type { IconName } from '../../../components/icon';

/**
 * The queue's presentation vocabulary - the words and marks a status is allowed to
 * be said with, in one place so two screens cannot word the same state differently.
 *
 * Everything visual comes from `components/ui`; what lives here is the mapping from
 * a domain enum to a tone, an icon and a sentence in English.
 */

/**
 * docs/Design.md 2.4, transcribed - **now with the icons that table always
 * specified and no screen ever rendered.**
 *
 * Colour was doing the work alone, which docs/Design.md 8 forbids, and the words
 * were carrying the rest at 12px grey. "Called" and "Completed" are one glance apart
 * on a busy board and were the same shape.
 *
 * RESERVED and RESCHEDULED are not in the design table because no patient-facing
 * screen shows them; the console does, so they get the neutral treatment and an
 * honest label rather than falling through to a blank pill.
 */
const STATUS: Record<QueueEntryStatus, { label: string; tone: BadgeTone; icon: IconName }> = {
  RESERVED: { label: 'Unpaid hold', tone: 'neutral', icon: 'clock' },
  CONFIRMED: { label: 'Booked', tone: 'info', icon: 'home' },
  VIRTUAL_WAITING: { label: 'Waiting', tone: 'info', icon: 'home' },
  CHECKED_IN: { label: 'Checked in', tone: 'teal', icon: 'check-circle' },
  READY: { label: 'Checked in', tone: 'teal', icon: 'check-circle' },
  CALLED: { label: 'Called', tone: 'warning', icon: 'bell' },
  IN_CONSULTATION: { label: 'In consultation', tone: 'success', icon: 'stethoscope' },
  COMPLETED: { label: 'Completed', tone: 'neutral', icon: 'check' },
  NO_SHOW: { label: 'No-show', tone: 'danger', icon: 'user-x' },
  SKIPPED: { label: 'Skipped', tone: 'warning', icon: 'skip-forward' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: 'slash' },
  RESCHEDULED: { label: 'Rescheduled', tone: 'neutral', icon: 'refresh-cw' },
};

export function StatusPill({ status }: { status: QueueEntryStatus }) {
  const { label, tone, icon } = STATUS[status];
  return (
    <Badge tone={tone} icon={icon}>
      {label}
    </Badge>
  );
}

/** The one place a status becomes English, so two screens cannot word it differently. */
export const statusLabel = (status: QueueEntryStatus): string => STATUS[status].label;

/**
 * Escalation, shown only when there IS one.
 *
 * A "Normal" badge on every row would be noise that hides the two rows that matter,
 * and those two are the whole reason the column exists.
 */
export function PriorityPill({ priority }: { priority: QueueEntryPriority }) {
  if (priority === 'NORMAL') return null;
  return (
    <Badge tone="danger" icon="alert-triangle">
      {priority === 'EMERGENCY' ? 'Emergency' : 'Priority'}
    </Badge>
  );
}

/**
 * The state of a whole session, in the words staff use rather than the enum.
 *
 * `OPEN_FOR_REGISTRATION` was being printed with its underscores stripped, so the
 * session list read "OPEN FOR REGISTRATION" in a 12px pill next to "ENDED EARLY".
 * The database's vocabulary is not the receptionist's.
 */
const SESSION: Record<string, { label: string; tone: BadgeTone; icon: IconName }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'neutral', icon: 'calendar' },
  OPEN_FOR_REGISTRATION: { label: 'Taking bookings', tone: 'info', icon: 'inbox' },
  ACTIVE: { label: 'Running', tone: 'success', icon: 'activity' },
  COMPLETED: { label: 'Finished', tone: 'neutral', icon: 'check' },
  ENDED_EARLY: { label: 'Ended early', tone: 'warning', icon: 'alert-triangle' },
  CANCELLED: { label: 'Cancelled', tone: 'danger', icon: 'slash' },
};

export function SessionStatusBadge({ status }: { status: OPDSession['status'] }) {
  const shape = SESSION[status] ?? {
    label: status.replaceAll('_', ' ').toLowerCase(),
    tone: 'neutral' as const,
    icon: 'info' as const,
  };
  return (
    <Badge tone={shape.tone} icon={shape.icon}>
      {shape.label}
    </Badge>
  );
}

/** A session nobody can act on any more. Listed, but not a link to a board. */
export const SESSION_FINISHED = ['COMPLETED', 'CANCELLED', 'ENDED_EARLY'];

/**
 * Instants are stored UTC and rendered in Asia/Kolkata (docs/Rules.md 5), the way
 * the clock is read in India: "7 PM", "6 AM", "10:30 AM".
 *
 * 12-hour, with the ":00" dropped on the hour - the same rule and the same output
 * as `istClock` in the mobile app, so a session reads identically to the patient and
 * to the receptionist looking at them.
 *
 * `en-US` rather than `en-IN`: en-IN renders lowercase "pm", and the two apps have
 * to agree character for character. Intl also emits a narrow no-break space before
 * the meridiem in newer runtimes, which is normalised here so the string can be
 * compared and tested.
 */
const IST_HOUR_MINUTE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export const istTime = (value: Date | string): string =>
  IST_HOUR_MINUTE.format(typeof value === 'string' ? new Date(value) : value)
    .toUpperCase()
    .replace(':00', '')
    // Newer ICU emits a NARROW NO-BREAK SPACE before the meridiem. Matched as
    // whitespace rather than by codepoint so this keeps working whichever space the
    // runtime picks, and so the output matches the mobile app character for character.
    .replace(/\s+(AM|PM)/, ' $1');

export const rupees = (paise: number): string => (paise / 100).toFixed(2);

/**
 * Today, **in IST, resolved on the server**.
 *
 * The browser's idea of today is the 00:30 bug this project already documented once
 * on the session generator: a receptionist opening the console just after midnight
 * must see tonight's date, not yesterday's, and a machine with a wrong timezone must
 * not get to decide that. `en-CA` formats as YYYY-MM-DD, which is exactly the
 * CalendarDate the API wants.
 */
const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
export const istToday = (): string => IST_DATE.format(new Date());

/** "Tue, 9 Sep" - a date a person reads, next to the ISO one a machine needs. */
const IST_LONG = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export const istDateLabel = (date: string): string =>
  // Noon UTC is comfortably inside the IST day whatever the runtime's own zone.
  IST_LONG.format(new Date(`${date}T12:00:00Z`));

/**
 * The token, as the console's one recognisable object.
 *
 * Re-exported from the design system rather than redefined, because the check-in
 * desk, the walk-in list, the board and the session list all show one and all drew
 * it differently.
 */
export { TokenChip, SuccessBanner } from '../../../components/ui';

/** Kept: the board and the desk still import a class for a bare token string. */
export const token = 'font-semibold tabular-nums tracking-tight text-ink';
