import { Injectable } from '@nestjs/common';
import type {
  CreateOPDSessionRequest,
  DoctorPresence,
  GenerateSessionsRequest,
  GenerateSessionsResponse,
  OPDSession,
  Paginated,
  SessionListQuery,
  SessionStatus,
} from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../common/errors';
import { isUniqueViolation } from '../../common/prisma-errors';
import {
  dateColumnFromString,
  dateColumnToString,
  istToUtc,
  istToday,
  istWeekday,
} from '../../common/ist';
import { DoctorsService } from '../config/doctors.service';
import { SchedulesService } from '../config/schedules.service';
import { QueuePolicyService } from '../config/queue-policy.service';

type SessionRow = {
  id: string;
  departmentId: string;
  scheduleId: string | null;
  originalDoctorId: string;
  currentProviderDoctorId: string;
  date: Date;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: string;
  doctorPresence: string;
  tokenPrefix: string;
  feePaise: number;
  registrationClosedAt: Date | null;
  version: number;
};

const toDto = (row: SessionRow): OPDSession => ({
  id: row.id,
  departmentId: row.departmentId,
  scheduleId: row.scheduleId,
  originalDoctorId: row.originalDoctorId,
  currentProviderDoctorId: row.currentProviderDoctorId,
  date: dateColumnToString(row.date),
  scheduledStart: row.scheduledStart.toISOString(),
  scheduledEnd: row.scheduledEnd.toISOString(),
  status: row.status as SessionStatus,
  doctorPresence: row.doctorPresence as DoctorPresence,
  tokenPrefix: row.tokenPrefix,
  feePaise: row.feePaise,
  registrationClosedAt: row.registrationClosedAt?.toISOString() ?? null,
  version: row.version,
});

const DUPLICATE = 'A session already exists for this doctor, date and start time';

/**
 * OPD sessions - a doctor's working block on one date, and the thing a queue will
 * belong to from Phase 4.
 *
 * Two rules shape this whole file:
 *
 *  - **Every date is an IST date, computed on the server.** A client's "today" sent
 *    at 00:30 IST is still yesterday in UTC. All conversion goes through common/ist.
 *  - **Idempotency is the database's job.** `@@unique(originalDoctorId, date,
 *    scheduledStart)` is what makes a double-clicked "generate" harmless; this
 *    service only translates the resulting P2002 into "skipped". An application-side
 *    "does it exist yet?" check loses that race, and staff will double-click.
 *
 * Sessions are created OPEN_FOR_REGISTRATION and there is no status field on the
 * create DTO: docs/Rules.md 1.2 forbids raw CRUD on session status, so every later
 * change is a Phase-4 domain command.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly doctors: DoctorsService,
    private readonly schedules: SchedulesService,
    private readonly policy: QueuePolicyService,
  ) {}

  async list(hospitalId: string, query: SessionListQuery): Promise<Paginated<OPDSession>> {
    const where = {
      hospitalId,
      ...(query.date ? { date: dateColumnFromString(query.date) } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      // The booking doctor. Substitution arrives in Phase 4; when it does, this
      // becomes an OR across originalDoctorId and currentProviderDoctorId.
      ...(query.doctorId ? { originalDoctorId: query.doctorId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.oPDSession.findMany({
        where,
        orderBy: [{ date: 'desc' }, { scheduledStart: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.oPDSession.count({ where }),
    ]);

    return { items: rows.map(toDto), total, limit: query.limit, offset: query.offset };
  }

  async get(hospitalId: string, id: string): Promise<OPDSession> {
    const row = await this.prisma.oPDSession.findFirst({ where: { id, hospitalId } });
    if (!row) throw new NotFoundError('Session not found');
    return toDto(row);
  }

  async create(hospitalId: string, input: CreateOPDSessionRequest): Promise<OPDSession> {
    const doctor = await this.doctors.requireForHospital(hospitalId, input.doctorId);
    if (!doctor.isActive) {
      throw new ValidationFailedError('Doctor is not active', { doctorId: 'inactive' });
    }

    // The engine must always find a policy; this is the only place a session can be
    // born, so it is the right place to guarantee one exists.
    await this.policy.ensure(hospitalId);

    try {
      const row = await this.prisma.oPDSession.create({
        data: {
          hospitalId,
          departmentId: doctor.departmentId,
          originalDoctorId: doctor.id,
          currentProviderDoctorId: doctor.id,
          date: dateColumnFromString(input.date),
          scheduledStart: istToUtc(input.date, input.startTime),
          scheduledEnd: istToUtc(input.date, input.endTime),
          tokenPrefix: input.tokenPrefix,
          feePaise: input.feePaise,
        },
      });
      return toDto(row);
    } catch (error) {
      // The idempotency constraint fires on a hand-created session too, not only on
      // generate. Unmapped this would be a 500 with Prisma internals in it.
      if (isUniqueViolation(error)) throw new ConflictError(DUPLICATE);
      throw error;
    }
  }

  /**
   * Create today's (or a given date's) sessions from the matching schedules.
   *
   * Re-running is safe and is the point: each row is inserted on its own, and a
   * duplicate is counted as `skipped` rather than aborting the batch. That also
   * means a half-finished run can simply be re-run to completion.
   */
  async generate(
    hospitalId: string,
    input: GenerateSessionsRequest,
  ): Promise<GenerateSessionsResponse> {
    // Omitted date means today IN IST, resolved here on the server.
    const date = input.date ?? istToday();
    const weekday = istWeekday(date);

    const schedules = await this.schedules.matchingDate(
      hospitalId,
      date,
      weekday,
      input.scheduleId,
    );

    await this.policy.ensure(hospitalId);

    const created: OPDSession[] = [];
    let skipped = 0;

    for (const schedule of schedules) {
      const doctor = await this.doctors.requireForHospital(hospitalId, schedule.doctorId);
      try {
        const row = await this.prisma.oPDSession.create({
          data: {
            hospitalId,
            departmentId: doctor.departmentId,
            scheduleId: schedule.id,
            originalDoctorId: schedule.doctorId,
            currentProviderDoctorId: schedule.doctorId,
            date: dateColumnFromString(date),
            scheduledStart: istToUtc(date, schedule.startTime),
            scheduledEnd: istToUtc(date, schedule.endTime),
            feePaise: schedule.defaultFeePaise,
          },
        });
        created.push(toDto(row));
      } catch (error) {
        if (isUniqueViolation(error)) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    return { created, skipped };
  }
}
