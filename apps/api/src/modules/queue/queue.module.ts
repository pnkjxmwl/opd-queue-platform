import { Module } from '@nestjs/common';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { ReservationSweeper } from './reservation-sweeper';
import { ConfigModule } from '../config/config.module';
import { RealtimeModule } from '../../realtime/realtime.module';

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
  // RealtimeModule so every command announces itself AFTER it commits (P7-BE-02).
  // The dependency runs one way only: the gateway knows nothing about the queue.
  imports: [ConfigModule, RealtimeModule],
  controllers: [QueueController],
  providers: [QueueService, ReservationSweeper],
  exports: [QueueService, ReservationSweeper],
})
export class QueueModule {}
