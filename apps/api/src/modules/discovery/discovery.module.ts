import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

/**
 * The patient read path. Read-only: this module has no writes and exports no
 * service, so nothing else in the API can depend on its shape.
 *
 * See the note on DiscoveryService for why it queries tables the config and
 * sessions modules own, which docs/CLAUDE.md 3 otherwise forbids.
 */
@Module({
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
