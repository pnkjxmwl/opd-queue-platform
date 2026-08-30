import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CreateOPDSessionRequest,
  GenerateSessionsRequest,
  SessionListQuery,
  type GenerateSessionsResponse,
  type OPDSession,
  type Paginated,
} from '@opd/contracts';
import { SessionsService } from './sessions.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentHospital, Roles } from '../../common/decorators';
import type { TenantContext } from '../../common/auth-context';

/**
 * Reads are resource-style; creation is a POST. There is deliberately no PATCH:
 * every change to a session's status is a Phase-4 domain command, never CRUD
 * (docs/Rules.md 1.2, 6).
 *
 * RECEPTION can read sessions - the staff console needs them from Phase 6 - but only
 * ADMIN creates or generates them.
 */
@Controller('hospitals/:hospitalId/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Roles('ADMIN', 'RECEPTION', 'DOCTOR')
  @Get()
  list(
    @CurrentHospital() tenant: TenantContext,
    @Query(new ZodBody(SessionListQuery)) query: SessionListQuery,
  ): Promise<Paginated<OPDSession>> {
    return this.sessions.list(tenant.hospitalId, query);
  }

  @Roles('ADMIN', 'RECEPTION', 'DOCTOR')
  @Get(':id')
  get(@CurrentHospital() tenant: TenantContext, @Param('id') id: string): Promise<OPDSession> {
    return this.sessions.get(tenant.hospitalId, id);
  }

  @Roles('ADMIN')
  @Post()
  create(
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(CreateOPDSessionRequest)) body: CreateOPDSessionRequest,
  ): Promise<OPDSession> {
    return this.sessions.create(tenant.hospitalId, body);
  }

  /** Idempotent: running it twice creates nothing new and reports the duplicates. */
  @Roles('ADMIN')
  @HttpCode(200)
  @Post('generate')
  generate(
    @CurrentHospital() tenant: TenantContext,
    @Body(new ZodBody(GenerateSessionsRequest)) body: GenerateSessionsRequest,
  ): Promise<GenerateSessionsResponse> {
    return this.sessions.generate(tenant.hospitalId, body);
  }
}
