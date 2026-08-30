import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';
import { QueuePolicyController } from './queue-policy.controller';
import { QueuePolicyService } from './queue-policy.service';

/**
 * Hospital configuration: departments, doctors, schedules, queue policy.
 *
 * One module rather than four, because these four tables are edited together, are
 * all ADMIN-only and tenant-scoped, and reference each other constantly (a schedule
 * needs its doctor, a doctor needs its department). Splitting them would turn every
 * ordinary read into a cross-module service call for no isolation gained -
 * docs/Rules.md forbids a module reading ANOTHER module's tables, and this module
 * owns all four.
 *
 * Services are exported for the sessions and staff modules, which must not touch
 * these tables directly.
 */
@Module({
  controllers: [
    DepartmentsController,
    DoctorsController,
    SchedulesController,
    QueuePolicyController,
  ],
  providers: [DepartmentsService, DoctorsService, SchedulesService, QueuePolicyService],
  exports: [DepartmentsService, DoctorsService, SchedulesService, QueuePolicyService],
})
export class ConfigModule {}
