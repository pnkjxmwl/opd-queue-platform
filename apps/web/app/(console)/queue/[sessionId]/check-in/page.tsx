import Link from 'next/link';
import type { Paginated, QueueEntryView } from '@opd/contracts';
import { requireStaffHospital } from '../../../../../lib/tenant';
import { queueGet } from '../../_run';
import { Card, ErrorBanner, button, buttonQuiet, input, label, td, th } from '../../../config/ui';
import { StatusPill, SuccessBanner, token } from '../../ui';
import { checkInByToken } from './actions';
import { Scanner } from './scanner';

/**
 * P6-WEB-02 · the check-in desk. docs/Design.md 5.8.
 *
 * **Three ways in, and only one of them needs a camera.** docs/PRD.md 6.3 asks for
 * QR-first with a manual fallback; the third - tapping the patient in the list - is
 * what actually saves the desk when a phone is flat, the app will not open, or the
 * booking is in a relative's name. All three end at the same idempotent command.
 *
 * The scanner is deliberately not the whole page. A desk with no camera, no HTTPS or
 * a declined permission still has a complete, working screen.
 */

const LIMIT = 200;

/** Who reception can still check in. Presentational grouping; the server decides. */
const AWAITING = ['CONFIRMED', 'VIRTUAL_WAITING'];

export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string; ok?: string; q?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  await requireStaffHospital();

  const queue = await queueGet<Paginated<QueueEntryView>>(
    `/sessions/${sessionId}/queue?limit=${LIMIT}`,
  );

  const search = (query.q ?? '').trim().toLowerCase();
  const awaiting = queue.items
    .filter((e) => AWAITING.includes(e.status))
    .filter(
      (e) =>
        search === '' ||
        e.patientName.toLowerCase().includes(search) ||
        e.tokenLabel.toLowerCase().includes(search),
    );
  const alreadyHere = queue.items.filter((e) => e.status === 'CHECKED_IN' || e.status === 'READY');

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-h1">Check in</h1>
        <Link className={buttonQuiet + ' inline-flex items-center'} href={`/queue/${sessionId}`}>
          Back to the board
        </Link>
      </div>

      <div className="mt-6 max-w-4xl">
        <ErrorBanner message={query.error} />
        <SuccessBanner message={query.ok} />

        <Card title="Scan the token QR">
          <p className="mb-3 text-body text-ink-muted">
            Your browser will ask for permission to use the camera the first time. If you decline it,
            or there is no camera, the two methods below still work.
          </p>
          <Scanner sessionId={sessionId} />
        </Card>

        <div className="mt-6">
          <Card title="Or type the token number">
            <form action={checkInByToken} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="sessionId" value={sessionId} />
              <div className="w-56">
                <label className={label} htmlFor="token-number">
                  Token
                </label>
                <input
                  id="token-number"
                  name="tokenNumber"
                  autoFocus
                  autoComplete="off"
                  placeholder="27 or A027"
                  className={input + ' mt-1 tabular-nums'}
                />
              </div>
              <button type="submit" className={button}>
                Check in
              </button>
            </form>
            <p className="mt-3 text-caption text-ink-muted">
              Works with a flat battery and with no camera. Scanning the same patient twice is safe —
              it says so again and changes nothing.
            </p>
          </Card>
        </div>

        <div className="mt-6">
          <Card title={`Or find them in the list (${awaiting.length} still to arrive)`}>
            <form className="mb-4 flex flex-wrap items-end gap-3">
              <div className="w-72">
                <label className={label} htmlFor="q">
                  Search by name or token
                </label>
                <input
                  id="q"
                  name="q"
                  defaultValue={query.q ?? ''}
                  placeholder="Anita, or A027"
                  className={input + ' mt-1'}
                />
              </div>
              <button type="submit" className={buttonQuiet}>
                Search
              </button>
              {search !== '' && (
                <Link
                  className={buttonQuiet + ' inline-flex items-center'}
                  href={`/queue/${sessionId}/check-in`}
                >
                  Clear
                </Link>
              )}
            </form>

            {awaiting.length === 0 ? (
              <p className="py-4 text-body text-ink-muted">
                {search === ''
                  ? 'Everyone who booked has arrived.'
                  : `Nobody matching “${query.q}” is still to arrive.`}
              </p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Token</th>
                    <th className={th}>Patient</th>
                    <th className={th}>Status</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {awaiting.map((entry) => (
                    <tr key={entry.id} className="border-b border-line last:border-0">
                      <td className={td}>
                        <span className={token}>{entry.tokenLabel}</span>
                      </td>
                      <td className={td}>{entry.patientName}</td>
                      <td className={td}>
                        <StatusPill status={entry.status} />
                      </td>
                      <td className={td + ' text-right'}>
                        {/* Same action as the manual field, so reception stays on
                            this page instead of being thrown back to the board. */}
                        <form action={checkInByToken}>
                          <input type="hidden" name="sessionId" value={sessionId} />
                          <input type="hidden" name="tokenNumber" value={entry.tokenNumber} />
                          <button type="submit" className={buttonQuiet}>
                            Check in
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {alreadyHere.length > 0 && (
          <div className="mt-6">
            <Card title={`Already checked in (${alreadyHere.length})`}>
              <p className="text-body text-ink-muted">
                {alreadyHere.map((e) => e.tokenLabel).join(' · ')}
              </p>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
