import type { SessionEta } from '@opd/contracts';

/**
 * How fast this clinic is actually moving, for the person standing at the desk.
 *
 * **Everything here was already being calculated and thrown away.** The engine has
 * produced the doctor's pace, what it is based on, and whether today is running
 * behind since Phase 7, and the API has served it at `GET /sessions/:id/eta` the
 * whole time - no screen ever asked. A receptionist deciding whether to warn the
 * waiting room had to guess at a number the server already knew.
 *
 * Written for one question at a time:
 *
 *   "Is the queue on time?"      -> the running-behind line, or its absence
 *   "How long is each patient?"  -> the pace, with what it is based on
 *   "Why is the wait so long?"   -> handover, the gap the ETA used to ignore
 *
 * **Every figure says what it stands on.** A pace drawn from four consultations and
 * one drawn from forty are not the same claim, and a doctor deciding whether to
 * trust the board deserves to know which they are looking at - the same reasoning
 * that put `basis` in the contract rather than only a number.
 */
export function Pace({ eta }: { eta: SessionEta }) {
  return (
    <section
      aria-label="How the clinic is running"
      className="mt-6 rounded-lg border border-line bg-surface p-5 shadow-md"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3">How today is running</h2>
        {eta.runningBehind ? (
          // Label and icon, never colour alone (docs/Design.md). A board read across
          // a room in daylight, by somebody who may not distinguish red from green.
          <span className="inline-flex items-center gap-1 rounded-md bg-warning-bg px-2 py-1 text-caption text-warning">
            <span aria-hidden>▲</span> Running behind
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-canvas px-2 py-1 text-caption text-ink-muted">
            <span aria-hidden>●</span> On its usual pace
          </span>
        )}
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <Figure
          label="Per patient"
          value={`${eta.expectedConsultMins} min`}
          note={CONSULT_BASIS[eta.basis](eta.sampleSize)}
        />
        <Figure
          label="Between patients"
          value={`${eta.deadTimeMins} min`}
          note={
            eta.deadTimeBasis === 'MEASURED'
              ? `measured from ${eta.deadTimeSamples} handover${eta.deadTimeSamples === 1 ? '' : 's'}`
              : eta.deadTimeSamples === 0
                ? 'starting estimate — no handovers yet'
                : `starting estimate — ${eta.deadTimeSamples} so far, needs 2`
          }
        />
        <Figure
          label="If someone joined now"
          value={eta.joinNowEtaFrom === null ? '—' : window(eta.joinNowEtaFrom, eta.joinNowEtaTo)}
          note={
            eta.joinNowEtaFrom === null
              ? 'not accepting patients right now'
              : 'the window a patient is shown'
          }
        />
      </dl>

      {eta.runningBehind && (
        <p className="mt-4 text-body text-ink-muted">
          Consultations are taking materially longer than this doctor’s usual pace. Anyone waiting
          will be seen later than their token suggested — worth telling the room.
        </p>
      )}
    </section>
  );
}

/**
 * What the pace figure is built from, in words rather than a code.
 *
 * SEED is the one that matters: it means nothing has been measured and the number is
 * the doctor's configured default. Presenting that identically to a figure drawn from
 * forty real consultations would be the board's first lie.
 */
const CONSULT_BASIS: Record<SessionEta['basis'], (n: number) => string> = {
  SEED: () => 'the doctor’s default — nothing measured yet',
  DOCTOR_HISTORY: (n) => `from ${n} past consultation${n === 1 ? '' : 's'}`,
  TODAY: (n) => `from ${n} consultation${n === 1 ? '' : 's'}, today weighted highest`,
};

/** IST, the only clock a hospital in India reads (docs/Rules.md 5). */
const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
});

function window(from: string, to: string | null): string {
  const start = clock.format(new Date(from));
  if (to === null) return start;
  return `${start}–${clock.format(new Date(to))}`;
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      {/* Tabular numerals so figures line up rather than jitter as they change. */}
      <dd className="mt-1 text-h3 tabular-nums text-ink">{value}</dd>
      <p className="mt-1 text-caption text-ink-muted">{note}</p>
    </div>
  );
}
