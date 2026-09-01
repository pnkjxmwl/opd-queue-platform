import Link from 'next/link';
import type { Paginated, QueueEntryView } from '@opd/contracts';
import { requireStaffHospital } from '../../../../../lib/tenant';
import { queueGet } from '../../_run';
import { Card, ErrorBanner, button, buttonQuiet, input, label, td, th } from '../../../config/ui';
import { StatusPill, SuccessBanner, token } from '../../ui';
import { registerWalkIn } from './actions';

/**
 * P6-WEB-03 · walk-in registration. docs/PRD.md 6.3, 8.6.
 *
 * One form, and deliberately a small one. A walk-in is a person at a desk who wants
 * to be seen today, not a patient record to be curated - name is required, date of
 * birth and gender are offered because a clinic list with two Sharmas in it needs
 * them, and nothing else is asked for.
 *
 * **There is no "find an existing patient" search, and that is a known gap.** No
 * endpoint exists for staff to search patients across a hospital: `GET /patients` is
 * scoped to the caller's own account, by design. So every walk-in creates a new
 * patient record with no account behind it, which is exactly what
 * `Patient.accountId` was made nullable for. Recorded in docs/PROGRESS.md rather
 * than papered over with a search that would have to reach into another module's
 * table.
 */

const LIMIT = 200;

export default async function WalkInPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  await requireStaffHospital();

  const queue = await queueGet<Paginated<QueueEntryView>>(
    `/sessions/${sessionId}/queue?limit=${LIMIT}`,
  );
  const walkIns = queue.items.filter((e) => e.type === 'WALK_IN');

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-h1">Walk-in</h1>
        <Link className={buttonQuiet + ' inline-flex items-center'} href={`/queue/${sessionId}`}>
          Back to the board
        </Link>
      </div>

      <div className="mt-6 max-w-3xl">
        <ErrorBanner message={query.error} />
        <SuccessBanner message={query.ok} />

        <Card title="Register a patient at the desk">
          <form action={registerWalkIn} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="sessionId" value={sessionId} />
            <div className="min-w-64 flex-1">
              <label className={label} htmlFor="walkin-name">
                Full name
              </label>
              <input
                id="walkin-name"
                name="name"
                required
                autoFocus
                maxLength={120}
                autoComplete="off"
                placeholder="Ramesh Kumar"
                className={input + ' mt-1'}
              />
            </div>
            <div className="w-44">
              <label className={label} htmlFor="walkin-dob">
                Date of birth <span className="text-ink-disabled">(optional)</span>
              </label>
              <input id="walkin-dob" name="dob" type="date" className={input + ' mt-1'} />
            </div>
            <div className="w-40">
              <label className={label} htmlFor="walkin-gender">
                Gender <span className="text-ink-disabled">(optional)</span>
              </label>
              <select id="walkin-gender" name="gender" defaultValue="" className={input + ' mt-1'}>
                <option value="">Not stated</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <button type="submit" className={button}>
              Add to queue
            </button>
          </form>

          <p className="mt-3 text-caption text-ink-muted">
            They are added at the next token number and counted as already here, so the doctor can
            call them straight away. The token number is the server’s — a walk-in is never placed
            ahead of anyone by hand. If they genuinely need to be seen first, add them and then use
            Priority on the board, which asks for a reason and records it.
          </p>
        </Card>

        {walkIns.length > 0 && (
          <div className="mt-6">
            <Card title={`Walk-ins in this session (${walkIns.length})`}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Token</th>
                    <th className={th}>Patient</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {walkIns.map((entry) => (
                    <tr key={entry.id} className="border-b border-line last:border-0">
                      <td className={td}>
                        <span className={token}>{entry.tokenLabel}</span>
                      </td>
                      <td className={td}>{entry.patientName}</td>
                      <td className={td}>
                        <StatusPill status={entry.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
