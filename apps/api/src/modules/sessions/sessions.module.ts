import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { ConfigModule } from '../config/config.module';

/**
 * Owns the OPDSession table. Reads doctors, schedules and the queue policy through
 * ConfigModule's services rather than their tables (docs/CLAUDE.md 3).
 */
@Module({
  imports: [ConfigModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
