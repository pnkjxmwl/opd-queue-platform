import type { MeResponse } from '@opd/contracts';
import { apiGet } from '../../lib/api';

export default async function Overview() {
  const me = await apiGet<MeResponse>('/me');
  const active = me.memberships.find((m) => m.status === 'ACTIVE');

  // What this account can actually do TODAY. A doctor or receptionist landing here
  // should be told the queue console does not exist yet, not left hunting for it.
  const nextStep =
    active?.role === 'ADMIN'
      ? 'Run today’s sessions under Queue, or set up departments, doctors, schedules and queue rules under Configuration.'
      : active?.role === 'DOCTOR'
        ? 'Open Queue to run your session: call the next patient, start and complete consultations.'
        : 'Open Queue to check patients in, register walk-ins and manage today’s sessions.';

  return (
    <>
      <h1 className="text-h1">Overview</h1>
      <p className="mt-2 text-body-lg text-ink-muted">
        Signed in as {me.email}. {nextStep}
      </p>

      <section className="mt-6 rounded-lg border border-line bg-surface p-5 shadow-md">
        <h2 className="text-h3">Your hospitals</h2>
        {me.memberships.length === 0 ? (
          <p className="mt-2 text-body text-ink-muted">
            This account has no hospital membership yet. An admin must invite you.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {me.memberships.map((m) => (
              <li key={m.hospitalId} className="flex items-center justify-between text-body">
                <span>{m.hospitalName}</span>
                <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-caption text-teal-800">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
