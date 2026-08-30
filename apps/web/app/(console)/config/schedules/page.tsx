import type { Doctor, DoctorSchedule, Paginated } from '@opd/contracts';
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
import { createSchedule, deleteSchedule, updateSchedule } from './actions';

const PATH = '/config/schedules';
const LIMIT = 20;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const rupees = (paise: number) => (paise / 100).toFixed(2);

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
          <Empty>Add a doctor first — a schedule is a doctor&apos;s working block.</Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <ErrorBanner message={params.error} />

      <Card title="Add a working block">
        <form action={createSchedule} className="flex flex-wrap items-end gap-3">
          <div className="min-w-52">
            <label className={label} htmlFor="schedule-doctor">
              Doctor
            </label>
            <select id="schedule-doctor" name="doctorId" required className={input + ' mt-1'}>
              {doctors.items.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-44">
            <label className={label} htmlFor="schedule-recurrence">
              Repeats
            </label>
            <select id="schedule-recurrence" name="recurrence" className={input + ' mt-1'}>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  Every {day}
                </option>
              ))}
              <option value="date">One-off date →</option>
            </select>
          </div>

          <div className="w-44">
            <label className={label} htmlFor="schedule-date">
              One-off date
            </label>
            {/* Native date input rather than a picker dependency. */}
            <input id="schedule-date" name="date" type="date" className={input + ' mt-1'} />
          </div>

          <div className="w-32">
            <label className={label} htmlFor="schedule-start">
              Start
            </label>
            <input
              id="schedule-start"
              name="startTime"
              type="time"
              required
              defaultValue="10:00"
              className={input + ' mt-1 tabular-nums'}
            />
          </div>

          <div className="w-32">
            <label className={label} htmlFor="schedule-end">
              End
            </label>
            <input
              id="schedule-end"
              name="endTime"
              type="time"
              required
              defaultValue="13:00"
              className={input + ' mt-1 tabular-nums'}
            />
          </div>

          <div className="w-32">
            <label className={label} htmlFor="schedule-fee">
              Fee (₹)
            </label>
            <input
              id="schedule-fee"
              name="feeRupees"
              type="number"
              min={0}
              step="0.01"
              required
              defaultValue={500}
              className={input + ' mt-1 tabular-nums'}
            />
          </div>

          <button type="submit" className={button}>
            Add block
          </button>
        </form>
        <p className="mt-3 text-caption text-ink-muted">
          Times are Asia/Kolkata clock times. They become a dated session only when sessions are
          generated.
        </p>
      </Card>

      <Card title="Working blocks">
        {page.items.length === 0 ? (
          <Empty>No schedules yet.</Empty>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Doctor</th>
                <th className={th}>When</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((schedule) => (
                <tr key={schedule.id} className="border-b border-line last:border-0">
                  <td className={td}>{doctorName.get(schedule.doctorId) ?? 'Unknown doctor'}</td>
                  <td className={td}>
                    <form action={updateSchedule} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={schedule.id} />
                      <select
                        name="recurrence"
                        defaultValue={schedule.weekday === null ? 'date' : String(schedule.weekday)}
                        aria-label="Repeats"
                        className={input + ' w-40'}
                      >
                        {WEEKDAYS.map((day, index) => (
                          <option key={day} value={index}>
                            Every {day}
                          </option>
                        ))}
                        <option value="date">One-off date →</option>
                      </select>
                      <input
                        name="date"
                        type="date"
                        defaultValue={schedule.date ?? ''}
                        aria-label="One-off date"
                        className={input + ' w-40'}
                      />
                      <input
                        name="startTime"
                        type="time"
                        defaultValue={schedule.startTime}
                        required
                        aria-label="Start time"
                        className={input + ' w-28 tabular-nums'}
                      />
                      <input
                        name="endTime"
                        type="time"
                        defaultValue={schedule.endTime}
                        required
                        aria-label="End time"
                        className={input + ' w-28 tabular-nums'}
                      />
                      <input
                        name="feeRupees"
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={rupees(schedule.defaultFeePaise)}
                        required
                        aria-label="Fee in rupees"
                        className={input + ' w-28 tabular-nums'}
                      />
                      <button type="submit" className={buttonQuiet}>
                        Save
                      </button>
                    </form>
                  </td>
                  <td className={td + ' text-right'}>
                    <form action={deleteSchedule}>
                      <input type="hidden" name="id" value={schedule.id} />
                      <button type="submit" className={buttonDanger}>
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Pager
          path={PATH}
          total={page.total}
          limit={page.limit}
          offset={page.offset}
          filters={{ doctorId: params.doctorId }}
        />
      </Card>
    </>
  );
}
