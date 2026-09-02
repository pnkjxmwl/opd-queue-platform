import Link from 'next/link';
import type {
  Doctor,
  OPDSession,
  Paginated,
  QueueEntryStatus,
  QueueEntryView,
} from '@opd/contracts';
import { requireStaffHospital } from '../../../../lib/tenant';
import { queueGet } from '../_run';
import { Card, ErrorBanner, button, buttonDanger, buttonQuiet, input, label, td, th } from '../../config/ui';
import { IST_TIME, PriorityPill, StatusPill, SuccessBanner, token } from '../ui';
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
 */

/** One page holds a whole OPD session; the endpoint caps at 200 either way. */
const LIMIT = 200;

/**
 * How a status is grouped on screen. Purely presentational - what is LEGAL is the
 * state machine's business, and the server rejects anything this offers wrongly.
 */
const ELIGIBLE: QueueEntryStatus[] = ['CHECKED_IN', 'READY'];
const NOT_ARRIVED: QueueEntryStatus[] = ['CONFIRMED', 'VIRTUAL_WAITING'];
const FINISHED: QueueEntryStatus[] = [
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
  'RESCHEDULED',
];

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

  const [session, queue, doctors] = await Promise.all([
    queueGet<OPDSession>(`/hospitals/${hospital.id}/sessions/${sessionId}`),
    queueGet<Paginated<QueueEntryView>>(`/sessions/${sessionId}/queue?limit=${LIMIT}`),
    queueGet<Paginated<Doctor>>(`/hospitals/${hospital.id}/doctors?limit=100`),
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
  const hidden = (name: string, value: string) => (
    <input type="hidden" name={name} value={value} />
  );
  const sessionField = hidden('sessionId', sessionId);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-h1">{doctorName}</h1>
          <p className="mt-1 text-body-lg text-ink-muted tabular-nums">
            {IST_TIME.format(new Date(session.scheduledStart))}–
            {IST_TIME.format(new Date(session.scheduledEnd))} ·{' '}
            <span className="text-ink">{session.status.replaceAll('_', ' ')}</span>
            {paused && <span className="text-warning"> · Paused</span>}
            {' · Doctor '}
            {session.doctorPresence.replaceAll('_', ' ').toLowerCase()}
          </p>
        </div>
        {/*
          These NAVIGATE; the per-row buttons below ACT. They used to read "Check in"
          and "Walk-in", which made the header link and the row button on a waiting
          patient identical in wording and completely different in effect - the first
          person to use this pressed the row button, checked a patient in instantly,
          and reasonably reported that the camera never opened. Label a link with
          where it goes, not with what happens when you eventually get there.
        */}
        <div className="flex gap-2">
          <Link
            className={button + ' inline-flex items-center'}
            href={`/queue/${sessionId}/check-in`}
          >
            Open check-in desk
          </Link>
          <Link
            className={buttonQuiet + ' inline-flex items-center'}
            href={`/queue/${sessionId}/walk-in`}
          >
            Add a walk-in
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <ErrorBanner message={query.error} />
        <SuccessBanner message={query.ok ?? (query.called ? `Called ${query.called}` : undefined)} />

        {/* ------------------------------------------------------------------
            The one dominant action (docs/Design.md 5.7). Exactly one of these
            three states is true, and each has a single obvious next step.
        ------------------------------------------------------------------- */}
        <Card title="Now with">
          {inConsultation !== null ? (
            <>
              <p className="text-h2">
                <span className={token}>{inConsultation.tokenLabel}</span> ·{' '}
                {inConsultation.patientName}
                <PriorityPill priority={inConsultation.priority} />
              </p>
              <form action={completeConsultation} className="mt-4">
                {sessionField}
                {hidden('entryId', inConsultation.id)}
                <button type="submit" className={button + ' w-full text-body-lg'}>
                  Complete consultation
                </button>
              </form>
            </>
          ) : called !== null ? (
            <>
              <p className="text-h2">
                <span className={token}>{called.tokenLabel}</span> · {called.patientName}
                <PriorityPill priority={called.priority} />
              </p>
              <p className="mt-1 text-body text-ink-muted">
                Called{called.recallCount > 0 && ` · not seen ${called.recallCount}×`}. Waiting for
                them to come in.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <form action={startConsultation}>
                  {sessionField}
                  {hidden('entryId', called.id)}
                  <button type="submit" className={button}>
                    Start consultation
                  </button>
                </form>
                <form action={skipPatient} className="flex gap-2">
                  {sessionField}
                  {hidden('entryId', called.id)}
                  <input
                    name="reason"
                    placeholder="Reason (optional)"
                    className={input + ' w-56'}
                  />
                  <button type="submit" className={buttonQuiet}>
                    Skip for now
                  </button>
                </form>
                <form action={markNoShow}>
                  {sessionField}
                  {hidden('entryId', called.id)}
                  <button type="submit" className={buttonDanger}>
                    No-show
                  </button>
                </form>
              </div>
            </>
          ) : (
            <>
              <p className="text-body-lg text-ink-muted">
                {eligible.length === 0
                  ? 'Nobody has checked in yet. Patients become callable once reception checks them in.'
                  : `${eligible.length} patient${eligible.length === 1 ? '' : 's'} waiting.`}
              </p>
              <form action={callNext} className="mt-4">
                {sessionField}
                <button
                  type="submit"
                  className={button + ' w-full text-body-lg'}
                  disabled={eligible.length === 0 || paused}
                >
                  Call next
                </button>
              </form>
              {paused && (
                <p className="mt-2 text-caption text-warning">
                  The queue is paused — resume it below before calling anyone.
                </p>
              )}
            </>
          )}

          {/* The muted "Next:" row from docs/Design.md 5.7, in the server's order. */}
          {eligible.length > 0 && (
            <p className="mt-4 border-t border-line pt-3 text-body text-ink-muted">
              <span className="text-caption uppercase tracking-wide">Next</span>{' '}
              {eligible.slice(0, 5).map((e, i) => (
                <span key={e.id}>
                  {i > 0 && ' · '}
                  <span className="tabular-nums">{e.tokenLabel}</span> {e.patientName}
                </span>
              ))}
              {eligible.length > 5 && ` · +${eligible.length - 5} more`}
            </p>
          )}
        </Card>

        {/* ---------------------------------------------------------------- */}
        <div className="mt-6">
          <Card title="Session controls">
            <div className="flex flex-wrap items-end gap-3">
              {paused ? (
                <form action={resumeQueue}>
                  {sessionField}
                  <button type="submit" className={buttonQuiet}>
                    Resume queue
                  </button>
                </form>
              ) : (
                <form action={pauseQueue} className="flex items-end gap-2">
                  {sessionField}
                  <div>
                    <label className={label} htmlFor="pause-reason">
                      Pause reason
                    </label>
                    <input
                      id="pause-reason"
                      name="reason"
                      placeholder="Optional"
                      className={input + ' mt-1 w-56'}
                    />
                  </div>
                  <button type="submit" className={buttonQuiet}>
                    Pause queue
                  </button>
                </form>
              )}

              <form action={setPresence} className="flex items-end gap-2">
                {sessionField}
                <div>
                  <label className={label} htmlFor="presence">
                    Doctor presence
                  </label>
                  <select
                    id="presence"
                    name="presence"
                    defaultValue={session.doctorPresence}
                    className={input + ' mt-1 w-44'}
                  >
                    <option value="NOT_PRESENT">Not present</option>
                    <option value="PRESENT">Present</option>
                    <option value="ON_BREAK">On break</option>
                    <option value="LEFT">Left for the day</option>
                  </select>
                </div>
                <button type="submit" className={buttonQuiet}>
                  Update
                </button>
              </form>
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-label text-danger">End this session</summary>
              <form action={endSession} className="mt-3 flex items-end gap-2">
                {sessionField}
                <div>
                  <label className={label} htmlFor="end-reason">
                    Reason
                  </label>
                  <input
                    id="end-reason"
                    name="reason"
                    placeholder="Optional"
                    className={input + ' mt-1 w-72'}
                  />
                </div>
                <button type="submit" className={buttonDanger}>
                  End session
                </button>
              </form>
              <p className="mt-2 text-caption text-ink-muted">
                Everyone still outstanding is resolved: patients who were here but not seen are
                rescheduled, patients who never arrived are marked no-show, and unpaid holds are
                cancelled. This cannot be undone.
              </p>
            </details>
          </Card>
        </div>

        {/* ---------------------------------------------------------------- */}
        <div className="mt-6">
          <Card title={`Waiting here (${eligible.length})`}>
            <Roster
              entries={eligible}
              sessionId={sessionId}
              empty="Nobody is checked in. Use Check in above once patients arrive."
              actions="eligible"
            />
          </Card>
        </div>

        {skipped.length > 0 && (
          <div className="mt-6">
            <Card title={`Passed over (${skipped.length})`}>
              <Roster
                entries={skipped}
                sessionId={sessionId}
                empty=""
                actions="skipped"
              />
            </Card>
          </div>
        )}

        <div className="mt-6">
          <Card title={`Booked, not arrived (${notArrived.length})`}>
            <Roster
              entries={notArrived}
              sessionId={sessionId}
              empty="Everyone who booked has arrived."
              actions="notArrived"
            />
          </Card>
        </div>

        {holds.length > 0 && (
          <div className="mt-6">
            <Card title={`Unpaid holds (${holds.length})`}>
              <p className="mb-3 text-body text-ink-muted">
                Started a booking and have not paid. They are not in the queue and will lapse on
                their own.
              </p>
              <Roster entries={holds} sessionId={sessionId} empty="" actions="none" />
            </Card>
          </div>
        )}

        {finished.length > 0 && (
          <div className="mt-6">
            <Card title={`Finished (${finished.length})`}>
              <Roster entries={finished} sessionId={sessionId} empty="" actions="none" />
            </Card>
          </div>
        )}

        {/*
          P7-WEB-01. This replaces StaleDataNote, which existed to admit that the
          board did not update itself. It does now - and when the connection drops,
          this says so rather than going quiet, because a board that has silently
          stopped moving is the thing that gets a patient called twice.
        */}
        <Live sessionId={sessionId} />
      </div>
    </>
  );
}

