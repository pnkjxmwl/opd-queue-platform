import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  DepartmentListQuery,
  DoctorSearchQuery,
  HospitalSearchQuery,
  PageQuery,
  SessionCardQuery,
  type City,
  type HospitalCard,
  type HospitalDetail,
  type Paginated,
  type PublicDepartment,
  type PublicDoctor,
  type SessionCard,
  type SessionDetail,
} from '@opd/contracts';
import { DiscoveryService } from './discovery.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';

/**
 * Patient-facing browse: city -> hospital -> department -> session (docs/PRD.md 5.1).
 *
 * **Authenticated, but not tenant-scoped.** These routes are "public" in the sense
 * docs/Phases.md means - any signed-in patient may see any listable hospital, not
 * only one they are staff of. That is expressed by the ABSENCE of a :hospitalId
 * path segment: TenantGuard keys off that parameter and passes straight through, so
 * every route here uses :id. Renaming one of these to :hospitalId would silently
 * demand a staff membership and lock every patient out.
 *
 * There is no @Public() either. Nothing here is secret, but docs/PRD.md 6.1 has the
 * patient signed in before they browse, and an unauthenticated endpoint is one more
 * thing to rate-limit in Phase 9 for no gain today.
 *
 * Route shapes are checked against the Phase-2 admin controllers in
 * discovery.e2e.test.ts - Express matches on shape, not on parameter name.
 */
@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('cities')
  cities(@Query(new ZodBody(PageQuery)) query: PageQuery): Promise<Paginated<City>> {
    return this.discovery.cities(query);
  }

  @Get('hospitals')
  hospitals(
    @Query(new ZodBody(HospitalSearchQuery)) query: HospitalSearchQuery,
  ): Promise<Paginated<HospitalCard>> {
    return this.discovery.hospitals(query);
  }

  @Get('hospitals/:id')
  hospital(@Param('id') id: string): Promise<HospitalDetail> {
    return this.discovery.hospital(id);
  }

  /**
   * `?hospitalId=` rather than `/hospitals/:id/departments`: that path collides with
   * the ADMIN route from Phase 2. See DepartmentListQuery in packages/contracts.
   */
  @Get('departments')
  departments(
    @Query(new ZodBody(DepartmentListQuery)) query: DepartmentListQuery,
  ): Promise<Paginated<PublicDepartment>> {
    return this.discovery.departments(query);
  }

  @Get('departments/:id/sessions')
  departmentSessions(
    @Param('id') id: string,
    @Query(new ZodBody(SessionCardQuery)) query: SessionCardQuery,
  ): Promise<Paginated<SessionCard>> {
    return this.discovery.sessionsForDepartment(id, query);
  }

  @Get('doctors')
  doctors(
    @Query(new ZodBody(DoctorSearchQuery)) query: DoctorSearchQuery,
  ): Promise<Paginated<PublicDoctor>> {
    return this.discovery.doctors(query);
  }

  @Get('doctors/:id')
  doctor(@Param('id') id: string): Promise<PublicDoctor> {
    return this.discovery.doctor(id);
  }

  @Get('doctors/:id/sessions')
  doctorSessions(
    @Param('id') id: string,
    @Query(new ZodBody(SessionCardQuery)) query: SessionCardQuery,
  ): Promise<Paginated<SessionCard>> {
    return this.discovery.sessionsForDoctor(id, query);
  }

  @Get('sessions/:id')
  session(@Param('id') id: string): Promise<SessionDetail> {
    return this.discovery.session(id);
  }
}
