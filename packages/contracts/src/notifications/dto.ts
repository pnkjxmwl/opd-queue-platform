import { z } from 'zod';

/**
 * P8-CONTRACT-01 · notifications (docs/Architecture.md 13, docs/PRD.md 6.1).
 *
 * Push is the only channel in the MVP. SMS and WhatsApp need India DLT registration
 * and are deliberately deferred (docs/Architecture.md 18), which is why nothing here
 * names a channel in a way that would have to change to add one.
 */

/**
 * What we tell a patient about, and nothing else.
 *
 * A closed set rather than free text, because these are also the **dedupe key**: the
 * database refuses a second row for the same entry and type, which is what stops the
 * ETA tick from sending "you're getting close" every minute. docs/Phases.md names
 * notification storms as the thing that *"destroys trust faster than no
 * notifications"*.
 */
export const NotificationType = z.enum([
  /** The webhook confirmed payment and a token exists. */
  'TOKEN_ISSUED',
  /** Their turn is near enough to set off - the "wait at home" promise paying out. */
  'LEAVE_NOW',
  /** The doctor has called them in. */
  'CALLED',
  /** Called, absent, being called again (docs/PRD.md 8.8). */
  'RECALLED',
  /** Passed over after the grace period; still today's patient, can be requeued. */
  'SKIPPED',
  /** The booking ended without them being seen. */
  'NO_SHOW',
  /** Staff or the hospital withdrew the booking. */
  'CANCELLED',
  /** Money is on its way back. */
  'REFUND_RAISED',
  /** The session ended and they were rescheduled rather than seen. */
  'RESCHEDULED',
]);
export type NotificationType = z.infer<typeof NotificationType>;

export const NotificationStatus = z.enum(['PENDING', 'SENT', 'FAILED']);
export type NotificationStatus = z.infer<typeof NotificationStatus>;

/**
 * `POST /me/push-tokens` - a device says where to reach it.
 *
 * The token is an Expo push token (`ExponentPushToken[...]`), which is opaque and
 * device-specific. Shape is not validated beyond a length bound: Expo owns that
 * format and a client that guesses wrong should be told so by Expo, not by a regex
 * here that will rot.
 */
export const RegisterPushTokenRequest = z.object({
  token: z.string().trim().min(10).max(255),
  /** Helps prune sensibly when a device re-registers. Optional - iOS/Android only. */
  platform: z.enum(['ios', 'android']).optional(),
});
export type RegisterPushTokenRequest = z.infer<typeof RegisterPushTokenRequest>;

export const PushTokenResponse = z.object({
  registered: z.boolean(),
});
export type PushTokenResponse = z.infer<typeof PushTokenResponse>;

/**
 * What a push actually carries.
 *
 * `entryId` is what a tap deep-links to. **No patient name and no clinical detail**:
 * a push notification renders on a lock screen, in public, on a device that may not
 * be the patient's own (docs/Rules.md 8, DPDP). The token label is enough for the
 * person expecting it and means nothing to anyone else.
 */
export const PushPayload = z.object({
  type: NotificationType,
  entryId: z.string().uuid(),
  sessionId: z.string().uuid(),
});
export type PushPayload = z.infer<typeof PushPayload>;