/**
 * One group of the roster.
 *
 * `actions` names which affordances this group gets. It is a display decision, not
 * an authorisation one - the server re-decides every command against the state
 * machine, and a stale board that offers the wrong button gets a clear rejection
 * rather than a wrong outcome.
 */
function Roster({
  entries,
  sessionId,
  empty,
  actions,
}: {
  entries: QueueEntryView[];
  sessionId: string;
  empty: string;
  actions: 'eligible' | 'skipped' | 'notArrived' | 'none';
}) {
  if (entries.length === 0) {
    return empty === '' ? null : <p className="py-4 text-body text-ink-muted">{empty}</p>;
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-line">
          <th className={th}>Token</th>
          <th className={th}>Patient</th>
          <th className={th}>Status</th>
          <th className={th}>Type</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id} className="border-b border-line align-top last:border-0">
            <td className={td}>
              <span className={token}>{entry.tokenLabel}</span>
            </td>
            <td className={td}>
              {entry.patientName}
              <PriorityPill priority={entry.priority} />
            </td>
            <td className={td}>
              <StatusPill status={entry.status} />
            </td>
            <td className={td + ' text-caption text-ink-muted'}>
              {entry.type === 'WALK_IN' ? 'Walk-in' : entry.type === 'ONLINE' ? 'App' : 'Follow-up'}
            </td>
            <td className={td}>
              <div className="flex flex-col items-end gap-2">
                {actions === 'notArrived' && (
                  // Checks this one patient in on the spot. To scan a QR instead,
                  // that is the check-in desk - hence the different wording.
                  <form action={checkInEntry}>
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="tokenNumber" value={entry.tokenNumber} />
                    <button type="submit" className={buttonQuiet}>
                      Check in
                    </button>
                  </form>
                )}

                {actions === 'skipped' && (
                  <div className="flex gap-2">
                    <form action={requeuePatient}>
                      <input type="hidden" name="sessionId" value={sessionId} />
                      <input type="hidden" name="entryId" value={entry.id} />
                      <button type="submit" className={buttonQuiet}>
                        Put back in queue
                      </button>
                    </form>
                    <form action={markNoShow}>
                      <input type="hidden" name="sessionId" value={sessionId} />
                      <input type="hidden" name="entryId" value={entry.id} />
                      <button type="submit" className={buttonDanger}>
                        No-show
                      </button>
                    </form>
                  </div>
                )}

                {actions !== 'none' && (
                  <>
                    <PriorityForm entry={entry} sessionId={sessionId} />
                    <CancelForm entry={entry} sessionId={sessionId} />
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <details>
      <summary className="cursor-pointer text-caption text-ink-muted">Priority</summary>
      <form action={changePriority} className="mt-2 flex items-end gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="entryId" value={entry.id} />
        <select
          name="priority"
          defaultValue={entry.priority}
          aria-label={`Priority for ${entry.tokenLabel}`}
          className={input + ' w-36'}
        >
          <option value="NORMAL">Normal</option>
          <option value="PRIORITY">Priority</option>
          <option value="EMERGENCY">Emergency</option>
        </select>
        <input
          name="reason"
          required
          minLength={3}
          placeholder="Reason (required)"
          aria-label={`Reason for changing priority of ${entry.tokenLabel}`}
          className={input + ' w-64'}
        />
        <button type="submit" className={buttonQuiet}>
          Save
        </button>
      </form>
      <p className="mt-1 text-caption text-ink-muted">
        Recorded in the audit log with your name. Other patients are told only that the queue changed
        for a priority case.
      </p>
    </details>
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
    <details>
      <summary className="cursor-pointer text-caption text-danger">Cancel booking</summary>
      <form action={cancelEntry} className="mt-2 flex flex-col items-end gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="entryId" value={entry.id} />
        <label className="flex items-center gap-2 text-body">
          <input type="radio" name="cause" value="PATIENT_REQUEST" defaultChecked />
          The patient asked to cancel
          <span className="text-caption text-ink-muted">(hospital refund policy applies)</span>
        </label>
        <label className="flex items-center gap-2 text-body">
          <input type="radio" name="cause" value="HOSPITAL" />
          The hospital cancelled
          <span className="text-caption text-ink-muted">(full refund)</span>
        </label>
        <div className="flex items-end gap-2">
          <input
            name="reason"
            required
            minLength={3}
            placeholder="Reason (required)"
            aria-label={`Reason for cancelling ${entry.tokenLabel}`}
            className={input + ' w-64'}
          />
          <button type="submit" className={buttonDanger}>
            Cancel booking
          </button>
        </div>
      </form>
    </details>
  );
}
