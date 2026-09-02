import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType, RegisterPushTokenRequest } from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { isUniqueViolation } from '../../common/prisma-errors';
import { ExpoClient } from './expo.client';
import { render } from './templates';

/**
 * P8-BE-01 · everything we tell a patient goes through here
 * (docs/Architecture.md 13: *"no notification logic scattered in feature code"*).
 *
 * **A row is written first and sent afterwards.** Nothing calls Expo from inside a
 * queue command, for the same reason nothing calls Razorpay from inside one: an HTTP
 * call in a transaction holds a lock across the network, and a send that happens
 * before the commit is a lie if the commit then fails. So `record()` writes a PENDING
 * row and `dispatch()` sends it on the next sweep - which also means a push survives
 * a restart between the two, and there is a history to answer "was she told?" with.
 */

/** How many attempts before a notification is given up on. */
const MAX_ATTEMPTS = 4;

/** One sweep sends at most this many, so a backlog cannot become a stampede. */
const BATCH = 100;

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly expo: ExpoClient,
  ) {}

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------

  /**
   * `POST /me/push-tokens` - this device, for this account.
   *
   * An upsert on the TOKEN, not on (account, token). A phone gets handed to a family
   * member who signs in as themselves, and Expo would then route the first person's
   * pushes to the second unless registering MOVES the token. It also clears
   * `disabledAt`, because a device that just registered is plainly not gone.
   */
  async registerDevice(accountId: string, input: RegisterPushTokenRequest): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token: input.token },
      create: {
        accountId,
        token: input.token,
        platform: input.platform ?? null,
        lastUsedAt: new Date(),
      },
      update: {
        accountId,
        platform: input.platform ?? null,
        disabledAt: null,
        lastUsedAt: new Date(),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  /**
   * Queue one message, exactly once per booking per type.
   *
   * **The dedupe is the database's `unique(entryId, type)`, not a check here**
   * (docs/Rules.md 5). "You are getting close" is produced by a sweep that runs every
   * half-minute; an application check loses that race the first time two passes
   * overlap, and docs/Phases.md is blunt about the consequence: *"notification storms
   * destroy trust faster than no notifications."* A duplicate insert violates the
   * constraint and is swallowed as "already told them", which is the truth.
   *
   * Returns whether this call is the one that recorded it.
   */
  async record(input: {
    accountId: string;
    entryId: string;
    sessionId: string;
    type: NotificationType;
    tokenLabel: string;
    hospitalName: string;
    aheadCount?: number;
  }): Promise<boolean> {
    const { title, body } = render(input.type, {
      tokenLabel: input.tokenLabel,
      hospitalName: input.hospitalName,
      aheadCount: input.aheadCount,
    });

    try {
      await this.prisma.notification.create({
        data: {
          accountId: input.accountId,
          entryId: input.entryId,
          type: input.type,
          title,
          body,
          // The deep link, and nothing else. No name, no diagnosis (docs/Rules.md 8).
          data: { type: input.type, entryId: input.entryId, sessionId: input.sessionId },
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /**
   * Send what is waiting. Called by the dispatch sweeper; returns how many were sent
   * so a test can assert on it without watching a clock.
   */
  async dispatch(): Promise<{ sent: number; failed: number }> {
    const pending = await this.prisma.notification.findMany({
      where: { status: 'PENDING', attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      include: { account: { select: { pushTokens: { where: { disabledAt: null } } } } },
    });
    if (pending.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;

    for (const notification of pending) {
      const tokens = notification.account.pushTokens;

      if (tokens.length === 0) {
        // Nowhere to send it. Not a failure to retry forever - this account has no
        // device registered, and the record stands as the history that we tried.
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'FAILED', attempts: MAX_ATTEMPTS, lastError: 'no registered device' },
        });
        failed += 1;
        continue;
      }

      const results = await this.expo.send(
        tokens.map((device) => ({
          token: device.token,
          title: notification.title,
          body: notification.body,
          data: (notification.data ?? {}) as Record<string, string>,
        })),
      );

      // Prune what Expo says is gone, or the delivery rate quietly rots as dead
      // tokens accumulate (docs/Phases.md).
      const dead = results.filter((r) => r.deviceGone).map((r) => r.token);
      if (dead.length > 0) {
        await this.prisma.pushToken.updateMany({
          where: { token: { in: dead } },
          data: { disabledAt: new Date() },
        });
      }

      // Reaching ONE of a patient's devices is a delivered notification. They only
      // have to see it once.
      const delivered = results.some((r) => r.ok);
      const attempts = notification.attempts + 1;

      await this.prisma.notification.update({
        where: { id: notification.id },
        data: delivered
          ? { status: 'SENT', sentAt: new Date(), attempts, lastError: null }
          : {
              // Give up only once every device is gone or the attempts are spent.
              // Anything else stays PENDING and the next sweep tries again.
              status: attempts >= MAX_ATTEMPTS || dead.length === results.length ? 'FAILED' : 'PENDING',
              attempts,
              lastError: results.find((r) => !r.ok)?.error ?? 'send failed',
            },
      });

      if (delivered) sent += 1;
      else failed += 1;
    }

    return { sent, failed };
  }
}
