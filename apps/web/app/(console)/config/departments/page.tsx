import type { Department, Paginated } from '@opd/contracts';
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
import { createDepartment, renameDepartment, setDepartmentActive } from './actions';

const PATH = '/config/departments';
const LIMIT = 20;

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; error?: string }>;
}) {
  const params = await searchParams;
  const offset = Number(params.offset ?? 0) || 0;
  const hospital = await requireAdminHospital();

  // includeInactive: the admin has to be able to see and revive what they deactivated.
  const page = await apiGet<Paginated<Department>>(
    `/hospitals/${hospital.id}/departments?limit=${LIMIT}&offset=${offset}&includeInactive=true`,
  );

  return (
    <>
      <ErrorBanner message={params.error} />

      <Card title="Add a department">
        <form action={createDepartment} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className={label} htmlFor="new-department">
              Name
            </label>
            <input
              id="new-department"
              name="name"
              required
              maxLength={120}
              placeholder="Cardiology"
              className={input + ' mt-1'}
            />
          </div>
          <button type="submit" className={button}>
            Add department
          </button>
        </form>
      </Card>

      <Card title="Departments">
        {page.items.length === 0 ? (
          <Empty>No departments yet. Add the first one above.</Empty>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Name</th>
                <th className={th}>Status</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((department) => (
                <tr key={department.id} className="border-b border-line last:border-0">
                  <td className={td}>
                    <form action={renameDepartment} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={department.id} />
                      <input
                        name="name"
                        defaultValue={department.name}
                        required
                        maxLength={120}
                        aria-label={`Name of ${department.name}`}
                        className={input + ' max-w-80'}
                      />
                      <button type="submit" className={buttonQuiet}>
                        Save
                      </button>
                    </form>
                  </td>
                  <td className={td}>
                    {/* Never colour alone - the label carries the meaning. */}
                    <span
                      className={
                        department.isActive
                          ? 'rounded-full bg-success-bg px-2.5 py-0.5 text-caption text-success'
                          : 'rounded-full bg-canvas px-2.5 py-0.5 text-caption text-ink-muted'
                      }
                    >
                      {department.isActive ? '● Active' : '○ Inactive'}
                    </span>
                  </td>
                  <td className={td + ' text-right'}>
                    <form action={setDepartmentActive}>
                      <input type="hidden" name="id" value={department.id} />
                      <input
                        type="hidden"
                        name="activate"
                        value={department.isActive ? 'false' : 'true'}
                      />
                      <button
                        type="submit"
                        className={department.isActive ? buttonDanger : buttonQuiet}
                      >
                        {department.isActive ? 'Deactivate' : 'Reactivate'}
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
