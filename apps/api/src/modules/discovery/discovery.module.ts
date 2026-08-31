import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { ConfigModule } from '../config/config.module';

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
  imports: [ConfigModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
