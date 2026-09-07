import Link from 'next/link';
import type {
  Doctor,
  OPDSession,
  Paginated,
  QueueEntryStatus,
  QueueEntryView,
  SessionEta,
} from '@opd/contracts';
import { requireStaffHospital } from '../../../../lib/tenant';
import { queueGet } from '../_run';
import { Pace } from '../pace';
import { Icon } from '../../../../components/icon';
import {
  Badge,
  Card,
  Disclosure,
  EmptyState,
  ErrorBanner,
  SuccessBanner,
  TokenChip,
  btn,
  input,
  label,
} from '../../../../components/ui';
import { PriorityPill, SessionStatusBadge, StatusPill, istTime } from '../ui';
import { Live } from '../live';
import {
  callNext,
  cancelEntry,
  changePriority,
  checkInEntry,
  completeConsultation,
  endSession,
  markNoShow,
  pauseQueue,
  requeuePatient,
  resumeQueue,
  setPresence,
  skipPatient,
  startConsultation,
} from './actions';

/**
 * P6-WEB-01 / P6-WEB-04 · the board. docs/Design.md 5.7.
 *
 * **The order on this page is the server's order.** `GET /sessions/:id/queue`
 * returns entries in `CALL_ORDER` - the same comparator `call-next` uses - and this
 * file never sorts. It groups by status for display, which is presentation, and
 * within every group the sequence is exactly what came back. That is the difference
 * between a screen that shows who is next and a screen that has an opinion about it.
 *
 * `call-next` is sent with NO body for the same reason: the doctor asks for the next
 * patient, they never name one.
 *
 * **What the redesign changed, and why:**
 *
 *  - **The rosters are rows, not tables.** Five columns whose widest cell was a
 *    stack of three forms meant every group scrolled sideways on anything under
 *    1200px - including the tablet reception actually uses. A row now reads
 *    `token · patient · status` on one line with its actions at the end, and it
 *    reflows instead of overflowing.
 *  - **The banners are above both columns.** A rejection ("someone already called
 *    this patient") used to render inside the left column, below the fold on a
 *    laptop, under the very button that had just failed.
 *  - **The session's own state is a strip, not four grey pills.** Whether the queue
 *    is paused and where the doctor is are what decide whether the big button will
 *    work at all, so they sit beside it rather than in the page title.
 */

/** One page holds a whole OPD session; the endpoint caps at 200 either way. */
const LIMIT = 200;

/**
 * How a status is grouped on screen. Purely presentational - what is LEGAL is the
 * state machine's business, and the server rejects anything this offers wrongly.
 */
const ELIGIBLE: QueueEntryStatus[] = ['CHECKED_IN', 'READY'];
const NOT_ARRIVED: QueueEntryStatus[] = ['CONFIRMED', 'VIRTUAL_WAITING'];
const FINISHED: QueueEntryStatus[] = ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED'];

