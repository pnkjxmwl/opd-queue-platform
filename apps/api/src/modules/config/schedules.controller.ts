import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateDoctorScheduleRequest,
  ScheduleListQuery,
  UpdateDoctorScheduleRequest,
  type DoctorSchedule,
  type Paginated,
} from '@opd/contracts';
import { SchedulesService } from './schedules.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentHospital, Roles } from '../../common/decorators';
import type { TenantContext } from '../../common/auth-context';

@Roles('ADMIN')
@Controller('hospitals/:hospitalId/schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  list(
    @CurrentHospital() tenant: TenantContext,
    @Query(new ZodBody(ScheduleListQuery)) query: ScheduleListQuery,
  ): Promise<Paginated<DoctorSchedule>> {
    return this.schedules.list(tenant.hospitalId, query);
  }

  @Get(':id')
  get(@CurrentHospital() tenant: TenantContext, @Param('id') id: string): Promise<DoctorSchedule> {
    return this.schedules.get(tenant.hospitalId, id);
  }

  @Post()
  create(
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(CreateDoctorScheduleRequest)) body: CreateDoctorScheduleRequest,
  ): Promise<DoctorSchedule> {
    return this.schedules.create(tenant.hospitalId, body);
  }

  @Patch(':id')
  update(
    @CurrentHospital() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodBody(UpdateDoctorScheduleRequest)) body: UpdateDoctorScheduleRequest,
  ): Promise<DoctorSchedule> {
    return this.schedules.update(tenant.hospitalId, id, body);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentHospital() tenant: TenantContext, @Param('id') id: string): Promise<void> {
    return this.schedules.remove(tenant.hospitalId, id);
  }
}
