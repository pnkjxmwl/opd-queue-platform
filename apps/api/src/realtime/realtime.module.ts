import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Realtime distribution (docs/Architecture.md 9).
 *
 * Exports the gateway so the queue engine can emit after a command commits. Nothing
 * flows the other way: this module reads no queue state and calls no command, which
 * is what lets it be removed without changing a single rule.
 */
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
