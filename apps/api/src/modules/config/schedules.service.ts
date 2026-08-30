import { Injectable } from '@nestjs/common';
import type {
  CreateDoctorScheduleRequest,
  DoctorSchedule,
  Paginated,
  ScheduleListQuery,
  UpdateDoctorScheduleRequest,
} from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundError } from '../../common/errors';
import { dateColumnFromString, dateColumnToString } from '../../common/ist';
import { DoctorsService } from './doctors.service';

type ScheduleRow = {
  id: string;
  doctorId: string;
  weekday: number | null;
  date: Date | null;
  startTime: string;
  endTime: string;
  defaultFeePaise: number;
  createdAt: Date;
};

const toDto = (row: ScheduleRow): DoctorSchedule => ({
  id: row.id,
  doctorId: row.doctorId,
  weekday: row.weekday,
  // A @db.Date column, so it is sliced from the ISO string - a locale formatter
  // would shift the day on any machine behind UTC.
  date: row.date ? dateColumnToString(row.date) : null,
  startTime: row.startTime,
  endTime: row.endTime,
  defaultFeePaise: row.defaultFeePaise,
  createdAt: row.createdAt.toISOString(),
});

/**
 * A doctor's working blocks. Clock times only - a schedule becomes an instant when
 * a date is applied at session-generation time, never before.
 *
 * "exactly one recurrence" and "endTime > startTime" are enforced by Zod AND by
 * database CHECK constraints; this service does not re-implement either. Hard
 * DELETE is safe here (sessions keep provenance via `onDelete: SetNull`), which is
 * why schedules have no isActive flag while departments and doctors do.
 */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly doctors: DoctorsService,
  ) {}

  async list(hospitalId: string, query: ScheduleListQuery): Promise<Paginated<DoctorSchedule>> {
    const where = { hospitalId, ...(query.doctorId ? { doctorId: query.doctorId } : {}) };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.doctorSchedule.findMany({
        where,
        orderBy: [{ weekday: 'asc' }, { date: 'asc' }, { startTime: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.doctorSchedule.count({ where }),
    ]);

    return { items: rows.map(toDto), total, limit: query.limit, offset: query.offset };
  }

  async get(hospitalId: string, id: string): Promise<DoctorSchedule> {
    const row = await this.prisma.doctorSchedule.findFirst({ where: { id, hospitalId } });
    if (!row) throw new NotFoundError('Schedule not found');
    return toDto(row);
  }

  async create(hospitalId: string, input: CreateDoctorScheduleRequest): Promise<DoctorSchedule> {
    // The doctor id comes from the body, so it is checked against this hospital.
    // Both rows existing is not enough - they must be the same tenant's.
    await this.doctors.requireForHospital(hospitalId, input.doctorId);

    const row = await this.prisma.doctorSchedule.create({
      data: {
        hospitalId,
        doctorId: input.doctorId,
        weekday: input.weekday,
        date: input.date ? dateColumnFromString(input.date) : null,
        startTime: input.startTime,
        endTime: input.endTime,
        defaultFeePaise: input.defaultFeePaise,
      },
    });
    return toDto(row);
  }

  /**
   * A full replace, matching UpdateDoctorScheduleRequest: "exactly one recurrence"
   * and "end after start" are cross-field rules that cannot be validated against a
   * partial body without first reading the stored row.
   */
  async update(
    hospitalId: string,
    id: string,
    input: UpdateDoctorScheduleRequest,
  ): Promise<DoctorSchedule> {
    const { count } = await this.prisma.doctorSchedule.updateMany({
      where: { id, hospitalId },
      data: {
        weekday: input.weekday,
        date: input.date ? dateColumnFromString(input.date) : null,
        startTime: input.startTime,
        endTime: input.endTime,
        defaultFeePaise: input.defaultFeePaise,
      },
    });
    if (count === 0) throw new NotFoundError('Schedule not found');

    return this.get(hospitalId, id);
  }

  async remove(hospitalId: string, id: string): Promise<void> {
    const { count } = await this.prisma.doctorSchedule.deleteMany({ where: { id, hospitalId } });
    if (count === 0) throw new NotFoundError('Schedule not found');
  }

  /** Schedules that apply on one IST calendar date - the input to session generation. */
  async matchingDate(
    hospitalId: string,
    date: string,
    weekday: number,
    scheduleId?: string,
  ): Promise<ScheduleRow[]> {
    return this.prisma.doctorSchedule.findMany({
      where: {
        hospitalId,
        ...(scheduleId ? { id: scheduleId } : {}),
        OR: [{ weekday }, { date: dateColumnFromString(date) }],
        // A deactivated doctor must not acquire new sessions tomorrow morning.
        doctor: { isActive: true },
      },
      orderBy: [{ doctorId: 'asc' }, { startTime: 'asc' }],
    });
  }
}
