'use server';

import { apiSend } from '../../../../lib/api';
import { runAction, text } from '../_run';

const PATH = '/config/departments';

export async function createDepartment(form: FormData): Promise<void> {
  await runAction(PATH, (hospitalId) =>
    apiSend('POST', `/hospitals/${hospitalId}/departments`, { name: text(form, 'name') }),
  );
}

export async function renameDepartment(form: FormData): Promise<void> {
  const id = text(form, 'id');
  await runAction(PATH, (hospitalId) =>
    apiSend('PATCH', `/hospitals/${hospitalId}/departments/${id}`, { name: text(form, 'name') }),
  );
}

/** DELETE deactivates on the server; this toggles it back on. */
export async function setDepartmentActive(form: FormData): Promise<void> {
  const id = text(form, 'id');
  const activate = text(form, 'activate') === 'true';

  await runAction(PATH, (hospitalId) =>
    activate
      ? apiSend('PATCH', `/hospitals/${hospitalId}/departments/${id}`, { isActive: true })
      : apiSend('DELETE', `/hospitals/${hospitalId}/departments/${id}`),
  );
}
