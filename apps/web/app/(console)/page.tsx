import Link from 'next/link';
import type { Doctor, OPDSession, Paginated } from '@opd/contracts';
import { apiGet } from '../../lib/api';
import { getMe } from '../../lib/tenant';
import { Icon } from '../../components/icon';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  TableCard,
  btn,
  td,
  th,
  table,
  tr,
} from '../../components/ui';
import { SessionStatusBadge, SESSION_FINISHED, istDateLabel, istToday, istTime } from './queue/ui';

/**
 * The overview - **what is happening in this hospital right now**, rather than a
 * receipt for having signed in.
 *
 * It used to say who you were and what you could theoretically do next, in two
 * paragraphs, above a list of your memberships. That is a page you read once. The
 * console's landing screen is opened at the start of every shift by someone who
 * wants one thing: which clinics are running, and how do I get to the one I am
 * about to work on.
 *
 * **Everything here is already on endpoints the queue screens use.** No new API, no
 * new aggregate - today's sessions and the hospital's doctors, the same two requests
 * `/queue` makes, in the same round trip.
 */

const NEXT_STEP: Record<string, string> = {
  ADMIN: 'Run a session from the board, or set up departments, doctors, schedules and queue rules under Configuration.',
  DOCTOR: 'Open your session to call the next patient and run consultations.',
  RECEPTION: 'Open a session to check patients in and register walk-ins.',
};

