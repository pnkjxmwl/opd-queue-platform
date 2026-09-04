import type { Department, Paginated } from '@opd/contracts';
import { apiGet } from '../../../../lib/api';
import { requireAdminHospital } from '../../../../lib/tenant';
import { Icon } from '../../../../components/icon';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Pager,
  TableCard,
  btn,
  input,
  table,
  td,
  th,
  tr,
} from '../../../../components/ui';
import { createDepartment, renameDepartment, setDepartmentActive } from './actions';

const PATH = '/config/departments';
const LIMIT = 20;

/**
 * Departments - the first thing a new hospital sets up, and therefore the first
 * screen anyone judges the console by.
 *
 * Every row is still an inline form: an admin renaming three departments should not
 * have to open three dialogs. What changed is that the row now reads as a row - the
 * name, then its state, then the one destructive control at the end - instead of a
 * text input, a pill and a button all competing at the same weight.
 */
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

      <Card
        title="Add a department"
        description="Every doctor belongs to one. Cardiology, Orthopaedics, General Medicine."
      >
        <form action={createDepartment} className="flex flex-wrap items-end gap-3">
          <Field id="new-department" label="Name" className="min-w-64 flex-1">
            <input
              id="new-department"
              name="name"
              required
              maxLength={120}
              placeholder="Cardiology"
              className={input}
            />
          </Field>
          <button type="submit" className={btn('primary')}>
            <Icon name="plus" className="h-4 w-4" />
            Add department
          </button>
        </form>
      </Card>

      <TableCard title="Departments" description={`${page.total} in ${hospital.name}`}>
        {page.items.length === 0 ? (
          <EmptyState icon="building" title="No departments yet">
            Add the first one above — nothing else in configuration can be set up until there is
            one.
          </EmptyState>
        ) : (
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Status</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((department) => (
                <tr key={department.id} className={tr}>
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
                      <button type="submit" className={btn('quiet', 'sm')}>
                        Save
                      </button>
                    </form>
                  </td>
                  <td className={td}>
                    {/* Never colour alone - the icon and the word carry the meaning. */}
                    {department.isActive ? (
                      <Badge tone="success" icon="check-circle">
                        Active
                      </Badge>
                    ) : (
                      <Badge icon="slash">Inactive</Badge>
                    )}
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
                        className={department.isActive ? btn('danger', 'sm') : btn('quiet', 'sm')}
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
      </TableCard>
    </>
  );
}
