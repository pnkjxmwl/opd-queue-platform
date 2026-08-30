'use server';

import { apiSend } from '../../../../lib/api';
import { bool, num, runAction, text } from '../_run';

const PATH = '/config/policy';

/**
 * PUT is a full replace, so the form submits every field of the frozen schema -
 * including the checkboxes, which are absent from FormData when unticked and would
 * otherwise silently reset to their defaults rather than to what the admin chose.
 */
export async function savePolicy(form: FormData): Promise<void> {
  await runAction(PATH, (hospitalId) =>
    apiSend('PUT', `/hospitals/${hospitalId}/queue-policy`, {
      orderingStrategy: text(form, 'orderingStrategy'),
      checkInRequired: bool(form, 'checkInRequired'),
      walkInEnabled: bool(form, 'walkInEnabled'),
      priorityEnabled: bool(form, 'priorityEnabled'),

      gracePeriodSec: num(form, 'gracePeriodSec'),
      recallAttempts: num(form, 'recallAttempts'),
      requeueBehavior: text(form, 'requeueBehavior'),

      cutoffOnEtaOverrun: bool(form, 'cutoffOnEtaOverrun'),
      // Blank means "no clock cutoff", which is null, not zero.
      cutoffMinsBeforeEnd: num(form, 'cutoffMinsBeforeEnd'),
      maxOnlineTokens: num(form, 'maxOnlineTokens'),

      arriveBeforeMins: num(form, 'arriveBeforeMins'),

      cancellationRules: {
        freeCancellationMins: num(form, 'freeCancellationMins'),
        lateCancellationRefundPct: num(form, 'lateCancellationRefundPct'),
        noShowRefundPct: num(form, 'noShowRefundPct'),
        sessionCancelledRefundPct: num(form, 'sessionCancelledRefundPct'),
      },
    }),
  );
}
