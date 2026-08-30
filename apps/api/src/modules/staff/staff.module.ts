import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { ConfigModule } from '../config/config.module';

/** Owns HospitalStaff. Reaches the Doctor table only through DoctorsService. */
@Module({
  imports: [ConfigModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
