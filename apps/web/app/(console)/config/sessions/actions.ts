'use server';

import type { GenerateSessionsResponse } from '@opd/contracts';
import { apiSend } from '../../../../lib/api';
import { num, runAction, text } from '../_run';

const PATH = '/config/sessions';

export async function generateSessions(form: FormData): Promise<void> {
  const date = text(form, 'date');

  await runAction(PATH, async (hospitalId) => {
    // Omitting `date` makes the SERVER resolve today in Asia/Kolkata. The browser's
    // idea of today is the 00:30 IST bug waiting to happen.
    const result = await apiSend<GenerateSessionsResponse>(
      'POST',
      `/hospitals/${hospitalId}/sessions/generate`,
      date ? { date } : {},
    );

    // `skipped` is the visible proof that re-running changed nothing. Without it an
    // admin who clicks twice cannot tell idempotency from a silent failure.
    return `created=${result.created.length}&skipped=${result.skipped}`;
  });
}

export async function createSession(form: FormData): Promise<void> {
  await runAction(PATH, (hospitalId) =>
    apiSend('POST', `/hospitals/${hospitalId}/sessions`, {
      doctorId: text(form, 'doctorId'),
      date: text(form, 'date'),
      startTime: text(form, 'startTime'),
      endTime: text(form, 'endTime'),
      feePaise: Math.round((num(form, 'feeRupees') ?? 0) * 100),
      tokenPrefix: text(form, 'tokenPrefix') || 'A',
    }),
  );
}