export default async function Overview() {
  // Shares the layout's call, rather than repeating it. Still NOT
  // `requireStaffHospital()` - see the note below, that would loop.
  const me = await getMe();
  const active = me.memberships.find((m) => m.status === 'ACTIVE');

  /*
    An account with no active membership is a real state - an invitation accepted
    but not yet approved, or access revoked while the tab was open - and it is the
    only path through this page that must not fetch a hospital's sessions.

    Deliberately handled HERE rather than by `requireStaffHospital()`, which
    redirects to this very page: calling it from the overview is an infinite loop.
  */
  if (active === undefined) {
    return (
      <>
        <PageHeader title="Overview" description={`Signed in as ${me.email}.`} />
        <Card>
          <EmptyState icon="building" title="No hospital yet">
            This account is not an active member of any hospital. An administrator has to invite you
            before the queue and configuration appear.
          </EmptyState>
        </Card>
      </>
    );
  }

  const date = istToday();
  const [page, doctors] = await Promise.all([
    apiGet<Paginated<OPDSession>>(`/hospitals/${active.hospitalId}/sessions?date=${date}&limit=100`),
    apiGet<Paginated<Doctor>>(`/hospitals/${active.hospitalId}/doctors?limit=100`),
  ]);

  const doctorName = new Map(doctors.items.map((d) => [d.id, d.name] as const));

  // A doctor sees the sessions they are actually providing - including any they are
  // covering for someone else, which is why this matches `currentProviderDoctorId`
  // and not `originalDoctorId` (docs/PRD.md 8.11, substitution).
  const sessions =
    active.role === 'DOCTOR' && active.doctorId !== null
      ? page.items.filter((s) => s.currentProviderDoctorId === active.doctorId)
      : page.items;

  const running = sessions.filter((s) => s.status === 'ACTIVE');
  const upcoming = sessions.filter(
    (s) => s.status === 'SCHEDULED' || s.status === 'OPEN_FOR_REGISTRATION',
  );
  const done = sessions.filter((s) => SESSION_FINISHED.includes(s.status));

  return (
    <>
      <PageHeader
        eyebrow={active.hospitalName}
        title="Today"
        description={
          <>
            {istDateLabel(date)} · {NEXT_STEP[active.role]}
          </>
        }
        actions={
          <Link href="/queue" className={btn('quiet')}>
            <Icon name="queue" className="h-4 w-4" />
            All sessions
          </Link>
        }
      />

      {/*
        Three counts, not a chart. The question at 9am is "is anything running yet",
        and a number answers it in less time than a bar does.
      */}
      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Running now" value={running.length} icon="activity" tone="success" />
        <Tile label="Still to start" value={upcoming.length} icon="clock" />
        <Tile label="Finished" value={done.length} icon="check" />
        <Tile
          label={active.role === 'DOCTOR' ? 'Your sessions' : 'Doctors listed'}
          value={active.role === 'DOCTOR' ? sessions.length : doctors.total}
          icon="users"
        />
      </dl>

      {running.length > 0 && (
        <div className="mb-5">
          <h2 className="mb-2.5 text-eyebrow uppercase text-ink-muted">In progress</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {running.map((session) => (
              <Link
                key={session.id}
                href={`/queue/${session.id}`}
                className="group flex flex-col rounded-lg border border-teal-200 bg-surface p-4 shadow-xs ring-1 ring-teal-100 transition-colors hover:border-teal-300 hover:bg-teal-50/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate text-h3 text-ink">
                    {doctorName.get(session.currentProviderDoctorId) ?? 'Unknown doctor'}
                  </span>
                  <SessionStatusBadge status={session.status} />
                </div>
                <span className="mt-1 text-caption tabular-nums text-ink-muted">
                  {istTime(session.scheduledStart)}–{istTime(session.scheduledEnd)}
                  {session.pausedAt !== null && ' · paused'}
                </span>
                <span className="mt-3 inline-flex items-center gap-1 text-label font-semibold text-primary">
                  Open board
                  <Icon
                    name="arrow-right"
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <TableCard
          title={active.role === 'DOCTOR' ? 'Your sessions today' : "Today's sessions"}
          description={`${sessions.length} on ${istDateLabel(date)}`}
        >
          {sessions.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="Nothing scheduled today"
              action={
                active.role === 'ADMIN' ? (
                  <Link href="/config/sessions" className={btn('primary')}>
                    <Icon name="plus" className="h-4 w-4" />
                    Generate sessions
                  </Link>
                ) : undefined
              }
            >
              {active.role === 'ADMIN'
                ? 'Sessions are generated from the weekly schedules, or added one at a time.'
                : 'An administrator generates the day’s sessions from the schedules.'}
            </EmptyState>
          ) : (
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Doctor</th>
                  <th className={th}>Window</th>
                  <th className={th}>Status</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className={tr}>
                    <td className={td + ' font-medium'}>
                      {doctorName.get(session.currentProviderDoctorId) ?? 'Unknown doctor'}
                    </td>
                    <td className={td + ' whitespace-nowrap tabular-nums text-ink-muted'}>
                      {istTime(session.scheduledStart)}–{istTime(session.scheduledEnd)}
                    </td>
                    <td className={td}>
                      <SessionStatusBadge status={session.status} />
                    </td>
                    <td className={td + ' text-right'}>
                      {SESSION_FINISHED.includes(session.status) ? (
                        <span className="text-caption text-ink-disabled">Finished</span>
                      ) : (
                        <Link className={btn('quiet', 'sm')} href={`/queue/${session.id}`}>
                          Open board
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>

        <Card title="Your access" description="Where this account can act">
          <ul className="flex flex-col divide-y divide-line-soft">
            {me.memberships.map((m) => (
              <li key={m.hospitalId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0 truncate text-body font-medium text-ink">
                  {m.hospitalName}
                </span>
                <Badge tone={m.hospitalId === active.hospitalId ? 'teal' : 'neutral'}>
                  {m.role}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-line-soft pt-3 text-caption text-ink-muted">
            Signed in as {me.email}.
          </p>
        </Card>
      </div>
    </>
  );
}

/**
 * One count. Tabular, so a row of them stays aligned as the numbers change under a
 * `router.refresh()` rather than shuffling sideways.
 */
function Tile({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: 'activity' | 'clock' | 'check' | 'users';
  tone?: 'neutral' | 'success';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3.5 shadow-xs">
      <dt className="flex items-center gap-1.5 text-eyebrow uppercase text-ink-muted">
        <Icon
          name={icon}
          className={'h-3.5 w-3.5 ' + (tone === 'success' && value > 0 ? 'text-success' : '')}
        />
        {label}
      </dt>
      <dd className="mt-1.5 text-display tabular-nums leading-none text-ink">{value}</dd>
    </div>
  );
}
