import type { MeResponse } from '@opd/contracts';
import { apiGet } from '../../lib/api';

export default async function Overview() {
  const me = await apiGet<MeResponse>('/me');

  return (
    <>
      <h1 className="text-h1">Overview</h1>
      <p className="mt-2 text-body-lg text-ink-muted">
        Signed in as {me.email}. Departments, doctors and sessions arrive in Phase 2.
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
