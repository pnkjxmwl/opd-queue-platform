import type { Doctor, DoctorSchedule, Paginated } from '@opd/contracts';
import { apiGet } from '../../../../lib/api';
import { requireAdminHospital } from '../../../../lib/tenant';
import { Icon } from '../../../../components/icon';
import {
  Badge,
  Card,
  Disclosure,
  EmptyState,
  ErrorBanner,
  Field,
  Pager,
  btn,
  input,
} from '../../../../components/ui';
import { createSchedule, deleteSchedule, updateSchedule } from './actions';

const PATH = '/config/schedules';
const LIMIT = 20;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const rupees = (paise: number) => (paise / 100).toFixed(2);

/**
 * A schedule is a recurring working block - "Dr Sharma, every Tuesday, 10:00–13:00,
 * ₹500". It becomes a dated OPD session only when sessions are generated.
 *
 * Same shape as the doctors screen and for the same reason: the row STATES the
 * block in one line an admin can check against a rota, and the six inputs that used
 * to be the row open underneath it when something needs changing.
 */
export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; error?: string; doctorId?: string }>;
}) {
  const params = await searchParams;
  const offset = Number(params.offset ?? 0) || 0;
  const hospital = await requireAdminHospital();

  const [page, doctors] = await Promise.all([
    apiGet<Paginated<DoctorSchedule>>(
      `/hospitals/${hospital.id}/schedules?limit=${LIMIT}&offset=${offset}` +
        (params.doctorId ? `&doctorId=${params.doctorId}` : ''),
    ),
    apiGet<Paginated<Doctor>>(`/hospitals/${hospital.id}/doctors?limit=100`),
  ]);

  const doctorName = new Map(doctors.items.map((d) => [d.id, d.name] as const));

  if (doctors.items.length === 0) {
    return (
      <>
        <ErrorBanner message={params.error} />
        <Card title="Schedules">
          <EmptyState icon="users" title="Add a doctor first">
            A schedule is a doctor’s working block, so there has to be a doctor to give it to.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <ErrorBanner message={params.error} />

      <Card
        title="Add a working block"
        description="Times are Asia/Kolkata clock times. They become a dated session only when sessions are generated."
      >
        <form action={createSchedule} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Field id="schedule-doctor" label="Doctor" className="xl:col-span-2">
            <select id="schedule-doctor" name="doctorId" required className={input}>
              {doctors.items.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </Field>

          <Field id="schedule-recurrence" label="Repeats" className="xl:col-span-2">
            <select id="schedule-recurrence" name="recurrence" className={input}>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  Every {day}
                </option>
              ))}
              <option value="date">One-off date →</option>
            </select>
          </Field>

          <Field
            id="schedule-date"
            label="One-off date"
            className="xl:col-span-2"
            hint="Only used when Repeats is set to a one-off."
          >
            {/* Native date input rather than a picker dependency. */}
            <input id="schedule-date" name="date" type="date" className={input} />
          </Field>

          <Field id="schedule-start" label="Start">
            <input
              id="schedule-start"
              name="startTime"
              type="time"
              required
              defaultValue="10:00"
              className={input + ' tabular-nums'}
            />
          </Field>

          <Field id="schedule-end" label="End">
            <input
              id="schedule-end"
              name="endTime"
              type="time"
              required
              defaultValue="13:00"
              className={input + ' tabular-nums'}
            />
          </Field>

          <Field id="schedule-fee" label="Fee (₹)">
            <input
              id="schedule-fee"
              name="feeRupees"
              type="number"
              min={0}
              step="0.01"
              required
              defaultValue={500}
              className={input + ' tabular-nums'}
            />
          </Field>

          <div className="flex items-end sm:col-span-2 xl:col-span-3">
            <button type="submit" className={btn('primary')}>
              <Icon name="plus" className="h-4 w-4" />
              Add block
            </button>
          </div>
        </form>
      </Card>

      <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3">
          <h2 className="text-h3 text-ink">Working blocks</h2>
          <p className="text-caption tabular-nums text-ink-muted">{page.total} defined</p>
        </header>

        {page.items.length === 0 ? (
          <EmptyState icon="calendar" title="No working blocks yet">
            Add one above. Sessions for a day are generated from these.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line-soft">
            {page.items.map((schedule) => (
              <li key={schedule.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-ink">
                      {doctorName.get(schedule.doctorId) ?? 'Unknown doctor'}
                    </p>
                    <p className="text-caption tabular-nums text-ink-muted">
                      {schedule.startTime}–{schedule.endTime} · ₹{rupees(schedule.defaultFeePaise)}
                    </p>
                  </div>

                  <Badge tone={schedule.weekday === null ? 'info' : 'teal'} icon="calendar">
                    {schedule.weekday === null
                      ? (schedule.date ?? 'One-off')
                      : `Every ${WEEKDAYS[schedule.weekday]}`}
                  </Badge>

                  <form action={deleteSchedule}>
                    <input type="hidden" name="id" value={schedule.id} />
                    <button type="submit" className={btn('danger', 'sm')}>
                      Delete
                    </button>
                  </form>
                </div>

                <div className="mt-2">
                  <Disclosure summary="Edit this block">
                    <form
                      action={updateSchedule}
                      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
                    >
                      <input type="hidden" name="id" value={schedule.id} />
                      <Field id={`rec-${schedule.id}`} label="Repeats">
                        <select
                          id={`rec-${schedule.id}`}
                          name="recurrence"
                          defaultValue={
                            schedule.weekday === null ? 'date' : String(schedule.weekday)
                          }
                          className={input}
                        >
                          {WEEKDAYS.map((day, index) => (
                            <option key={day} value={index}>
                              Every {day}
                            </option>
                          ))}
                          <option value="date">One-off date →</option>
                        </select>
                      </Field>
                      <Field id={`date-${schedule.id}`} label="One-off date" optional>
                        <input
                          id={`date-${schedule.id}`}
                          name="date"
                          type="date"
                          defaultValue={schedule.date ?? ''}
                          className={input}
                        />
                      </Field>
                      <Field id={`start-${schedule.id}`} label="Start">
                        <input
                          id={`start-${schedule.id}`}
                          name="startTime"
                          type="time"
                          defaultValue={schedule.startTime}
                          required
                          className={input + ' tabular-nums'}
                        />
                      </Field>
                      <Field id={`end-${schedule.id}`} label="End">
                        <input
                          id={`end-${schedule.id}`}
                          name="endTime"
                          type="time"
                          defaultValue={schedule.endTime}
                          required
                          className={input + ' tabular-nums'}
                        />
                      </Field>
                      <Field id={`fee-${schedule.id}`} label="Fee (₹)">
                        <input
                          id={`fee-${schedule.id}`}
                          name="feeRupees"
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue={rupees(schedule.defaultFeePaise)}
                          required
                          className={input + ' tabular-nums'}
                        />
                      </Field>
                      <div className="sm:col-span-2 xl:col-span-5">
                        <button type="submit" className={btn('quiet')}>
                          Save
                        </button>
                      </div>
                    </form>
                  </Disclosure>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Pager
          path={PATH}
          total={page.total}
          limit={page.limit}
          offset={page.offset}
          filters={{ doctorId: params.doctorId }}
        />
      </section>
    </>
  );
}
