import type { QueuePolicy } from '@opd/contracts';
import { apiGet } from '../../../../lib/api';
import { requireAdminHospital } from '../../../../lib/tenant';
import { Card, ErrorBanner, button, input, label } from '../ui';
import { savePolicy } from './actions';

/**
 * Mirrors the frozen QueuePolicy schema field for field - docs/Phases.md is explicit
 * that this screen must not drift from it, because the same shape is what the
 * Phase-4 engine reads on every decision.
 *
 * Each control says which PRD rule it governs. An admin changing "grace period"
 * should be able to see that they are changing no-show behaviour.
 */
export default async function PolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const hospital = await requireAdminHospital();
  const policy = await apiGet<QueuePolicy>(`/hospitals/${hospital.id}/queue-policy`);

  return (
    <>
      <ErrorBanner message={params.error} />

      <form action={savePolicy} className="flex flex-col gap-6">
        <Card title="Ordering and eligibility">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="orderingStrategy">
                Call order
              </label>
              <select
                id="orderingStrategy"
                name="orderingStrategy"
                defaultValue={policy.orderingStrategy}
                className={input + ' mt-1'}
              >
                <option value="TOKEN_ORDER">Token order (earliest booking first)</option>
              </select>
              <p className="mt-1 text-caption text-ink-muted">
                Token number is a booking label, never the call order itself.
              </p>
            </div>
          </div>

          <fieldset className="mt-5 flex flex-col gap-3">
            <legend className="sr-only">Queue behaviour</legend>
            <Toggle
              name="checkInRequired"
              checked={policy.checkInRequired}
              title="Only checked-in patients can be called"
              hint="The doctor never idles for someone still at home. Turning this off lets a booking alone be called."
            />
            <Toggle
              name="walkInEnabled"
              checked={policy.walkInEnabled}
              title="Allow walk-ins"
              hint="Registered at reception, auto-checked-in, appended in token order."
            />
            <Toggle
              name="priorityEnabled"
              checked={policy.priorityEnabled}
              title="Allow priority and emergency insertions"
              hint="Always audited, with a reason. Other patients see only that the queue changed."
            />
          </fieldset>
        </Card>

        <Card title="No-shows">
          <div className="grid gap-5 sm:grid-cols-3">
            <Number
              name="gracePeriodSec"
              value={policy.gracePeriodSec}
              min={0}
              max={3600}
              title="Grace period (seconds)"
              hint="How long a called patient has to appear."
            />
            <Number
              name="recallAttempts"
              value={policy.recallAttempts}
              min={0}
              max={5}
              title="Recall attempts"
              hint="Re-calls allowed before the entry is skipped."
            />
            <div>
              <label className={label} htmlFor="requeueBehavior">
                Then
              </label>
              <select
                id="requeueBehavior"
                name="requeueBehavior"
                defaultValue={policy.requeueBehavior}
                className={input + ' mt-1'}
              >
                <option value="END_OF_QUEUE">Move to the end of the queue</option>
                <option value="NO_REQUEUE">Mark as a no-show</option>
              </select>
              <p className="mt-1 text-caption text-ink-muted">
                A no-show is refunded by the no-show rule below.
              </p>
            </div>
          </div>
        </Card>

        <Card title="Registration cutoff">
          <p className="text-body text-ink-muted">
            These three limits apply together — registration stays open only while every enabled one
            still allows a join.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            <Toggle
              name="cutoffOnEtaOverrun"
              checked={policy.cutoffOnEtaOverrun}
              title="Close when a new joiner could not be seen before the session ends"
              hint="The main guard: it stops someone joining a queue they cannot physically reach the front of."
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Number
                name="cutoffMinsBeforeEnd"
                value={policy.cutoffMinsBeforeEnd}
                min={0}
                max={720}
                title="Also close this many minutes before the end"
                hint="Leave blank for no clock cutoff."
              />
              <Number
                name="maxOnlineTokens"
                value={policy.maxOnlineTokens}
                min={1}
                max={1000}
                title="Cap online bookings per session"
                hint="Leave blank for no cap."
              />
            </div>
            <p className="text-caption text-ink-muted">
              Staff can also close registration by hand on an individual session.
            </p>
          </div>
        </Card>

        <Card title="Arrival guidance">
          <div className="max-w-sm">
            <Number
              name="arriveBeforeMins"
              value={policy.arriveBeforeMins}
              min={0}
              max={180}
              title="Ask patients to arrive this many minutes before their window"
              hint="Used by the arrival nudge the patient app sends."
            />
          </div>
        </Card>

        <Card title="Cancellations and refunds">
          <div className="grid gap-5 sm:grid-cols-2">
            <Number
              name="freeCancellationMins"
              value={policy.cancellationRules.freeCancellationMins}
              min={0}
              max={10080}
              title="Free cancellation window (minutes before start)"
              hint="Cancel earlier than this and the refund is full."
            />
            <Number
              name="lateCancellationRefundPct"
              value={policy.cancellationRules.lateCancellationRefundPct}
              min={0}
              max={100}
              title="Late cancellation refund (%)"
              hint="Cancelled inside the window above."
            />
            <Number
              name="noShowRefundPct"
              value={policy.cancellationRules.noShowRefundPct}
              min={0}
              max={100}
              title="No-show refund (%)"
              hint="Booked, never arrived, session ended."
            />
            <Number
              name="sessionCancelledRefundPct"
              value={policy.cancellationRules.sessionCancelledRefundPct}
              min={0}
              max={100}
              title="Session cancelled refund (%)"
              hint="The hospital cancelled, or the doctor left early."
            />
          </div>
        </Card>

        <div className="flex items-center gap-4">
          <button type="submit" className={button}>
            Save policy
          </button>
          <span className="text-caption text-ink-muted tabular-nums">
            Last updated {new Date(policy.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}{' '}
            UTC
          </span>
        </div>
      </form>
    </>
  );
}

function Toggle({
  name,
  checked,
  title,
  hint,
}: {
  name: string;
  checked: boolean;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3" htmlFor={name}>
      <input
        id={name}
        name={name}
        type="checkbox"
        defaultChecked={checked}
        className="mt-1 h-5 w-5 rounded border-line text-primary focus:ring-2 focus:ring-teal-300"
      />
      <span>
        <span className="block text-label text-ink">{title}</span>
        <span className="block text-caption text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

function Number({
  name,
  value,
  min,
  max,
  title,
  hint,
}: {
  name: string;
  value: number | null;
  min: number;
  max: number;
  title: string;
  hint: string;
}) {
  return (
    <div>
      <label className={label} htmlFor={name}>
        {title}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        min={min}
        max={max}
        defaultValue={value ?? ''}
        className={input + ' mt-1 tabular-nums'}
      />
      <p className="mt-1 text-caption text-ink-muted">{hint}</p>
    </div>
  );
}
