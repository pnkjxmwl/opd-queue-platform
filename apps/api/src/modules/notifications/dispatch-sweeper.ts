import { Injectable } from '@nestjs/common';
import { Sweeper } from '../../common/sweeper';
import { NotificationsService } from './notifications.service';

/**
 * P8-BE-01 · sends what `NotificationsService.record()` wrote down.
 *
 * Separate from the recorder so that a slow or failing Expo cannot slow down or fail
 * the thing that decided a patient should be told. The outbox in between is what
 * makes a push survive a restart, and what makes "was she told?" answerable.
 */
@Injectable()
export class DispatchSweeper extends Sweeper {
  protected readonly name = 'dispatch';
  /** Fast: this is the last hop before a phone buzzes. */
  protected readonly intervalMs = 15_000;

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  protected async sweep(): Promise<void> {
    const { sent, failed } = await this.notifications.dispatch();
    if (sent > 0 || failed > 0) this.log.log(`dispatched ${sent}, failed ${failed}`);
  }
}
