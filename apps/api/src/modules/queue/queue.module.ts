import { Module } from '@nestjs/common';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { ConfigModule } from '../config/config.module';

/**
 * The queue engine (docs/Architecture.md 7). Owns QueueEntry, QueueEvent,
 * Consultation and the queue's AuditLog rows.
 *
 * The twelve command endpoints live one file each under `commands/`, so parallel
 * agents never edit the same file. Exported now because
 * Phase 5's join/webhook path calls the confirm command through this service rather
 * than writing a QueueEntry itself (docs/Rules.md 1.2 - no raw CRUD on queue state).
 */
@Module({
  imports: [ConfigModule],
  controllers: [QueueController],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
