import { Body, Controller, Post } from '@nestjs/common';
import { RegisterPushTokenRequest, type PushTokenResponse } from '@opd/contracts';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentAccount } from '../../common/decorators';
import type { AuthedAccount } from '../../common/auth-context';
import { NotificationsService } from './notifications.service';

/**
 * P8-BE-01 · `POST /me/push-tokens` (docs/Phases.md Phase 8).
 *
 * `/me/...`, so no `:hospitalId` or `:sessionId` segment and TenantGuard passes
 * through by design - a patient has no staff membership anywhere. The account comes
 * from the JWT and never from the body, so a caller can only ever register a device
 * against themselves (trap 12, docs/Rules.md 1.3).
 */
@Controller('me/push-tokens')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  async register(
    @CurrentAccount() account: AuthedAccount,
    @Body(new ZodBody(RegisterPushTokenRequest)) body: RegisterPushTokenRequest,
  ): Promise<PushTokenResponse> {
    await this.notifications.registerDevice(account.id, body);
    return { registered: true };
  }
}
