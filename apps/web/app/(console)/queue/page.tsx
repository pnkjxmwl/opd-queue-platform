import Link from 'next/link';
import type { Doctor, OPDSession, Paginated } from '@opd/contracts';
import { requireStaffHospital } from '../../../lib/tenant';
import { queueGet } from './_run';
import { Icon } from '../../../components/icon';
import {
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  btn,
  input,
  label,
} from '../../../components/ui';
import {
  SESSION_FINISHED,
  SessionStatusBadge,
  istDateLabel,
  istTime,
  istToday,
  rupees,
} from './ui';

/**
 * P6-WEB-01 (entry) · which session am I running?
 *
 * **A board of sessions, not a table of rows.** A session is a thing a person opens
 * and works inside for three hours; the five-column table it used to be gave a
 * doctor's name the same weight as a fee and buried "Open board" in a right-hand
 * cell. Each session is now one target the size of a card, with the doctor first,
 * the clock second and the state marked - the three things someone squints at when
 * they are deciding which one is theirs.
 *
 * The date defaults to today in IST, resolved on the server (`istToday`).
 */

const PATH = '/queue';

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const params = await searchParams;
  const hospital = await requireStaffHospital();
  const date = params.date ?? istToday();
  const today = istToday();

  const [page, doctors] = await Promise.all([
    queueGet<Paginated<OPDSession>>(`/hospitals/${hospital.id}/sessions?date=${date}&limit=100`),
    queueGet<Paginated<Doctor>>(`/hospitals/${hospital.id}/doctors?limit=100`),
  ]);

  const doctorName = new Map(doctors.items.map((d) => [d.id, d.name] as const));

  // A doctor sees the sessions they are actually providing - including any they are
  // covering for someone else, which is why this matches `currentProviderDoctorId`
  // and not `originalDoctorId` (docs/PRD.md 8.11, substitution).
  const sessions =
    hospital.role === 'DOCTOR' && hospital.doctorId !== null
      ? page.items.filter((s) => s.currentProviderDoctorId === hospital.doctorId)
      : page.items;

  const live = sessions.filter((s) => !SESSION_FINISHED.includes(s.status));
  const finished = sessions.filter((s) => SESSION_FINISHED.includes(s.status));

  return (
    <>
      <PageHeader
        eyebrow={hospital.name}
        title="Queue"
        description={
          <>
            {hospital.role === 'DOCTOR' ? 'Your sessions' : 'All sessions'} on{' '}
            <span className="font-medium text-ink">{istDateLabel(date)}</span>
            {date === today && ' — today'}
          </>
        }
        actions={
          /*
            A GET form, so the date is in the URL and the view is linkable and
            reloadable. `date` is the only field, and the button is beside it rather
            than under a "Filters" heading - one control does not need a toolbar.
          */
          <form className="flex items-end gap-2">
            <div>
              <label className={label + ' sr-only'} htmlFor="filter-date">
                Date
              </label>
              <input
                id="filter-date"
                name="date"
                type="date"
                defaultValue={date}
                className={input + ' w-[10.5rem]'}
              />
            </div>
            <button type="submit" className={btn('quiet')}>
              Show
            </button>
            {date !== today && (
              <Link href={PATH} className={btn('ghost')}>
                Today
              </Link>
            )}
          </form>
        }
      />

      {params.error !== undefined && (
        <div className="mb-5">
          <ErrorBanner message={params.error} />
        </div>
      )}

      {sessions.length === 0 ? (
        <Card>
          <EmptyState
            icon="calendar"
            title={
              hospital.role === 'DOCTOR'
                ? 'No session for you on this date'
                : 'No sessions on this date'
            }
            action={
              hospital.role === 'ADMIN' ? (
                <Link href="/config/sessions" className={btn('primary')}>
                  <Icon name="plus" className="h-4 w-4" />
                  Generate sessions
                </Link>
              ) : (
                <Link href={PATH} className={btn('quiet')}>
                  Back to today
                </Link>
              )
            }
          >
            {hospital.role === 'ADMIN'
              ? 'Sessions come from the weekly schedules under Configuration, or can be added one at a time.'
              : 'An administrator generates the day’s sessions from the schedules.'}
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <SessionGrid
            heading={live.length > 0 && finished.length > 0 ? 'Open' : undefined}
            sessions={live}
            doctorName={doctorName}
          />
          {finished.length > 0 && (
            <SessionGrid heading="Finished" sessions={finished} doctorName={doctorName} />
          )}
        </div>
      )}
    </>
  );
}

function SessionGrid({
  heading,
  sessions,
  doctorName,
}: {
  heading?: string;
  sessions: OPDSession[];
  doctorName: Map<string, string>;
}) {
  if (sessions.length === 0) return null;

  return (
    <section>
      {heading !== undefined && (
        <h2 className="mb-2.5 text-eyebrow uppercase text-ink-muted">
          {heading} · {sessions.length}
        </h2>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            doctor={doctorName.get(session.currentProviderDoctorId) ?? 'Unknown doctor'}
          />
        ))}
      </div>
    </section>
  );
}

function SessionCard({ session, doctor }: { session: OPDSession; doctor: string }) {
  const done = SESSION_FINISHED.includes(session.status);

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate text-h3 text-ink">{doctor}</h3>
        <SessionStatusBadge status={session.status} />
      </div>

      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-muted">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Window</dt>
          <Icon name="clock" className="h-3.5 w-3.5" />
          <dd className="tabular-nums">
            {istTime(session.scheduledStart)}–{istTime(session.scheduledEnd)}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Fee</dt>
          <dd className="tabular-nums">₹{rupees(session.feePaise)}</dd>
        </div>
        {session.pausedAt !== null && (
          <div className="flex items-center gap-1.5 font-medium text-warning">
            <dt className="sr-only">Queue</dt>
            <Icon name="pause" className="h-3.5 w-3.5" />
            <dd>Paused</dd>
          </div>
        )}
      </dl>
    </>
  );

  /*
    A finished session is deliberately inert rather than absent: staff hunt for one
    they remember running. Rendered as a `div`, not a dead link - a link that goes
    nowhere is worse than no link, because it is only discovered by pressing it.
  */
  if (done) {
    return (
      <div className="rounded-lg border border-line bg-surface/60 p-4 shadow-xs">
        {body}
        <p className="mt-3 text-caption text-ink-disabled">This session is closed.</p>
      </div>
    );
  }

  return (
    <Link
      href={`${PATH}/${session.id}`}
      className="group rounded-lg border border-line bg-surface p-4 shadow-xs transition-colors hover:border-line-strong hover:bg-hover"
    >
      {body}
      <span className="mt-3 inline-flex items-center gap-1 text-label font-semibold text-primary">
        Open board
        <Icon
          name="arrow-right"
          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
