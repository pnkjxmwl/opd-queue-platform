import Link from 'next/link';
import type { Doctor, OPDSession, Paginated } from '@opd/contracts';
import { apiGet } from '../../../../lib/api';
import { requireAdminHospital } from '../../../../lib/tenant';
import { Icon } from '../../../../components/icon';
import {
  Banner,
  Card,
  Disclosure,
  EmptyState,
  ErrorBanner,
  Field,
  Pager,
  TableCard,
  btn,
  input,
  table,
  td,
  th,
  tr,
} from '../../../../components/ui';
import { createSession, generateSessions } from './actions';
// One formatter for the whole console, so a session reads the same on every screen
// it appears on - and the same as it reads in the patient's app.
import { SessionStatusBadge, istDateLabel, istTime } from '../../queue/ui';

const PATH = '/config/sessions';
const LIMIT = 20;

const rupees = (paise: number) => (paise / 100).toFixed(2);

/**
 * Sessions - dated instances of the working blocks.
 *
 * **Generating is the everyday action; adding one by hand is the exception**, and
 * the page used to give them two identical cards stacked in the order they were
 * written. Generate is now the primary action with its own card; the one-off form
 * sits behind a disclosure under it, because an admin needs it perhaps once a month
 * and it is seven fields wide.
 */
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

  return (
    <>
      <ErrorBanner message={params.error} />

      {params.created !== undefined && (
        <Banner tone="success">
          <span className="tabular-nums">
            <strong className="font-semibold">{params.created}</strong> session
            {params.created === '1' ? '' : 's'} created,{' '}
            <strong className="font-semibold">{params.skipped}</strong> already existed
            {params.skipped !== '0' && ' — running this twice is safe'}.
          </span>
        </Banner>
      )}

      <Card
        title="Generate sessions from schedules"
        description="Safe to run twice — a session that already exists is skipped, not duplicated."
      >
        <form action={generateSessions} className="flex flex-wrap items-end gap-3">
          <Field
            id="generate-date"
            label="Date"
            optional
            className="w-48"
            hint="Blank uses today in Asia/Kolkata."
          >
            <input id="generate-date" name="date" type="date" className={input} />
          </Field>
          <button type="submit" className={btn('primary')}>
            <Icon name="refresh-cw" className="h-4 w-4" />
            Generate
          </button>
        </form>

        <div className="mt-4 border-t border-line-soft pt-3">
          <Disclosure summary="Or add a single session by hand">
            {doctors.items.length === 0 ? (
              <p className="text-body text-ink-muted">Add a doctor first.</p>
            ) : (
              <form action={createSession} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Field id="session-doctor" label="Doctor">
                  <select id="session-doctor" name="doctorId" required className={input}>
                    {doctors.items.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="session-date" label="Date">
                  <input id="session-date" name="date" type="date" required className={input} />
                </Field>
                <Field id="session-prefix" label="Token prefix">
                  <input
                    id="session-prefix"
                    name="tokenPrefix"
                    maxLength={4}
                    defaultValue="A"
                    className={input}
                  />
                </Field>
                <Field id="session-start" label="Start">
                  <input
                    id="session-start"
                    name="startTime"
                    type="time"
                    required
                    defaultValue="10:00"
                    className={input + ' tabular-nums'}
                  />
                </Field>
                <Field id="session-end" label="End">
                  <input
                    id="session-end"
                    name="endTime"
                    type="time"
                    required
                    defaultValue="13:00"
                    className={input + ' tabular-nums'}
                  />
                </Field>
                <Field id="session-fee" label="Fee (₹)">
                  <input
                    id="session-fee"
                    name="feeRupees"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    defaultValue={500}
                    className={input + ' tabular-nums'}
                  />
                </Field>
                <div className="sm:col-span-2 xl:col-span-3">
                  <button type="submit" className={btn('quiet')}>
                    Create session
                  </button>
                </div>
              </form>
            )}
          </Disclosure>
        </div>
      </Card>

      <TableCard
        title="Sessions"
        description={params.date ? `Filtered to ${istDateLabel(params.date)}` : 'All dates'}
        actions={
          <form className="flex items-end gap-2">
            <label className="sr-only" htmlFor="filter-date">
              Filter by date
            </label>
            <input
              id="filter-date"
              name="date"
              type="date"
              defaultValue={params.date ?? ''}
              className={input + ' w-[10.5rem]'}
            />
            <button type="submit" className={btn('quiet', 'sm')}>
              Apply
            </button>
            {params.date !== undefined && (
              <Link href={PATH} className={btn('ghost', 'sm')}>
                Clear
              </Link>
            )}
          </form>
        }
      >
        {page.items.length === 0 ? (
          <EmptyState icon="calendar" title="No sessions here yet">
            {params.date
              ? `Nothing scheduled on ${istDateLabel(params.date)}. Generate them from the schedules above.`
              : 'Generate them from the schedules above, or add a one-off.'}
          </EmptyState>
        ) : (
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Doctor</th>
                <th className={th}>Window (IST)</th>
                <th className={th}>Fee</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((session) => (
                <tr key={session.id} className={tr}>
                  <td className={td + ' whitespace-nowrap tabular-nums'}>{session.date}</td>
                  <td className={td + ' font-medium'}>
                    {doctorName.get(session.originalDoctorId) ?? 'Unknown doctor'}
                  </td>
                  <td className={td + ' whitespace-nowrap tabular-nums text-ink-muted'}>
                    {istTime(session.scheduledStart)}–{istTime(session.scheduledEnd)}
                  </td>
                  <td className={td + ' tabular-nums text-ink-muted'}>
                    ₹{rupees(session.feePaise)}
                  </td>
                  <td className={td}>
                    <SessionStatusBadge status={session.status} />
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
      </TableCard>
    </>
  );
}
