import type { QueueEntryPriority, QueueEntryStatus } from '@opd/contracts';

/**
 * The queue console's own presentation bits.
 *
 * Deliberately additive to `../config/ui.tsx` rather than a rewrite: the shell, the
 * buttons, the error banner and the pager are already there and already match
 * docs/Design.md. What is here is what a queue has and a config form does not - a
 * status vocabulary and a token.
 */

/**
 * docs/Design.md 2.4, transcribed. **Every status carries a WORD**, because
 * docs/Design.md 8 forbids colour-only meaning and a receptionist working a busy
 * desk under fluorescent light is exactly who that rule protects.
 *
 * RESERVED and RESCHEDULED are not in the design table because no patient-facing
 * screen shows them; the console does, so they get the neutral treatment and an
 * honest label rather than being left to fall through to a blank pill.
 */
const STATUS: Record<QueueEntryStatus, { label: string; className: string }> = {
  RESERVED: { label: 'Unpaid hold', className: 'bg-canvas text-ink-muted' },
  CONFIRMED: { label: 'Booked', className: 'bg-info-bg text-info' },
  VIRTUAL_WAITING: { label: 'Waiting', className: 'bg-info-bg text-info' },
  CHECKED_IN: { label: 'Checked in', className: 'bg-teal-100 text-teal-800' },
  READY: { label: 'Checked in', className: 'bg-teal-100 text-teal-800' },
  CALLED: { label: 'Called', className: 'bg-warning-bg text-warning' },
  IN_CONSULTATION: { label: 'In consultation', className: 'bg-success-bg text-success' },
  COMPLETED: { label: 'Completed', className: 'bg-canvas text-ink-muted' },
  NO_SHOW: { label: 'No-show', className: 'bg-danger-bg text-danger' },
  SKIPPED: { label: 'Skipped', className: 'bg-warning-bg text-warning' },
  CANCELLED: { label: 'Cancelled', className: 'bg-canvas text-ink-disabled' },
  RESCHEDULED: { label: 'Rescheduled', className: 'bg-canvas text-ink-muted' },
};

export function StatusPill({ status }: { status: QueueEntryStatus }) {
  const { label, className } = STATUS[status];
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-caption ${className}`}>
      {label}
    </span>
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
    <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-danger-bg px-2 py-0.5 text-caption text-danger">
      {priority === 'EMERGENCY' ? '▲ Emergency' : '▲ Priority'}
    </span>
  );
}

/** Tabular numerals: docs/Design.md 8 requires them for anything that changes. */
export const token = 'font-semibold tabular-nums text-ink';

/**
 * Instants are stored UTC and rendered in Asia/Kolkata (docs/Rules.md 5), the way
 * the clock is read in India: "7 PM", "6 AM", "10:30 AM".
 *
 * 12-hour, with the ":00" dropped on the hour - the same rule and the same output
 * as `istClock` in the mobile app, so a session reads identically to the patient
 * and to the receptionist looking at them.
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
 * A confirmation that something happened, as the counterpart to `ErrorBanner`.
 *
 * Not colour alone: the tick and the word carry the meaning. This matters more on
 * the check-in desk than anywhere else in the product - a receptionist glancing at a
 * screen between two patients needs "A004 · Anita Sharma checked in", not a green
 * rectangle.
 */
export function SuccessBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="mb-4 flex items-start gap-2 rounded-md bg-success-bg px-3 py-2 text-body-lg text-success"
    >
      <span aria-hidden="true">✓</span>
      <span>{message}</span>
    </p>
  );
}

