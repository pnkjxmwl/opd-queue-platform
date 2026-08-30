import type { Doctor, OPDSession, Paginated } from '@opd/contracts';
import { apiGet } from '../../../../lib/api';
import { requireAdminHospital } from '../../../../lib/tenant';
import { Card, Empty, ErrorBanner, Pager, button, buttonQuiet, input, label, td, th } from '../ui';
import { createSession, generateSessions } from './actions';

const PATH = '/config/sessions';
const LIMIT = 20;

/**
 * Instants are stored UTC and rendered in Asia/Kolkata (docs/Rules.md 5). Intl does
 * this correctly with no timezone dependency.
 */
const IST_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const rupees = (paise: number) => (paise / 100).toFixed(2);

/** Status is never colour alone - each carries its own word. */
const STATUS_STYLE: Record<string, string> = {
  OPEN_FOR_REGISTRATION: 'bg-success-bg text-success',
  ACTIVE: 'bg-info-bg text-info',
  SCHEDULED: 'bg-canvas text-ink-muted',
  COMPLETED: 'bg-canvas text-ink-muted',
  CANCELLED: 'bg-danger-bg text-danger',
  ENDED_EARLY: 'bg-warning-bg text-warning',
};

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    offset?: string;
    error?: string;
    date?: string;
    created?: string;
    skipped?: string;
  }>;
}) {
  const params = await searchParams;
  const offset = Number(params.offset ?? 0) || 0;
  const hospital = await requireAdminHospital();

  const [page, doctors] = await Promise.all([
    apiGet<Paginated<OPDSession>>(
      `/hospitals/${hospital.id}/sessions?limit=${LIMIT}&offset=${offset}` +
        (params.date ? `&date=${params.date}` : ''),
    ),
    apiGet<Paginated<Doctor>>(`/hospitals/${hospital.id}/doctors?limit=100`),
  ]);

  const doctorName = new Map(doctors.items.map((d) => [d.id, d.name] as const));

  const generated = params.created !== undefined;

  return (
    <>
      <ErrorBanner message={params.error} />

      {generated && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md bg-success-bg px-3 py-2 text-body text-success"
        >
          <span aria-hidden="true">✓</span>
          <span className="tabular-nums">
            <strong className="font-semibold">{params.created}</strong> session
            {params.created === '1' ? '' : 's'} created,{' '}
            <strong className="font-semibold">{params.skipped}</strong> already existed
            {params.skipped !== '0' && ' — running this twice is safe'}.
          </span>
        </p>
      )}

      <Card title="Generate sessions from schedules">
        <form action={generateSessions} className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label className={label} htmlFor="generate-date">
              Date <span className="text-ink-disabled">(blank = today)</span>
            </label>
            <input id="generate-date" name="date" type="date" className={input + ' mt-1'} />
          </div>
          <button type="submit" className={button}>
            Generate
          </button>
        </form>
        <p className="mt-3 text-caption text-ink-muted">
          Safe to run twice — a session that already exists is skipped, not duplicated. Leave the
          date blank and the server uses today in Asia/Kolkata.
        </p>
      </Card>

      <Card title="Add a one-off session">
        {doctors.items.length === 0 ? (
          <Empty>Add a doctor first.</Empty>
        ) : (
          <form action={createSession} className="flex flex-wrap items-end gap-3">
            <div className="min-w-52">
              <label className={label} htmlFor="session-doctor">
                Doctor
              </label>
              <select id="session-doctor" name="doctorId" required className={input + ' mt-1'}>
                {doctors.items.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-44">
              <label className={label} htmlFor="session-date">
                Date
              </label>
              <input
                id="session-date"
                name="date"
                type="date"
                required
                className={input + ' mt-1'}
              />
            </div>
            <div className="w-32">
              <label className={label} htmlFor="session-start">
                Start
              </label>
              <input
                id="session-start"
                name="startTime"
                type="time"
                required
                defaultValue="10:00"
                className={input + ' mt-1 tabular-nums'}
              />
            </div>
            <div className="w-32">
              <label className={label} htmlFor="session-end">
                End
              </label>
              <input
                id="session-end"
                name="endTime"
                type="time"
                required
                defaultValue="13:00"
                className={input + ' mt-1 tabular-nums'}
              />
            </div>
            <div className="w-32">
              <label className={label} htmlFor="session-fee">
                Fee (₹)
              </label>
              <input
                id="session-fee"
                name="feeRupees"
                type="number"
                min={0}
                step="0.01"
                required
                defaultValue={500}
                className={input + ' mt-1 tabular-nums'}
              />
            </div>
            <div className="w-28">
              <label className={label} htmlFor="session-prefix">
                Token prefix
              </label>
              <input
                id="session-prefix"
                name="tokenPrefix"
                maxLength={4}
                defaultValue="A"
                className={input + ' mt-1'}
              />
            </div>
            <button type="submit" className={buttonQuiet}>
              Create session
            </button>
          </form>
        )}
      </Card>

      <Card title="Sessions">
        <form className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-48">
            <label className={label} htmlFor="filter-date">
              Filter by date
            </label>
            <input
              id="filter-date"
              name="date"
              type="date"
              defaultValue={params.date ?? ''}
              className={input + ' mt-1'}
            />
          </div>
          <button type="submit" className={buttonQuiet}>
            Apply
          </button>
        </form>

        {page.items.length === 0 ? (
          <Empty>
            No sessions{params.date ? ` on ${params.date}` : ''} yet. Generate them from the
            schedules above.
          </Empty>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Date</th>
                <th className={th}>Doctor</th>
                <th className={th}>Window (IST)</th>
                <th className={th}>Fee</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((session) => (
                <tr key={session.id} className="border-b border-line last:border-0">
                  <td className={td + ' tabular-nums'}>{session.date}</td>
                  <td className={td}>
                    {doctorName.get(session.originalDoctorId) ?? 'Unknown doctor'}
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
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Pager
          path={PATH}
          total={page.total}
          limit={page.limit}
          offset={page.offset}
          filters={{ date: params.date }}
        />
      </Card>
    </>
  );
}
