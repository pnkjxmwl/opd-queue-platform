import { Controller, Get, Param } from '@nestjs/common';
import type { SessionEta } from '@opd/contracts';
import { CurrentHospital, Roles } from '../../common/decorators';
import type { TenantContext } from '../../common/auth-context';
import { EtaService } from './eta.service';

/**
 * P7-BE-03 · queue health, for the people running the clinic (docs/PRD.md 195).
 *
 * **`:sessionId`, not `:id`** - the name is what makes the global TenantGuard resolve
 * the hospital from the session row (trap 12 in docs/PROGRESS.md). Patients never
 * call this: their ETA arrives on shapes they already fetch.
 *
 * A read, so no lock and no command.
 */
@Roles('ADMIN', 'RECEPTION', 'DOCTOR')
@Controller('sessions/:sessionId')
export class EtaController {
  constructor(private readonly eta: EtaService) {}

  @Get('eta')
  sessionEta(
    @Param('sessionId') sessionId: string,
    @CurrentHospital() tenant: TenantContext,
  ): Promise<SessionEta> {
    return this.eta.sessionEta(sessionId, tenant.hospitalId);
  }
}
