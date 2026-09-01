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

/**
 * Doctor configuration is ADMIN's, but READING the list is not.
 *
 * Phase 6 widened the two GETs to RECEPTION and DOCTOR: the queue console names the
 * doctor running each session, and a receptionist who cannot read their own
 * hospital's doctor list cannot be shown whose queue they are working. Sessions have
 * been readable by all three roles since Phase 2 for the same reason; this closes the
 * gap that made them useless without it.
 *
 * Writes stay ADMIN-only, per method. That is the whole point of the split - a
 * receptionist can see who works here and can change nothing about them.
 */
@Roles('ADMIN')
@Controller('hospitals/:hospitalId/doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Roles('ADMIN', 'RECEPTION', 'DOCTOR')
  @Get()
  list(
    @CurrentHospital() tenant: TenantContext,
    @Query(new ZodBody(ConfigListQuery)) query: ConfigListQuery,
  ): Promise<Paginated<Doctor>> {
    return this.doctors.list(tenant.hospitalId, query);
  }

  @Roles('ADMIN', 'RECEPTION', 'DOCTOR')
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
