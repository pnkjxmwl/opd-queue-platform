import { cookies } from 'next/headers';
import type { Department, Doctor, Paginated } from '@opd/contracts';
import { apiGet } from '../../../../lib/api';
import { requireAdminHospital } from '../../../../lib/tenant';
import { Icon } from '../../../../components/icon';
import {
  Badge,
  Banner,
  Card,
  Disclosure,
  EmptyState,
  ErrorBanner,
  Field,
  Pager,
  btn,
  input,
} from '../../../../components/ui';
import { INVITE_COOKIE } from '../_run';
import { createDoctor, inviteDoctorLogin, setDoctorActive, updateDoctor } from './actions';

const PATH = '/config/doctors';
const LIMIT = 20;

/**
 * Doctors.
 *
 * **Reading is the common case; editing is not.** Every row used to be six live
 * controls - name, department, specialization, consult minutes, an invite field and
 * a deactivate button - so a list of eight doctors was forty-eight inputs, and there
 * was no way to simply LOOK at who worked here. The row now states the doctor, and
 * the same inline form opens underneath it on demand. Nothing was moved into a
 * dialog: an admin correcting three names still does it without leaving the page.
 */
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
          <EmptyState icon="building" title="Add a department first">
            Every doctor belongs to one, so departments come before doctors.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <ErrorBanner message={params.error} />

      {invite && (
        <Banner tone="success" title={`Invitation created for ${invite.email}.`}>
          Send them this link. It works once, and expires{' '}
          {new Date(invite.expiresAt).toLocaleDateString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
          })}
          . It is shown here only now — it cannot be retrieved again, only reissued.
          <code className="mt-2 block overflow-x-auto rounded-md border border-success-line bg-surface px-3 py-2 font-mono text-caption text-ink">
            /accept-invite?token={invite.token}
          </code>
        </Banner>
      )}

      <Card
        title="Add a doctor"
        description="Consult minutes seeds the ETA engine before this doctor has any history."
      >
        <form action={createDoctor} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field id="doctor-name" label="Name">
            <input
              id="doctor-name"
              name="name"
              required
              maxLength={120}
              placeholder="Dr. Anita Sharma"
              className={input}
            />
          </Field>
          <Field id="doctor-department" label="Department">
            <select id="doctor-department" name="departmentId" required className={input}>
              {departments.items.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="doctor-specialization" label="Specialization" optional>
            <input
              id="doctor-specialization"
              name="specialization"
              maxLength={120}
              placeholder="Interventional cardiology"
              className={input}
            />
          </Field>
          <Field id="doctor-mins" label="Consult minutes">
            <input
              id="doctor-mins"
              name="defaultConsultMins"
              type="number"
              min={1}
              max={240}
              defaultValue={10}
              className={input + ' tabular-nums'}
            />
          </Field>
          <div className="sm:col-span-2 xl:col-span-4">
            <button type="submit" className={btn('primary')}>
              <Icon name="plus" className="h-4 w-4" />
              Add doctor
            </button>
          </div>
        </form>
      </Card>

      <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3">
          <h2 className="text-h3 text-ink">Doctors</h2>
          <p className="text-caption tabular-nums text-ink-muted">{page.total} listed</p>
        </header>

        {page.items.length === 0 ? (
          <EmptyState icon="users" title="No doctors yet">
            Add the first one above. Schedules and sessions are built on doctors.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line-soft">
            {page.items.map((doctor) => (
              <li key={doctor.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal-50 text-caption font-semibold text-teal-800">
                    {initials(doctor.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-ink">{doctor.name}</p>
                    <p className="truncate text-caption text-ink-muted">
                      {departmentName.get(doctor.departmentId) ?? 'Inactive department'}
                      {doctor.specialization !== null && ` · ${doctor.specialization}`}
                      {' · '}
                      <span className="tabular-nums">{doctor.defaultConsultMins} min</span> per
                      patient
                    </p>
                  </div>

                  {doctor.hasLogin ? (
                    <Badge tone="teal" icon="check-circle">
                      Has a login
                    </Badge>
                  ) : (
                    <Badge icon="user">No login</Badge>
                  )}
                  {doctor.isActive ? (
                    <Badge tone="success" icon="check-circle">
                      Active
                    </Badge>
                  ) : (
                    <Badge icon="slash">Inactive</Badge>
                  )}

                  <form action={setDoctorActive}>
                    <input type="hidden" name="id" value={doctor.id} />
                    <input
                      type="hidden"
                      name="activate"
                      value={doctor.isActive ? 'false' : 'true'}
                    />
                    <button
                      type="submit"
                      className={doctor.isActive ? btn('danger', 'sm') : btn('quiet', 'sm')}
                    >
                      {doctor.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </form>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <Disclosure summary="Edit details">
                    <form action={updateDoctor} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <input type="hidden" name="id" value={doctor.id} />
                      <Field id={`name-${doctor.id}`} label="Name">
                        <input
                          id={`name-${doctor.id}`}
                          name="name"
                          defaultValue={doctor.name}
                          required
                          className={input}
                        />
                      </Field>
                      <Field id={`dept-${doctor.id}`} label="Department">
                        <select
                          id={`dept-${doctor.id}`}
                          name="departmentId"
                          defaultValue={doctor.departmentId}
                          className={input}
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
                      </Field>
                      <Field id={`spec-${doctor.id}`} label="Specialization" optional>
                        <input
                          id={`spec-${doctor.id}`}
                          name="specialization"
                          defaultValue={doctor.specialization ?? ''}
                          className={input}
                        />
                      </Field>
                      <Field id={`mins-${doctor.id}`} label="Consult minutes">
                        <input
                          id={`mins-${doctor.id}`}
                          name="defaultConsultMins"
                          type="number"
                          min={1}
                          max={240}
                          defaultValue={doctor.defaultConsultMins}
                          className={input + ' tabular-nums'}
                        />
                      </Field>
                      <div className="sm:col-span-2 xl:col-span-4">
                        <button type="submit" className={btn('quiet')}>
                          Save
                        </button>
                      </div>
                    </form>
                  </Disclosure>

                  {!doctor.hasLogin && (
                    <Disclosure summary="Invite a login">
                      <form action={inviteDoctorLogin} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="doctorId" value={doctor.id} />
                        <Field
                          id={`invite-${doctor.id}`}
                          label="Email"
                          className="min-w-[16rem] flex-1"
                          hint="They set their own password from a single-use link."
                        >
                          <input
                            id={`invite-${doctor.id}`}
                            name="email"
                            type="email"
                            required
                            placeholder="doctor@hospital.in"
                            className={input}
                          />
                        </Field>
                        <button type="submit" className={btn('quiet')}>
                          Invite
                        </button>
                      </form>
                    </Disclosure>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <Pager path={PATH} total={page.total} limit={page.limit} offset={page.offset} />
      </section>
    </>
  );
}

/** docs/Design.md 10: initials on teal, the stand-in for a photo the console has not got. */
function initials(name: string): string {
  return (
    name
      .replace(/^Dr\.?\s+/i, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}