const PRESENCE: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' }> = {
  PRESENT: { label: 'Doctor present', tone: 'success' },
  NOT_PRESENT: { label: 'Doctor not here yet', tone: 'neutral' },
  ON_BREAK: { label: 'Doctor on break', tone: 'warning' },
  LEFT: { label: 'Doctor has left', tone: 'warning' },
};

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string; ok?: string; called?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const hospital = await requireStaffHospital();

  const [session, queue, doctors, eta] = await Promise.all([
    queueGet<OPDSession>(`/hospitals/${hospital.id}/sessions/${sessionId}`),
    queueGet<Paginated<QueueEntryView>>(`/sessions/${sessionId}/queue?limit=${LIMIT}`),
    queueGet<Paginated<Doctor>>(`/hospitals/${hospital.id}/doctors?limit=100`),
    // Fourth request, in the same round trip rather than after it. The board already
    // waits on three; making this a fifth sequential await would have added latency
    // to the screen a receptionist reloads most often.
    queueGet<SessionEta>(`/sessions/${sessionId}/eta`),
  ]);

  const doctorName =
    doctors.items.find((d) => d.id === session.currentProviderDoctorId)?.name ?? 'Unknown doctor';

  const entries = queue.items;
  const inConsultation = entries.find((e) => e.status === 'IN_CONSULTATION') ?? null;
  const called = entries.find((e) => e.status === 'CALLED') ?? null;
  const eligible = entries.filter((e) => ELIGIBLE.includes(e.status));
  const skipped = entries.filter((e) => e.status === 'SKIPPED');
  const notArrived = entries.filter((e) => NOT_ARRIVED.includes(e.status));
  const holds = entries.filter((e) => e.status === 'RESERVED');
  const finished = entries.filter((e) => FINISHED.includes(e.status));

  const paused = session.pausedAt !== null;
  const presence = PRESENCE[session.doctorPresence] ?? {
    label: session.doctorPresence.replaceAll('_', ' ').toLowerCase(),
    tone: 'neutral' as const,
  };

  /**
   * The server refuses call-next and start-consultation unless the doctor is PRESENT
   * (docs/PRD.md 10). This is not a second copy of that rule - it reads the answer
   * the server already sent on the session and disables a control that would only
   * come back with an error, exactly as `paused` does above. The API decides; this
   * saves the receptionist a click and a red banner.
   */
  const doctorAway = session.doctorPresence !== 'PRESENT';

  /**
   * Starting and completing a consultation are the doctor's (PRD 6.2), so the API
   * refuses them from RECEPTION. Same contract as `doctorAway`: this only stops a
   * button that would come back 403, and the server is still the one enforcing it
   * (lib/tenant.ts says so at length). ADMIN keeps both - it is the hospital's own
   * account and the only role that can always unstick a clinic.
   */
  const clinicalDenied = hospital.role === 'RECEPTION';
  const AWAY_REASON: Record<string, string> = {
    NOT_PRESENT: 'The doctor has not been marked present yet.',
    ON_BREAK: 'The doctor is on a break.',
    LEFT: 'The doctor has left for the day.',
  };

  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const sessionField = hidden('sessionId', sessionId);

  return (
    <>
      {/* ------------------------------------------------------------------
          Who and when, then what state the session is in, then the two places
          reception goes from here. One block, and it wraps rather than
          truncating - a doctor's name is not something to elide.
      ------------------------------------------------------------------- */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Link
            href="/queue"
            className="mb-1.5 inline-flex items-center gap-1 text-caption text-ink-muted transition-colors hover:text-ink"
          >
            <Icon name="arrow-left" className="h-3 w-3" />
            All sessions
          </Link>
          <h1 className="text-h1 text-ink">{doctorName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge icon="clock">
              <span className="tabular-nums">
                {istTime(session.scheduledStart)}–{istTime(session.scheduledEnd)}
              </span>
            </Badge>
            <SessionStatusBadge status={session.status} />
            {paused && (
              <Badge tone="warning" icon="pause">
                Paused
              </Badge>
            )}
            <Badge tone={presence.tone} icon="user">
              {presence.label}
            </Badge>
          </div>
        </div>

        {/*
          These NAVIGATE; the per-row buttons below ACT. They used to read "Check in"
          and "Walk-in", which made the header link and the row button on a waiting
          patient identical in wording and completely different in effect - the first
          person to use this pressed the row button, checked a patient in instantly,
          and reasonably reported that the camera never opened. Label a link with
          where it goes, not with what happens when you eventually get there.
        */}
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link className={btn('primary')} href={`/queue/${sessionId}/check-in`}>
            <Icon name="camera" className="h-4 w-4" />
            Open check-in desk
          </Link>
          <Link className={btn('quiet')} href={`/queue/${sessionId}/walk-in`}>
            <Icon name="user-plus" className="h-4 w-4" />
            Add a walk-in
          </Link>
        </div>
      </header>

      {/*
        Full width, above both columns.

        A server rejection is the single most important thing on this screen when it
        happens - it is how the console says "someone else already called this
        patient", which is normal on a shared board and must never be missed. It used
        to render inside the left column, which on a laptop put it under the fold.
      */}
      {(query.error !== undefined || query.ok !== undefined || query.called !== undefined) && (
        <div className="mb-4 flex flex-col gap-2">
          <ErrorBanner message={query.error} />
          <SuccessBanner
            message={query.ok ?? (query.called ? `Called ${query.called}` : undefined)}
          />
        </div>
      )}

      {/*
        Two columns, and the left one does not scroll.

        This was a single stack of seven full-width cards, so on any real monitor the
        thing you came here to do - call the next patient - left the screen as soon as
        the queue grew, and "Finished" sat between you and it. The action, the pace
        and the session controls now stay put while only the rosters move.

        It collapses back to one column below `lg`, in the original order.
      */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/*
          `max-h` + its own scroll, not bare `sticky`. A sticky column taller than
          the viewport pins its TOP and leaves the bottom permanently unreachable -
          which on this page is the End-session control, on a laptop, once the
          pace panel is expanded.
        */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:pb-1 lg:pr-1">
          {/* ------------------------------------------------------------------
              The one dominant action (docs/Design.md 5.7). Exactly one of these
              three states is true, and each has a single obvious next step.
          ------------------------------------------------------------------- */}
          <Card title="Now with" tone="accent">
            {inConsultation !== null ? (
              <>
                <Patient entry={inConsultation} />
                <form action={completeConsultation} className="mt-4">
                  {sessionField}
                  {hidden('entryId', inConsultation.id)}
                  <button
                    type="submit"
                    className={btn('primary', 'lg') + ' w-full'}
                    disabled={clinicalDenied}
                  >
                    <Icon name="check" className="h-4 w-4" />
                    Complete consultation
                  </button>
                </form>
                {clinicalDenied && <ClinicalNote />}
              </>
            ) : called !== null ? (
              <>
                <Patient entry={called} />
                <p className="mt-2 flex items-center gap-1.5 text-caption text-warning">
                  <Icon name="bell" className="h-3.5 w-3.5" />
                  Called{called.recallCount > 0 && ` · not seen ${called.recallCount}×`}. Waiting
                  for them to come in.
                </p>
                <form action={startConsultation} className="mt-4">
                  {sessionField}
                  {hidden('entryId', called.id)}
                  <button
                    type="submit"
                    className={btn('primary', 'lg') + ' w-full'}
                    disabled={doctorAway || clinicalDenied}
                  >
                    <Icon name="play" className="h-4 w-4" />
                    Start consultation
                  </button>
                </form>
                {clinicalDenied && <ClinicalNote />}
                {/*
                  Same guard as call-next: the server refuses START_CONSULTATION unless
                  the doctor is present. Completing is deliberately NOT guarded - a
                  patient already in the room must always be closable.
                */}
                {doctorAway && (
                  <div className="mt-2.5">
                    <p className="flex items-start gap-1.5 text-caption text-warning">
                      <Icon name="user" className="mt-0.5 h-3.5 w-3.5" />
                      {AWAY_REASON[session.doctorPresence] ?? 'The doctor is not available.'}
                    </p>
                    <form action={setPresence} className="mt-2">
                      {sessionField}
                      <input type="hidden" name="presence" value="PRESENT" />
                      <button type="submit" className={btn('quiet')}>
                        <Icon name="user" className="h-4 w-4" />
                        Mark doctor present
                      </button>
                    </form>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line-soft pt-3">
                  <form action={skipPatient} className="flex flex-1 items-end gap-2">
                    {sessionField}
                    {hidden('entryId', called.id)}
                    <div className="min-w-0 flex-1">
                      <label className={label + ' sr-only'} htmlFor="skip-reason">
                        Reason for skipping
                      </label>
                      <input
                        id="skip-reason"
                        name="reason"
                        placeholder="Reason (optional)"
                        className={input}
                      />
                    </div>
                    <button type="submit" className={btn('quiet')}>
                      Skip for now
                    </button>
                  </form>
                  <form action={markNoShow}>
                    {sessionField}
                    {hidden('entryId', called.id)}
                    <button type="submit" className={btn('danger')}>
                      No-show
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <p className="text-body text-ink-muted">
                  {eligible.length === 0
                    ? 'Nobody has checked in yet. Patients become callable once reception checks them in.'
                    : `${eligible.length} patient${eligible.length === 1 ? '' : 's'} waiting to be called.`}
                </p>
                <form action={callNext} className="mt-4">
                  {sessionField}
                  <button
                    type="submit"
                    className={btn('primary', 'lg') + ' w-full'}
                    disabled={eligible.length === 0 || paused || doctorAway}
                  >
                    <Icon name="bell" className="h-4 w-4" />
                    Call next
                  </button>
                </form>
                {paused && (
                  <p className="mt-2.5 flex items-start gap-1.5 text-caption text-warning">
                    <Icon name="pause" className="mt-0.5 h-3.5 w-3.5" />
                    The queue is paused — resume it below before calling anyone.
                  </p>
                )}
                {doctorAway && (
                  <div className="mt-2.5">
                    <p className="flex items-start gap-1.5 text-caption text-warning">
                      <Icon name="user" className="mt-0.5 h-3.5 w-3.5" />
                      {AWAY_REASON[session.doctorPresence] ?? 'The doctor is not available.'} Nobody
                      can be called in until someone marks them present.
                    </p>
                    {/*
                      The remedy, next to the thing it unblocks. The presence dropdown
                      further down can still set any of the four states; this is the
                      one a desk actually needs, in one press, where they are looking.
                    */}
                    <form action={setPresence} className="mt-2">
                      {sessionField}
                      <input type="hidden" name="presence" value="PRESENT" />
                      <button type="submit" className={btn('quiet')}>
                        <Icon name="user" className="h-4 w-4" />
                        Mark doctor present
                      </button>
                    </form>
                  </div>
                )}
              </>
            )}

            {/* The muted "Next:" row from docs/Design.md 5.7, in the server's order. */}
            {eligible.length > 0 && (
              <div className="mt-4 border-t border-line-soft pt-3">
                <p className="text-eyebrow uppercase text-ink-muted">Next</p>
                <p className="mt-1.5 text-caption leading-relaxed text-ink-muted">
                  {eligible.slice(0, 5).map((e, i) => (
                    <span key={e.id}>
                      {i > 0 && ' · '}
                      <span className="font-semibold tabular-nums text-ink">{e.tokenLabel}</span>{' '}
                      {e.patientName}
                    </span>
                  ))}
                  {eligible.length > 5 && ` · +${eligible.length - 5} more`}
                </p>
              </div>
            )}
          </Card>

          <Pace eta={eta} />

          <Card title="Session controls">
            <div className="flex flex-col gap-3">
              {paused ? (
                <form action={resumeQueue}>
                  {sessionField}
                  <button type="submit" className={btn('quiet') + ' w-full'}>
                    <Icon name="play" className="h-4 w-4" />
                    Resume queue
                  </button>
                </form>
              ) : (
                <form action={pauseQueue} className="flex items-end gap-2">
                  {sessionField}
                  <div className="min-w-0 flex-1">
                    <label className={label + ' mb-1 block'} htmlFor="pause-reason">
                      Pause reason
                    </label>
                    <input
                      id="pause-reason"
                      name="reason"
                      placeholder="Optional"
                      className={input}
                    />
                  </div>
                  <button type="submit" className={btn('quiet')}>
                    Pause queue
                  </button>
                </form>
              )}

              <form action={setPresence} className="flex items-end gap-2">
                {sessionField}
                <div className="min-w-0 flex-1">
                  <label className={label + ' mb-1 block'} htmlFor="presence">
                    Doctor presence
                  </label>
                  <select
                    id="presence"
                    name="presence"
                    defaultValue={session.doctorPresence}
                    className={input}
                  >
                    <option value="NOT_PRESENT">Not present</option>
                    <option value="PRESENT">Present</option>
                    <option value="ON_BREAK">On break</option>
                    <option value="LEFT">Left for the day</option>
                  </select>
                </div>
                <button type="submit" className={btn('quiet')}>
                  Update
                </button>
              </form>

              <div className="border-t border-line-soft pt-3">
                <Disclosure summary="End this session" tone="danger">
                  <p className="text-caption text-ink-muted">
                    Everyone still outstanding is resolved: patients who were here but not seen are
                    rescheduled, patients who never arrived are marked no-show, and unpaid holds are
                    cancelled. This cannot be undone.
                  </p>
                  <form action={endSession} className="mt-3 flex items-end gap-2">
                    {sessionField}
                    <div className="min-w-0 flex-1">
                      <label className={label + ' mb-1 block'} htmlFor="end-reason">
                        Reason
                      </label>
                      <input
                        id="end-reason"
                        name="reason"
                        placeholder="Optional"
                        className={input}
                      />
                    </div>
                    <button type="submit" className={btn('danger')}>
                      End session
                    </button>
                  </form>
                </Disclosure>
              </div>
            </div>
          </Card>

          {/*
            P7-WEB-01. This replaces StaleDataNote, which existed to admit that the
            board did not update itself. It does now - and when the connection drops,
            this says so rather than going quiet, because a board that has silently
            stopped moving is the thing that gets a patient called twice.
          */}
          <Live sessionId={sessionId} />
        </div>

        {/* The rosters. Only this side scrolls. */}
        <div className="flex flex-col gap-4">
          <Roster
            title="Waiting here"
            icon="check-circle"
            entries={eligible}
            sessionId={sessionId}
            actions="eligible"
            empty={
              <EmptyState icon="user-plus" title="Nobody is checked in">
                Patients become callable once reception checks them in at the desk.
              </EmptyState>
            }
          />

          {skipped.length > 0 && (
            <Roster
              title="Passed over"
              icon="skip-forward"
              entries={skipped}
              sessionId={sessionId}
              actions="skipped"
            />
          )}

          <Roster
            title="Booked, not arrived"
            icon="home"
            entries={notArrived}
            sessionId={sessionId}
            actions="notArrived"
            empty={
              <EmptyState icon="check" title="Everyone who booked has arrived">
                Nothing to wait for on this list.
              </EmptyState>
            }
          />

          {holds.length > 0 && (
            <Roster
              title="Unpaid holds"
              icon="clock"
              description="Started a booking and have not paid. They are not in the queue and will lapse on their own."
              entries={holds}
              sessionId={sessionId}
              actions="none"
            />
          )}

          {finished.length > 0 && (
            <Roster
              title="Finished"
              icon="check"
              entries={finished}
              sessionId={sessionId}
              actions="none"
            />
          )}
        </div>
      </div>
    </>
  );
}

/** The patient in the room, or the one being waited on. The board's largest object. */
/**
 * Why the button above is dead, for the person looking at it.
 *
 * Not colour alone (docs/Design.md): an icon and a sentence. It names the remedy -
 * who CAN do it - because "you may not" with no next step just strands the desk.
 */
function ClinicalNote() {
  return (
    <p className="mt-2.5 flex items-start gap-1.5 text-caption text-muted">
      <Icon name="user" className="mt-0.5 h-3.5 w-3.5" />
      Consultations are recorded by the doctor. Ask them to sign in, or an admin.
    </p>
  );
}

function Patient({ entry }: { entry: QueueEntryView }) {
  return (
    <div className="flex items-center gap-3">
      <TokenChip size="lg">{entry.tokenLabel}</TokenChip>
      <div className="min-w-0">
        <p className="truncate text-h2 text-ink">{entry.patientName}</p>
        <div className="mt-1">
          <PriorityPill priority={entry.priority} />
        </div>
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  WALK_IN: 'Walk-in',
  ONLINE: 'App',
};

/**
 * One group of the roster.
 *
 * `actions` names which affordances this group gets. It is a display decision, not
 * an authorisation one - the server re-decides every command against the state
 * machine, and a stale board that offers the wrong button gets a clear rejection
 * rather than a wrong outcome.
 *
 * **Rows, not table cells.** The action column was the widest thing on the board and
 * held up to three stacked forms, so the table could not shrink below about 1200px
 * without scrolling sideways - on the tablet docs/Design.md 9 says reception uses.
 */
function Roster({
  title,
  icon,
  description,
  entries,
  sessionId,
  actions,
  empty,
}: {
  title: string;
  icon: 'check-circle' | 'skip-forward' | 'home' | 'clock' | 'check';
  description?: string;
  entries: QueueEntryView[];
  sessionId: string;
  actions: 'eligible' | 'skipped' | 'notArrived' | 'none';
  empty?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3">
        <h2 className="flex items-center gap-2 text-h3 text-ink">
          <Icon name={icon} className="h-4 w-4 text-ink-muted" />
          {title}
          <span className="rounded-full bg-sunken px-1.5 py-0.5 text-caption tabular-nums text-ink-muted">
            {entries.length}
          </span>
        </h2>
        {description !== undefined && (
          <p className="w-full text-caption text-ink-muted">{description}</p>
        )}
      </header>

      {entries.length === 0 ? (
        (empty ?? null)
      ) : (
        <ul className="divide-y divide-line-soft">
          {entries.map((entry) => (
            <li key={entry.id} className="px-4 py-3 transition-colors hover:bg-hover">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <TokenChip>{entry.tokenLabel}</TokenChip>
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                  {entry.patientName}
                </span>
                <PriorityPill priority={entry.priority} />
                <StatusPill status={entry.status} />
                {TYPE_LABEL[entry.type] !== undefined && (
                  <span className="text-caption text-ink-disabled">{TYPE_LABEL[entry.type]}</span>
                )}

                {actions === 'notArrived' && (
                  // Checks this one patient in on the spot. To scan a QR instead,
                  // that is the check-in desk - hence the different wording.
                  <form action={checkInEntry}>
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="tokenNumber" value={entry.tokenNumber} />
                    <button type="submit" className={btn('quiet', 'sm')}>
                      Check in
                    </button>
                  </form>
                )}

                {actions === 'skipped' && (
                  <>
                    <form action={requeuePatient}>
                      <input type="hidden" name="sessionId" value={sessionId} />
                      <input type="hidden" name="entryId" value={entry.id} />
                      <button type="submit" className={btn('quiet', 'sm')}>
                        Put back in queue
                      </button>
                    </form>
                    <form action={markNoShow}>
                      <input type="hidden" name="sessionId" value={sessionId} />
                      <input type="hidden" name="entryId" value={entry.id} />
                      <button type="submit" className={btn('danger', 'sm')}>
                        No-show
                      </button>
                    </form>
                  </>
                )}
              </div>

              {actions !== 'none' && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <PriorityForm entry={entry} sessionId={sessionId} />
                  <CancelForm entry={entry} sessionId={sessionId} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * P6-WEB-04 · audited escalation (docs/PRD.md 8.7).
 *
 * The reason is `required` on the form as well as on the DTO. That audit trail is
 * the only control against this feature being used to jump paying patients, so it
 * must not be something a hurried receptionist can skip and discover later.
 *
 * `<details>` rather than a modal: no client JavaScript, and the row stays readable
 * when it is closed.
 */
function PriorityForm({ entry, sessionId }: { entry: QueueEntryView; sessionId: string }) {
  return (
    <Disclosure summary="Priority">
      <form action={changePriority} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="entryId" value={entry.id} />
        <div className="w-36">
          <label className={label + ' mb-1 block'} htmlFor={`priority-${entry.id}`}>
            Priority
          </label>
          <select
            id={`priority-${entry.id}`}
            name="priority"
            defaultValue={entry.priority}
            className={input}
          >
            <option value="NORMAL">Normal</option>
            <option value="PRIORITY">Priority</option>
            <option value="EMERGENCY">Emergency</option>
          </select>
        </div>
        <div className="min-w-[16rem] flex-1">
          <label className={label + ' mb-1 block'} htmlFor={`priority-reason-${entry.id}`}>
            Reason
          </label>
          <input
            id={`priority-reason-${entry.id}`}
            name="reason"
            required
            minLength={3}
            placeholder="Required"
            className={input}
          />
        </div>
        <button type="submit" className={btn('quiet')}>
          Save
        </button>
      </form>
      <p className="mt-2 text-caption text-ink-muted">
        Recorded in the audit log with your name. Other patients are told only that the queue
        changed for a priority case.
      </p>
    </Disclosure>
  );
}

/**
 * P6-WEB-04 · reception withdraws a booking.
 *
 * The two causes are what decide the refund, so they are worded as the QUESTION the
 * receptionist is actually answering - "who decided this" - rather than as two
 * percentages, which would invite picking the number instead of the truth.
 */
function CancelForm({ entry, sessionId }: { entry: QueueEntryView; sessionId: string }) {
  return (
    <Disclosure summary="Cancel booking" tone="danger">
      <form action={cancelEntry} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="entryId" value={entry.id} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className={label + ' mb-1'}>Who decided this?</legend>
          <label className="flex items-center gap-2 text-body text-ink">
            <input
              type="radio"
              name="cause"
              value="PATIENT_REQUEST"
              defaultChecked
              className="accent-primary"
            />
            The patient asked to cancel
            <span className="text-caption text-ink-muted">(hospital refund policy applies)</span>
          </label>
          <label className="flex items-center gap-2 text-body text-ink">
            <input type="radio" name="cause" value="HOSPITAL" className="accent-primary" />
            The hospital cancelled
            <span className="text-caption text-ink-muted">(full refund)</span>
          </label>
        </fieldset>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <label className={label + ' mb-1 block'} htmlFor={`cancel-reason-${entry.id}`}>
              Reason
            </label>
            <input
              id={`cancel-reason-${entry.id}`}
              name="reason"
              required
              minLength={3}
              placeholder="Required"
              className={input}
            />
          </div>
          <button type="submit" className={btn('danger')}>
            Cancel booking
          </button>
        </div>
      </form>
    </Disclosure>
  );
}
