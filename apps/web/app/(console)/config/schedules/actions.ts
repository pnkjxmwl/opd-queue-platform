'use server';

import { apiSend } from '../../../../lib/api';
import { num, runAction, text } from '../_run';

const PATH = '/config/schedules';

/**
 * The form shows rupees because that is what a hospital admin thinks in; the
 * contract is paise (docs/Rules.md 5 - integers, never floats). Rounding happens
 * once, here, at the boundary.
 */
function feePaise(form: FormData): number {
  return Math.round((num(form, 'feeRupees') ?? 0) * 100);
}

/**
 * One `recurrence` control instead of two mutually exclusive fields, so the form
 * cannot express "both" or "neither" - the states the schema and a database CHECK
 * would reject anyway.
 */
function recurrence(form: FormData): { weekday: number | null; date: string | null } {
  const choice = text(form, 'recurrence');
  return choice === 'date'
    ? { weekday: null, date: text(form, 'date') || null }
    : { weekday: Number(choice), date: null };
}

export async function createSchedule(form: FormData): Promise<void> {
  await runAction(PATH, (hospitalId) =>
    apiSend('POST', `/hospitals/${hospitalId}/schedules`, {
      doctorId: text(form, 'doctorId'),
      ...recurrence(form),
      startTime: text(form, 'startTime'),
      endTime: text(form, 'endTime'),
      defaultFeePaise: feePaise(form),
    }),
  );
}

/** PATCH replaces every mutable field - the schedule schema is a full replace. */
export async function updateSchedule(form: FormData): Promise<void> {
  const id = text(form, 'id');
  await runAction(PATH, (hospitalId) =>
    apiSend('PATCH', `/hospitals/${hospitalId}/schedules/${id}`, {
      ...recurrence(form),
      startTime: text(form, 'startTime'),
      endTime: text(form, 'endTime'),
      defaultFeePaise: feePaise(form),
    }),
  );
}

export async function deleteSchedule(form: FormData): Promise<void> {
  const id = text(form, 'id');
  await runAction(PATH, (hospitalId) =>
    apiSend('DELETE', `/hospitals/${hospitalId}/schedules/${id}`),
  );
}
