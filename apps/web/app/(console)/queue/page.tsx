import Link from 'next/link';
import type { Doctor, OPDSession, Paginated } from '@opd/contracts';
import { requireStaffHospital } from '../../../lib/tenant';
import { queueGet } from './_run';
import { Card, Empty, ErrorBanner, buttonQuiet, input, label, td, th } from '../config/ui';
import { IST_TIME, rupees } from './ui';

/**
 * P6-WEB-01 (entry) · which session am I running?
 *
 * Defaults to today in **IST, resolved on the server**. The browser's idea of today
 * is the 00:30 bug this project already documented once on the session generator: a
 * receptionist opening the console just after midnight must see tonight's date, not
 * yesterday's, and a machine with a wrong timezone must not decide that.
 */

const PATH = '/queue';

/** `en-CA` formats as YYYY-MM-DD, which is exactly the CalendarDate the API wants. */
const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

const STATUS_STYLE: Record<string, string> = {
  OPEN_FOR_REGISTRATION: 'bg-success-bg text-success',
  ACTIVE: 'bg-info-bg text-info',
  SCHEDULED: 'bg-canvas text-ink-muted',
  COMPLETED: 'bg-canvas text-ink-muted',
  CANCELLED: 'bg-danger-bg text-danger',
  ENDED_EARLY: 'bg-warning-bg text-warning',
};

/** A session nobody can act on any more. Listed, but not a link to a board. */
const FINISHED = ['COMPLETED', 'CANCELLED', 'ENDED_EARLY'];

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const params = await searchParams;
  const hospital = await requireStaffHospital();
  const date = params.date ?? IST_DATE.format(new Date());

  const [page, doctors] = await Promise.all([
    queueGet<Paginated<OPDSession>>(
      `/hospitals/${hospital.id}/sessions?date=${date}&limit=100`,
    ),
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

  return (
    <>
      <h1 className="text-h1">Queue</h1>
      <p className="mt-2 text-body-lg text-ink-muted">
        {hospital.name} ·{' '}
        {hospital.role === 'DOCTOR' ? 'your sessions' : 'all sessions'} on{' '}
        <span className="tabular-nums">{date}</span>
      </p>

      <div className="mt-6">
        <ErrorBanner message={params.error} />

        <Card title="Sessions">
          <form className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-48">
              <label className={label} htmlFor="filter-date">
                Date
              </label>
              <input
                id="filter-date"
                name="date"
                type="date"
                defaultValue={date}
                className={input + ' mt-1'}
              />
            </div>
            <button type="submit" className={buttonQuiet}>
              Show
            </button>
          </form>

          {sessions.length === 0 ? (
            <Empty>
              {hospital.role === 'DOCTOR'
                ? 'You have no session on this date.'
                : 'No sessions on this date. An admin generates them from the schedules under Configuration.'}
            </Empty>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Doctor</th>
                  <th className={th}>Window (IST)</th>
                  <th className={th}>Fee</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-line last:border-0">
                    <td className={td}>
                      {doctorName.get(session.currentProviderDoctorId) ?? 'Unknown doctor'}
                    </td>
                    <td className={td + ' tabular-nums'}>
                      {IST_TIME.format(new Date(session.scheduledStart))}–
                      {IST_TIME.format(new Date(session.scheduledEnd))}
                    </td>
                    <td className={td + ' tabular-nums'}>₹{rupees(session.feePaise)}</td>
                    <td className={td}>
                      <span
                        className={
                          'rounded-full px-2.5 py-0.5 text-caption ' +
                          (STATUS_STYLE[session.status] ?? 'bg-canvas text-ink-muted')
                        }
                      >
                        {session.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className={td + ' text-right'}>
                      {FINISHED.includes(session.status) ? (
                        // Deliberately inert rather than absent: a finished session
                        // still has to be visibly THERE, or staff hunt for one they
                        // remember running.
                        <span className="text-caption text-ink-disabled">Finished</span>
                      ) : (
                        <Link
                          className={buttonQuiet + ' inline-flex items-center'}
                          href={`${PATH}/${session.id}`}
                        >
                          Open board
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
