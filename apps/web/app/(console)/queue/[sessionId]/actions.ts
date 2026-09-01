'use server';

import type { QueueCommandResult, StaffCancelEntryResponse } from '@opd/contracts';
import { apiSend } from '../../../../lib/api';
import { runQueueAction, text } from '../_run';

/**
 * Every button on the board, one function each.
 *
 * **These are the Phase-4 domain commands and nothing else.** No branching on
 * status, no ordering, no "is this allowed" - the server decides all of it and this
 * file only names an intent. docs/Phases.md, verbatim: *the console calls Phase-4
 * command endpoints; do not reimplement any queue logic in the frontend, and surface
 * server rejections to the user instead of failing silently.*
 *
 * A form posts here, `runQueueAction` puts the server's own rejection in `?error=`,
 * and the board re-reads. There is no optimistic update: with no realtime until
 * Phase 7, a screen that pretended an action succeeded would be lying about a queue
 * with a patient standing next to it.
 */

const boardPath = (sessionId: string): string => `/queue/${sessionId}`;

/** POST /sessions/:sessionId/<command> with the session resolved from the form. */
const command = (sessionId: string, name: string, body: unknown = {}) =>
  apiSend<QueueCommandResult>('POST', `/sessions/${sessionId}/${name}`, body);

/**
 * The common case: issue the command and let the board re-read.
 *
 * Returns nothing, so `runQueueAction` redirects to a clean URL. Only the actions
 * that have something to SAY - a token was called, a refund was raised - return a
 * message, and those build it themselves.
 */
const issue = async (sessionId: string, name: string, body: unknown = {}): Promise<void> => {
  await command(sessionId, name, body);
};

// ---------------------------------------------------------------------------
// Session control (the doctor's row of controls)
// ---------------------------------------------------------------------------

export async function callNext(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), async () => {
    // No body: the SERVER picks who is next. A client that named the patient would
    // be deciding call order (docs/Rules.md 1).
    const result = await command(sessionId, 'call-next');
    return `called=${encodeURIComponent(result.entry?.tokenLabel ?? '')}`;
  });
}

export async function startConsultation(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), () =>
    issue(sessionId, 'start-consultation', { entryId: text(form, 'entryId') }),
  );
}

export async function completeConsultation(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), () =>
    issue(sessionId, 'complete-consultation', { entryId: text(form, 'entryId') }),
  );
}

export async function skipPatient(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  const reason = text(form, 'reason');
  await runQueueAction(boardPath(sessionId), () =>
    issue(sessionId, 'skip', {
      entryId: text(form, 'entryId'),
      // Omitted rather than sent empty: the DTO wants a real reason or none, and ''
      // would fail validation for saying nothing.
      ...(reason === '' ? {} : { reason }),
    }),
  );
}

export async function markNoShow(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), () =>
    issue(sessionId, 'no-show', { entryId: text(form, 'entryId') }),
  );
}

export async function requeuePatient(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), () =>
    issue(sessionId, 'requeue', { entryId: text(form, 'entryId') }),
  );
}

export async function pauseQueue(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  const reason = text(form, 'reason');
  await runQueueAction(boardPath(sessionId), () =>
    issue(sessionId, 'pause', reason === '' ? {} : { reason }),
  );
}

export async function resumeQueue(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), () => issue(sessionId, 'resume'));
}

export async function setPresence(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), () =>
    issue(sessionId, 'presence', { presence: text(form, 'presence') }),
  );
}

export async function endSession(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  const reason = text(form, 'reason');
  await runQueueAction(boardPath(sessionId), () =>
    issue(sessionId, 'end', reason === '' ? {} : { reason }),
  );
}

// ---------------------------------------------------------------------------
// Per-patient actions (P6-WEB-02, P6-WEB-04)
// ---------------------------------------------------------------------------

/**
 * Check in from the roster - the third route in, and the one that needs no camera
 * and no phone. Reception finds the patient by name and taps.
 */
export async function checkInEntry(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), async () => {
    const result = await command(sessionId, 'check-in', {
      tokenNumber: Number(text(form, 'tokenNumber')),
    });
    const entry = result.entry;
    return `ok=${encodeURIComponent(`${entry?.tokenLabel ?? ''} · ${entry?.patientName ?? ''} checked in`)}`;
  });
}

/**
 * Audited escalation (docs/PRD.md 8.7). The reason is REQUIRED by the DTO and is
 * the only control against this being used to jump paying patients, so it is a
 * required field on the form too rather than something the server rejects later.
 *
 * Setting NORMAL is how an escalation is undone, and is audited the same way.
 */
export async function changePriority(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), () =>
    issue(sessionId, 'priority', {
      entryId: text(form, 'entryId'),
      priority: text(form, 'priority'),
      reason: text(form, 'reason'),
    }),
  );
}

/**
 * P6-WEB-04 · reception withdraws a booking.
 *
 * `cause` decides the refund and the person cancelling states it: PATIENT_REQUEST
 * gets the hospital's own time-based tier, HOSPITAL gets 100%. The result carries
 * the percentage that was actually applied, and it is reported back rather than
 * assumed - the console must never tell a patient a number the server did not use.
 */
export async function cancelEntry(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(boardPath(sessionId), async () => {
    const result = await apiSend<StaffCancelEntryResponse>(
      'POST',
      `/sessions/${sessionId}/cancel-entry`,
      {
        entryId: text(form, 'entryId'),
        cause: text(form, 'cause'),
        reason: text(form, 'reason'),
      },
    );

    const label = result.result.entry?.tokenLabel ?? 'Booking';
    const outcome =
      result.refund === null
        ? 'nothing to refund'
        : `₹${(result.refund.amountPaise / 100).toFixed(2)} refund raised (${result.refund.refundPct}%) — on its way, not settled yet`;
    return `ok=${encodeURIComponent(`${label} cancelled — ${outcome}`)}`;
  });
}
