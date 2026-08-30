import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ConfigListQuery,
  CreateDepartmentRequest,
  UpdateDepartmentRequest,
  type Department,
  type Paginated,
} from '@opd/contracts';
import { DepartmentsService } from './departments.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentHospital, Roles } from '../../common/decorators';
import type { TenantContext } from '../../common/auth-context';

/**
 * The :hospitalId segment is what makes TenantGuard engage - it is not read by any
 * handler here. The hospital always comes from the resolved membership.
 */
@Roles('ADMIN')
@Controller('hospitals/:hospitalId/departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  list(
    @CurrentHospital() tenant: TenantContext,
    @Query(new ZodBody(ConfigListQuery)) query: ConfigListQuery,
  ): Promise<Paginated<Department>> {
    return this.departments.list(tenant.hospitalId, query);
  }

  @Get(':id')
  get(@CurrentHospital() tenant: TenantContext, @Param('id') id: string): Promise<Department> {
    return this.departments.get(tenant.hospitalId, id);
  }

  @Post()
  create(
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(CreateDepartmentRequest)) body: CreateDepartmentRequest,
  ): Promise<Department> {
    return this.departments.create(tenant.hospitalId, body);
  }

  @Patch(':id')
  update(
    @CurrentHospital() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodBody(UpdateDepartmentRequest)) body: UpdateDepartmentRequest,
  ): Promise<Department> {
    return this.departments.update(tenant.hospitalId, id, body);
  }

  /** Deactivates - see DepartmentsService.deactivate for why this is not a delete. */
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentHospital() tenant: TenantContext, @Param('id') id: string): Promise<void> {
    return this.departments.deactivate(tenant.hospitalId, id);
  }
}
