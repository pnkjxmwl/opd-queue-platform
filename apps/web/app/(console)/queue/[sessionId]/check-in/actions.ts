'use server';

import type { QueueCommandResult } from '@opd/contracts';
import { ApiCallError, apiSend } from '../../../../../lib/api';
import { runQueueAction, text } from '../../_run';

/**
 * P6-WEB-02 · the check-in desk's two inputs, one command behind both.
 *
 * They redirect back to the check-in page rather than to the board, because
 * reception keeps this screen open through a whole clinic and being thrown back to
 * the board after every patient would be unusable.
 *
 * Neither of these decides anything. `POST /sessions/:id/check-in` is idempotent by
 * design - a double-scan succeeds and changes nothing - so there is no "have they
 * already checked in?" guard here, and there must not be: that guard would be a
 * client re-deciding queue state, and it would be wrong the moment two desks scan
 * the same patient.
 */

const checkInPath = (sessionId: string): string => `/queue/${sessionId}/check-in`;

async function checkIn(
  sessionId: string,
  body: { checkInCode: string } | { tokenNumber: number },
): Promise<string> {
  const result = await apiSend<QueueCommandResult>(
    'POST',
    `/sessions/${sessionId}/check-in`,
    body,
  );
  const entry = result.entry;
  // The token AND the name. A receptionist glancing up between two patients needs to
  // see WHO was checked in, or a mis-scan is invisible until the wrong person is
  // called into the room.
  return `ok=${encodeURIComponent(`${entry?.tokenLabel ?? ''} · ${entry?.patientName ?? ''} checked in`)}`;
}

/** The scanned QR. Sent verbatim - the client never parses or trims the payload. */
export async function checkInByCode(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  await runQueueAction(checkInPath(sessionId), () =>
    checkIn(sessionId, { checkInCode: text(form, 'checkInCode') }),
  );
}

/**
 * The manual fallback: the patient reads their token number out loud.
 *
 * Accepts "A027" as well as "27" - reception types what is on the screen in front of
 * them, and rejecting the letter would be pedantry at a busy desk. Only the digits
 * are meaningful: the prefix belongs to the session, which the URL already names.
 */
export async function checkInByToken(form: FormData): Promise<void> {
  const sessionId = text(form, 'sessionId');
  const digits = text(form, 'tokenNumber').replace(/\D/g, '');

  await runQueueAction(checkInPath(sessionId), () => {
    if (digits === '') {
      // Thrown as the API's own error shape would be, so it lands in the same
      // banner as a server rejection instead of blowing up the page.
      throw new ApiCallError('VALIDATION_FAILED', 'Enter a token number, for example 27 or A027.');
    }
    return checkIn(sessionId, { tokenNumber: Number(digits) });
  });
}
