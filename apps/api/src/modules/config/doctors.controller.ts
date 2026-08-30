import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ConfigListQuery,
  CreateDoctorRequest,
  UpdateDoctorRequest,
  type Doctor,
  type Paginated,
} from '@opd/contracts';
import { DoctorsService } from './doctors.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentHospital, Roles } from '../../common/decorators';
import type { TenantContext } from '../../common/auth-context';

@Roles('ADMIN')
@Controller('hospitals/:hospitalId/doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get()
  list(
    @CurrentHospital() tenant: TenantContext,
    @Query(new ZodBody(ConfigListQuery)) query: ConfigListQuery,
  ): Promise<Paginated<Doctor>> {
    return this.doctors.list(tenant.hospitalId, query);
  }

  @Get(':id')
  get(@CurrentHospital() tenant: TenantContext, @Param('id') id: string): Promise<Doctor> {
    return this.doctors.get(tenant.hospitalId, id);
  }

  @Post()
  create(
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(CreateDoctorRequest)) body: CreateDoctorRequest,
  ): Promise<Doctor> {
    return this.doctors.create(tenant.hospitalId, body);
  }

  @Patch(':id')
  update(
    @CurrentHospital() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodBody(UpdateDoctorRequest)) body: UpdateDoctorRequest,
  ): Promise<Doctor> {
    return this.doctors.update(tenant.hospitalId, id, body);
  }

  /** Deactivates - see DoctorsService.deactivate. */
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentHospital() tenant: TenantContext, @Param('id') id: string): Promise<void> {
    return this.doctors.deactivate(tenant.hospitalId, id);
  }
}
