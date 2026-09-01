'use server';

import type { QueueCommandResult } from '@opd/contracts';
import { ApiCallError, apiSend } from '../../../../../lib/api';
import { runQueueAction, text } from '../../_run';

/**
 * P6-WEB-03 · register someone who walked in off the street (docs/PRD.md 8.6).
 *
 * The entry is auto-checked-in and appended at the next token number - both decided
 * by the server. This form has no token field and never will: a walk-in placed by
 * hand is a walk-in placed ahead of someone, and that is what the priority command
 * exists for, audited.
 */
export async function registerWalkIn(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  const name = text(form, 'name');
  const dob = text(form, 'dob');
  const gender = text(form, 'gender');

  await runQueueAction(`/queue/${sessionId}/walk-in`, async () => {
    if (name === '') {
      throw new ApiCallError('VALIDATION_FAILED', 'A walk-in needs a name.');
    }

    const result = await apiSend<QueueCommandResult>(
      'POST',
      `/sessions/${sessionId}/walk-in`,
      {
        name,
        // The DTO wants a full ISO instant; a date input gives a calendar day. Noon
        // UTC, so the day cannot slide backwards when it is read back in IST.
        ...(dob === '' ? {} : { dob: `${dob}T12:00:00.000Z` }),
        ...(gender === '' ? {} : { gender }),
      },
    );

    const entry = result.entry;
    return `ok=${encodeURIComponent(`${entry?.tokenLabel ?? ''} · ${entry?.patientName ?? ''} added and checked in`)}`;
  });
}
