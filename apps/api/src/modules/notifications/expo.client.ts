import { Injectable, Logger } from '@nestjs/common';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { env, type Env } from '../../config/env';

/**
 * The Expo Push boundary (docs/Architecture.md 13).
 *
 * Thin on purpose, and shaped exactly like `RazorpayClient`: one class that owns the
 * HTTP call, so every test can replace it with a fake and nothing else in the
 * codebase knows a third party exists. Push is fire-and-forget - docs/Phases.md:
 * *"a bad send cannot be recalled"* - so the seam that lets it be faked is the only
 * way the templates get tested at all.
 */

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

/** What happened to one message. `retryable` decides whether to try it again. */
export interface PushResult {
  token: string;
  ok: boolean;
  /** The device is gone. Prune the token rather than keep failing (docs/Phases.md). */
  deviceGone: boolean;
  error?: string;
}

export interface ExpoApi {
  readonly configured: boolean;
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

@Injectable()
export class ExpoClient implements ExpoApi {
  private readonly log = new Logger(ExpoClient.name);
  private readonly expo: Expo;

  constructor(private readonly config: Env = env()) {
    // An access token is only required once a project enables push security; the SDK
    // works without one. Passing it when present is free and forward-compatible.
    this.expo = new Expo(
      this.config.EXPO_ACCESS_TOKEN === ''
        ? {}
        : { accessToken: this.config.EXPO_ACCESS_TOKEN },
    );
  }

  /**
   * Always true: Expo Push needs no server credential to send, unlike Razorpay.
   * Kept on the interface so a deployment could still turn sending off by swapping
   * the provider, and so the shape matches the gateway client next door.
   */
  readonly configured = true;

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const valid: ExpoPushMessage[] = [];
    const results: PushResult[] = [];

    for (const message of messages) {
      // Expo's own format check, before the network. A malformed token is a dead
      // row, not a transient failure, so it is reported as `deviceGone` and pruned.
      if (!Expo.isExpoPushToken(message.token)) {
        results.push({
          token: message.token,
          ok: false,
          deviceGone: true,
          error: 'not an Expo push token',
        });
        continue;
      }
      valid.push({
        to: message.token,
        title: message.title,
        body: message.body,
        data: message.data,
        sound: 'default',
        // A queue nudge is worthless late. Expo drops it rather than delivering
        // "you are next" an hour after the patient was seen.
        ttl: 60 * 30,
        priority: 'high',
      });
    }

    for (const chunk of this.expo.chunkPushNotifications(valid)) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        // The whole chunk failed to reach Expo - a network problem, not a device
        // problem. Retryable, so nothing is pruned.
        const message = error instanceof Error ? error.message : 'push request failed';
        this.log.error({ err: error }, 'expo push request failed');
        for (const item of chunk) {
          results.push({ token: String(item.to), ok: false, deviceGone: false, error: message });
        }
        continue;
      }

      chunk.forEach((item, index) => {
        const ticket = tickets[index];
        if (ticket === undefined) {
          results.push({ token: String(item.to), ok: false, deviceGone: false, error: 'no ticket' });
          return;
        }
        if (ticket.status === 'ok') {
          results.push({ token: String(item.to), ok: true, deviceGone: false });
          return;
        }
        results.push({
          token: String(item.to),
          ok: false,
          // The one error worth acting on: the app was uninstalled or the token
          // rotated. Everything else is worth retrying.
          deviceGone: ticket.details?.error === 'DeviceNotRegistered',
          error: ticket.message,
        });
      });
    }

    return results;
  }
}
