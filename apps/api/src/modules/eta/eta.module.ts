import { Module } from '@nestjs/common';
import { EtaController } from './eta.controller';
import { EtaService } from './eta.service';
import { EtaTick } from './eta-tick';
import { RealtimeModule } from '../../realtime/realtime.module';

/**
 * The estimation engine (docs/Architecture.md 8).
 *
 * Exports the service because discovery, payments and the realtime tick all need a
 * window; the engine behind it is pure and can be rewritten freely behind this seam.
 */
@Module({
  imports: [RealtimeModule],
  controllers: [EtaController],
  providers: [EtaService, EtaTick],
  exports: [EtaService, EtaTick],
})
export class EtaModule {}
