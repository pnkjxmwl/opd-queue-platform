import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { ConfigModule } from '../config/config.module';
import { EtaModule } from '../eta/eta.module';

/**
 * The patient read path. Read-only: this module has no writes and exports no
 * service, so nothing else in the API can depend on its shape.
 *
 * See the note on DiscoveryService for why it queries tables the config and
 * sessions modules own, which docs/CLAUDE.md 3 otherwise forbids.
 */
@Module({
  // Phase 5: the registration cutoff needs QueuePolicy, and the policy is read
  // through its owning SERVICE rather than its table - the part of
  // docs/CLAUDE.md 3 this module does not have an exception to.
  // EtaModule fills joinNowEtaFrom/To on every session card - through its SERVICE,
  // which is how a module gets at data it does not own (docs/CLAUDE.md 3).
  imports: [ConfigModule, EtaModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
