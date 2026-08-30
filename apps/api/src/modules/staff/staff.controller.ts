import { Body, Controller, Post } from '@nestjs/common';
import { InviteStaffRequest, type StaffInvite } from '@opd/contracts';
import { StaffService } from './staff.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentHospital, Roles } from '../../common/decorators';
import type { TenantContext } from '../../common/auth-context';

@Roles('ADMIN')
@Controller('hospitals/:hospitalId/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post()
  invite(
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(InviteStaffRequest)) body: InviteStaffRequest,
  ): Promise<StaffInvite> {
    return this.staff.invite(tenant.hospitalId, body);
  }
}
