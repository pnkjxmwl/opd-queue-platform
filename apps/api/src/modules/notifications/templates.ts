import type { NotificationType } from '@opd/contracts';

/**
 * What we actually say to a patient (P8-BE-01).
 *
 * **A push renders on a lock screen, in public, on a phone that may be lying on a
 * table.** So none of these carry a patient name, a doctor's name, a department or
 * anything clinical (docs/Rules.md 8, DPDP). The token label is meaningful to the
 * person waiting for it and meaningless to anyone reading over their shoulder -
 * which is exactly the property a token was chosen for.
 *
 * They are written to be read in one glance, standing up, by someone who is anxious.
 * Short sentences, no jargon, and the action first where there is one.
 */

export interface TemplateInput {
  tokenLabel: string;
  /** Hospital name, for the messages where "where" is the missing word. */
  hospitalName: string;
  /** Only used where a number genuinely helps - never as a countdown to be wrong about. */
  aheadCount?: number;
}

export interface RenderedNotification {
  title: string;
  body: string;
}

export function render(type: NotificationType, input: TemplateInput): RenderedNotification {
  const { tokenLabel, hospitalName } = input;

  switch (type) {
    case 'TOKEN_ISSUED':
      return {
        title: `Token ${tokenLabel} confirmed`,
        body: `Your place at ${hospitalName} is booked. We will tell you when it is time to leave.`,
      };

    case 'LEAVE_NOW':
      return {
        title: `Time to head to ${hospitalName}`,
        body:
          input.aheadCount !== undefined && input.aheadCount > 0
            ? `${input.aheadCount} ahead of you. Please arrive and check in at reception.`
            : 'You are next. Please arrive and check in at reception.',
      };

    case 'CALLED':
      return {
        title: `${tokenLabel} - you are being called`,
        body: 'Please go in now.',
      };

    case 'RECALLED':
      return {
        title: `${tokenLabel} - calling you again`,
        body: 'Please go in now, or you may be passed over.',
      };

    case 'SKIPPED':
      return {
        title: `${tokenLabel} was passed over`,
        body: 'You have not lost your place. Check in at reception and you will be called again.',
      };

    case 'NO_SHOW':
      return {
        title: `${tokenLabel} was marked absent`,
        body: `Your booking at ${hospitalName} has ended. Speak to reception if you are still there.`,
      };

    case 'CANCELLED':
      return {
        title: `${tokenLabel} was cancelled`,
        body: `Your booking at ${hospitalName} has been cancelled. Any refund due is on its way.`,
      };

    case 'REFUND_RAISED':
      return {
        title: 'Refund on its way',
        body: 'Your refund has been raised. It usually reaches your account in a few working days.',
      };

    case 'RESCHEDULED':
      return {
        title: `${tokenLabel} could not be seen today`,
        body: `The clinic at ${hospitalName} ended before your turn. Reception can rebook you.`,
      };
  }
}
