import { cookies } from 'next/headers';
import type { Department, Doctor, Paginated } from '@opd/contracts';
import { apiGet } from '../../../../lib/api';
import { requireAdminHospital } from '../../../../lib/tenant';
import {
  Card,
  Empty,
  ErrorBanner,
  Pager,
  button,
  buttonDanger,
  buttonQuiet,
  input,
  label,
  td,
  th,
} from '../ui';
import { INVITE_COOKIE } from '../_run';
import { createDoctor, inviteDoctorLogin, setDoctorActive, updateDoctor } from './actions';

const PATH = '/config/doctors';
const LIMIT = 20;

export default async function DoctorsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; error?: string }>;
}) {
  const params = await searchParams;
  const offset = Number(params.offset ?? 0) || 0;
  const hospital = await requireAdminHospital();

  // Parked by inviteDoctorLogin. The token is returned by the API exactly once, so
  // this is the only chance to show it; the cookie expires on its own in 3 minutes.
  const parked = (await cookies()).get(INVITE_COOKIE)?.value;
  const invite = parked
    ? (JSON.parse(parked) as { email: string; token: string; expiresAt: string })
    : null;

  const [page, departments] = await Promise.all([
    apiGet<Paginated<Doctor>>(
      `/hospitals/${hospital.id}/doctors?limit=${LIMIT}&offset=${offset}&includeInactive=true`,
    ),
    // Only active departments can take a new doctor; the list is capped like any other.
    apiGet<Paginated<Department>>(`/hospitals/${hospital.id}/departments?limit=100`),
  ]);

  const departmentName = new Map(departments.items.map((d) => [d.id, d.name] as const));

  if (departments.items.length === 0) {
    return (
      <>
        <ErrorBanner message={params.error} />
        <Card title="Doctors">
          <Empty>Add a department first — every doctor belongs to one.</Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <ErrorBanner message={params.error} />

      {invite && (
        <section className="rounded-lg border border-success bg-success-bg p-5">
          <h2 className="text-h3 text-success">✓ Invitation created for {invite.email}</h2>
          <p className="mt-2 text-body text-ink">
            Send them this link. It works once, and expires{' '}
            {new Date(invite.expiresAt).toLocaleDateString('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: 'numeric',
              month: 'short',
            })}
            . It is shown here only now — it cannot be retrieved again, only reissued.
          </p>
          <code className="mt-3 block overflow-x-auto rounded-md bg-surface px-3 py-2 text-body text-ink">
            /accept-invite?token={invite.token}
          </code>
        </section>
      )}

      <Card title="Add a doctor">
        <form action={createDoctor} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className={label} htmlFor="doctor-name">
              Name
            </label>
            <input
              id="doctor-name"
              name="name"
              required
              maxLength={120}
              placeholder="Dr. Anita Sharma"
              className={input + ' mt-1'}
            />
          </div>
          <div className="min-w-48">
            <label className={label} htmlFor="doctor-department">
              Department
            </label>
            <select id="doctor-department" name="departmentId" required className={input + ' mt-1'}>
              {departments.items.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48">
            <label className={label} htmlFor="doctor-specialization">
              Specialization <span className="text-ink-disabled">(optional)</span>
            </label>
            <input
              id="doctor-specialization"
              name="specialization"
              maxLength={120}
              className={input + ' mt-1'}
            />
          </div>
          <div className="w-40">
            <label className={label} htmlFor="doctor-mins">
              Consult minutes
            </label>
            <input
              id="doctor-mins"
              name="defaultConsultMins"
              type="number"
              min={1}
              max={240}
              defaultValue={10}
              className={input + ' mt-1 tabular-nums'}
            />
          </div>
          <button type="submit" className={button}>
            Add doctor
          </button>
        </form>
        <p className="mt-3 text-caption text-ink-muted">
          Consult minutes seeds the ETA engine before this doctor has any history.
        </p>
      </Card>

      <Card title="Doctors">
        {page.items.length === 0 ? (
          <Empty>No doctors yet.</Empty>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Doctor</th>
                <th className={th}>Login</th>
                <th className={th}>Status</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((doctor) => (
                <tr key={doctor.id} className="border-b border-line last:border-0 align-top">
                  <td className={td}>
                    <form action={updateDoctor} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={doctor.id} />
                      <input
                        name="name"
                        defaultValue={doctor.name}
                        required
                        aria-label={`Name of ${doctor.name}`}
                        className={input + ' w-56'}
                      />
                      <select
                        name="departmentId"
                        defaultValue={doctor.departmentId}
                        aria-label={`Department of ${doctor.name}`}
                        className={input + ' w-44'}
                      >
                        {departments.items.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                          </option>
                        ))}
                        {!departmentName.has(doctor.departmentId) && (
                          <option value={doctor.departmentId}>(inactive department)</option>
                        )}
                      </select>
                      <input
                        name="specialization"
                        defaultValue={doctor.specialization ?? ''}
                        placeholder="Specialization"
                        aria-label={`Specialization of ${doctor.name}`}
                        className={input + ' w-44'}
                      />
                      <input
                        name="defaultConsultMins"
                        type="number"
                        min={1}
                        max={240}
                        defaultValue={doctor.defaultConsultMins}
                        aria-label={`Consult minutes for ${doctor.name}`}
                        className={input + ' w-24 tabular-nums'}
                      />
                      <button type="submit" className={buttonQuiet}>
                        Save
                      </button>
                    </form>
                  </td>

                  <td className={td}>
                    {doctor.hasLogin ? (
                      <span className="rounded-full bg-success-bg px-2.5 py-0.5 text-caption text-success">
                        ✓ Invited
                      </span>
                    ) : (
                      <form action={inviteDoctorLogin} className="flex items-center gap-2">
                        <input type="hidden" name="doctorId" value={doctor.id} />
                        <input
                          name="email"
                          type="email"
                          required
                          placeholder="doctor@hospital.in"
                          aria-label={`Invite email for ${doctor.name}`}
                          className={input + ' w-56'}
                        />
                        <button type="submit" className={buttonQuiet}>
                          Invite
                        </button>
                      </form>
                    )}
                  </td>

                  <td className={td}>
                    <span
                      className={
                        doctor.isActive
                          ? 'rounded-full bg-success-bg px-2.5 py-0.5 text-caption text-success'
                          : 'rounded-full bg-canvas px-2.5 py-0.5 text-caption text-ink-muted'
                      }
                    >
                      {doctor.isActive ? '● Active' : '○ Inactive'}
                    </span>
                  </td>

                  <td className={td + ' text-right'}>
                    <form action={setDoctorActive}>
                      <input type="hidden" name="id" value={doctor.id} />
                      <input
                        type="hidden"
                        name="activate"
                        value={doctor.isActive ? 'false' : 'true'}
                      />
                      <button type="submit" className={doctor.isActive ? buttonDanger : buttonQuiet}>
                        {doctor.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Pager path={PATH} total={page.total} limit={page.limit} offset={page.offset} />
      </Card>
    </>
  );
}
