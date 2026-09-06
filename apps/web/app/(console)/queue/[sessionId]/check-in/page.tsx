import Link from 'next/link';
import type { Paginated, QueueEntryView } from '@opd/contracts';
import { requireStaffHospital } from '../../../../../lib/tenant';
import { queueGet } from '../../_run';
import { Icon } from '../../../../../components/icon';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  SuccessBanner,
  TokenChip,
  btn,
  input,
  label,
} from '../../../../../components/ui';
import { StatusPill } from '../../ui';
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
 *
 * **Laid out as a desk, not as a stack.** The three methods were four full-width
 * cards down a 1400px page, so the typed field - the one a receptionist falls back
 * to twenty times a day - sat below the fold under a camera they may not even have.
 * The camera and the two typed methods are now side by side, and the roster of who
 * is still to arrive is the tall column, because that is the list being worked
 * through.
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
  const outstanding = queue.items.filter((e) => AWAITING.includes(e.status)).length;
  const alreadyHere = queue.items.filter((e) => e.status === 'CHECKED_IN' || e.status === 'READY');

  return (
    <>
      <header className="mb-4">
        <Link
          href={`/queue/${sessionId}`}
          className="mb-1.5 inline-flex items-center gap-1 text-caption text-ink-muted transition-colors hover:text-ink"
        >
          <Icon name="arrow-left" className="h-3 w-3" />
          Back to the board
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <h1 className="text-h1 text-ink">Check in</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={outstanding > 0 ? 'info' : 'success'} icon={outstanding > 0 ? 'home' : 'check'}>
              {outstanding} still to arrive
            </Badge>
            <Badge tone="teal" icon="check-circle">
              {alreadyHere.length} here
            </Badge>
          </div>
        </div>
      </header>

      {/*
        A confirmation names the token AND the patient, so a mis-scan is visible
        before the wrong person is called in. Full width and above everything else,
        because a receptionist glances up from the patient in front of them.
      */}
      {(query.error !== undefined || query.ok !== undefined) && (
        <div className="mb-4 flex flex-col gap-2">
          <ErrorBanner message={query.error} />
          <SuccessBanner message={query.ok} />
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card title="Scan the token QR">
            <p className="mb-3 text-caption text-ink-muted">
              Your browser will ask for permission to use the camera the first time. If you decline
              it, or there is no camera, the two methods below still work.
            </p>
            <Scanner sessionId={sessionId} />
          </Card>

          <Card title="Or type the token number">
            <form action={checkInByToken} className="flex items-end gap-2">
              <input type="hidden" name="sessionId" value={sessionId} />
              <div className="min-w-0 flex-1">
                <label className={label + ' mb-1 block'} htmlFor="token-number">
                  Token
                </label>
                <input
                  id="token-number"
                  name="tokenNumber"
                  autoFocus
                  autoComplete="off"
                  placeholder="27 or A027"
                  className={input + ' tabular-nums'}
                />
              </div>
              <button type="submit" className={btn('primary')}>
                Check in
              </button>
            </form>
            <p className="mt-2.5 text-caption text-ink-muted">
              Works with a flat battery and with no camera. Scanning the same patient twice is safe
              — it says so again and changes nothing.
            </p>
          </Card>
        </div>

        <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line-soft px-4 py-3">
            <h2 className="text-h3 text-ink">Or find them in the list</h2>
            {/* A GET form: the search stays in the URL, so a desk can keep a
                filtered view open across a check-in without retyping it. */}
            <form className="flex items-end gap-2">
              <div className="w-full min-w-[12rem] sm:w-64">
                <label className={label + ' sr-only'} htmlFor="q">
                  Search by name or token
                </label>
                <input
                  id="q"
                  name="q"
                  defaultValue={query.q ?? ''}
                  placeholder="Anita, or A027"
                  className={input}
                />
              </div>
              <button type="submit" className={btn('quiet')}>
                <Icon name="search" className="h-4 w-4" />
                Search
              </button>
              {search !== '' && (
                <Link className={btn('ghost')} href={`/queue/${sessionId}/check-in`}>
                  Clear
                </Link>
              )}
            </form>
          </header>

          {awaiting.length === 0 ? (
            search === '' ? (
              <EmptyState icon="check" title="Everyone who booked has arrived">
                Nothing left to check in for this session.
              </EmptyState>
            ) : (
              <EmptyState
                icon="search"
                title={`Nobody matching “${query.q}” is still to arrive`}
                action={
                  <Link className={btn('quiet')} href={`/queue/${sessionId}/check-in`}>
                    Show everyone
                  </Link>
                }
              >
                They may already be checked in, or the booking may be under a relative’s name.
              </EmptyState>
            )
          ) : (
            <ul className="divide-y divide-line-soft">
              {awaiting.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-hover"
                >
                  <TokenChip>{entry.tokenLabel}</TokenChip>
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                    {entry.patientName}
                  </span>
                  <StatusPill status={entry.status} />
                  {/* Same action as the manual field, so reception stays on this
                      page instead of being thrown back to the board. */}
                  <form action={checkInByToken}>
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="tokenNumber" value={entry.tokenNumber} />
                    <button type="submit" className={btn('quiet', 'sm')}>
                      Check in
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {alreadyHere.length > 0 && (
            <div className="border-t border-line bg-canvas px-4 py-3">
              <p className="mb-2 text-eyebrow uppercase text-ink-muted">
                Already checked in · {alreadyHere.length}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {alreadyHere.map((e) => (
                  <TokenChip key={e.id} size="sm">
                    {e.tokenLabel}
                  </TokenChip>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
