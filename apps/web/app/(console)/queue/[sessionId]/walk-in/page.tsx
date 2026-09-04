import Link from 'next/link';
import type { Paginated, QueueEntryView } from '@opd/contracts';
import { requireStaffHospital } from '../../../../../lib/tenant';
import { queueGet } from '../../_run';
import { Icon } from '../../../../../components/icon';
import {
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  SuccessBanner,
  TokenChip,
  btn,
  input,
} from '../../../../../components/ui';
import { StatusPill } from '../../ui';
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
 *
 * The three fields sit on one row on a desktop and stack on a tablet, rather than
 * wrapping into the ragged two-and-a-half rows a flex-wrap produced at every width
 * between them.
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
      <header className="mb-4">
        <Link
          href={`/queue/${sessionId}`}
          className="mb-1.5 inline-flex items-center gap-1 text-caption text-ink-muted transition-colors hover:text-ink"
        >
          <Icon name="arrow-left" className="h-3 w-3" />
          Back to the board
        </Link>
        <h1 className="text-h1 text-ink">Walk-in</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-muted">
          Register somebody who has turned up without a booking. They join at the next token number
          and count as already here.
        </p>
      </header>

      {(query.error !== undefined || query.ok !== undefined) && (
        <div className="mb-4 flex max-w-3xl flex-col gap-2">
          <ErrorBanner message={query.error} />
          <SuccessBanner message={query.ok} />
        </div>
      )}

      <div className="grid max-w-5xl items-start gap-4 lg:grid-cols-2">
        <Card title="Register a patient at the desk">
          <form action={registerWalkIn} className="flex flex-col gap-3">
            <input type="hidden" name="sessionId" value={sessionId} />

            <Field id="walkin-name" label="Full name">
              <input
                id="walkin-name"
                name="name"
                required
                autoFocus
                maxLength={120}
                autoComplete="off"
                placeholder="Ramesh Kumar"
                className={input}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="walkin-dob" label="Date of birth" optional>
                <input id="walkin-dob" name="dob" type="date" className={input} />
              </Field>
              <Field id="walkin-gender" label="Gender" optional>
                <select id="walkin-gender" name="gender" defaultValue="" className={input}>
                  <option value="">Not stated</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>
            </div>

            <button type="submit" className={btn('primary') + ' mt-1 self-start'}>
              <Icon name="user-plus" className="h-4 w-4" />
              Add to queue
            </button>
          </form>

          <p className="mt-4 border-t border-line-soft pt-3 text-caption text-ink-muted">
            The token number is the server’s — a walk-in is never placed ahead of anyone by hand. If
            they genuinely need to be seen first, add them and then use Priority on the board, which
            asks for a reason and records it.
          </p>
        </Card>

        <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
          <header className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
            <h2 className="text-h3 text-ink">Walk-ins in this session</h2>
            <span className="rounded-full bg-sunken px-1.5 py-0.5 text-caption tabular-nums text-ink-muted">
              {walkIns.length}
            </span>
          </header>

          {walkIns.length === 0 ? (
            <EmptyState icon="user-plus" title="No walk-ins yet">
              Anyone registered at the desk appears here with the token they were given.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line-soft">
              {walkIns.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                >
                  <TokenChip>{entry.tokenLabel}</TokenChip>
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                    {entry.patientName}
                  </span>
                  <StatusPill status={entry.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
