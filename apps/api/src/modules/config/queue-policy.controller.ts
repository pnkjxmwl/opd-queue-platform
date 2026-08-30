import { Body, Controller, Get, Put } from '@nestjs/common';
import { UpdateQueuePolicyRequest, type QueuePolicy } from '@opd/contracts';
import { QueuePolicyService } from './queue-policy.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentHospital, Roles } from '../../common/decorators';
import type { TenantContext } from '../../common/auth-context';

/**
 * One policy per hospital, so this is a singleton resource: GET and PUT, no id and
 * no POST. PUT replaces rather than patches - a half-applied policy is exactly what
 * the engine must never read.
 */
@Roles('ADMIN')
@Controller('hospitals/:hospitalId/queue-policy')
export class QueuePolicyController {
  constructor(private readonly policy: QueuePolicyService) {}

  @Get()
  get(@CurrentHospital() tenant: TenantContext): Promise<QueuePolicy> {
    return this.policy.ensure(tenant.hospitalId);
  }

  @Put()
  replace(
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(UpdateQueuePolicyRequest)) body: UpdateQueuePolicyRequest,
  ): Promise<QueuePolicy> {
    return this.policy.replace(tenant.hospitalId, body);
  }
}
