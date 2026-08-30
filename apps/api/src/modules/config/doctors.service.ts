import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ConfigListQuery,
  CreateDoctorRequest,
  Doctor,
  Paginated,
  UpdateDoctorRequest,
} from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundError } from '../../common/errors';
import { DepartmentsService } from './departments.service';

type DoctorRow = {
  id: string;
  departmentId: string;
  name: string;
  specialization: string | null;
  defaultConsultMins: number;
  accountId: string | null;
  isActive: boolean;
  createdAt: Date;
};

const toDto = (row: DoctorRow): Doctor => ({
  id: row.id,
  departmentId: row.departmentId,
  name: row.name,
  specialization: row.specialization,
  defaultConsultMins: row.defaultConsultMins,
  hasLogin: row.accountId !== null,
  isActive: row.isActive,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Doctors, scoped to the caller's hospital.
 *
 * `departmentId` arrives in the request body, so it is verified against the same
 * hospital before use - otherwise an admin could attach a doctor to another
 * hospital's department, which no foreign key would catch (both rows exist).
 */
@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departments: DepartmentsService,
  ) {}

  async list(hospitalId: string, query: ConfigListQuery): Promise<Paginated<Doctor>> {
    const where = { hospitalId, ...(query.includeInactive ? {} : { isActive: true }) };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.doctor.findMany({
        where,
        orderBy: { name: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.doctor.count({ where }),
    ]);

    return { items: rows.map(toDto), total, limit: query.limit, offset: query.offset };
  }

  async get(hospitalId: string, id: string): Promise<Doctor> {
    const row = await this.prisma.doctor.findFirst({ where: { id, hospitalId } });
    if (!row) throw new NotFoundError('Doctor not found');
    return toDto(row);
  }

  async create(hospitalId: string, input: CreateDoctorRequest): Promise<Doctor> {
    await this.departments.assertBelongs(hospitalId, input.departmentId);

    const row = await this.prisma.doctor.create({
      data: {
        hospitalId,
        departmentId: input.departmentId,
        name: input.name,
        specialization: input.specialization ?? null,
        defaultConsultMins: input.defaultConsultMins,
      },
    });
    return toDto(row);
  }

  async update(hospitalId: string, id: string, input: UpdateDoctorRequest): Promise<Doctor> {
    if (input.departmentId !== undefined) {
      await this.departments.assertBelongs(hospitalId, input.departmentId);
    }

    const { count } = await this.prisma.doctor.updateMany({
      where: { id, hospitalId },
      data: {
        ...(input.departmentId !== undefined && { departmentId: input.departmentId }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.specialization !== undefined && { specialization: input.specialization }),
        ...(input.defaultConsultMins !== undefined && {
          defaultConsultMins: input.defaultConsultMins,
        }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
    if (count === 0) throw new NotFoundError('Doctor not found');

    return this.get(hospitalId, id);
  }

  /**
   * DELETE deactivates. Sessions reference the doctor twice with `onDelete: Restrict`
   * (original + current provider), and PRD 8.11 requires both to survive, so the row
   * can never be removed once the doctor has run a single session.
   */
  async deactivate(hospitalId: string, id: string): Promise<void> {
    const { count } = await this.prisma.doctor.updateMany({
      where: { id, hospitalId },
      data: { isActive: false },
    });
    if (count === 0) throw new NotFoundError('Doctor not found');
  }

  /**
   * Point a Doctor row at the account that will log in as them.
   *
   * Takes an optional transaction client so the staff module can link the doctor and
   * create the membership atomically without writing to this table itself
   * (docs/CLAUDE.md 3: no cross-module DB access - call the owning service).
   */
  async linkAccount(
    hospitalId: string,
    doctorId: string,
    accountId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const { count } = await client.doctor.updateMany({
      where: { id: doctorId, hospitalId },
      data: { accountId },
    });
    if (count === 0) throw new NotFoundError('Doctor not found');
  }

  /** The fields other modules need without reaching into the doctor table themselves. */
  async requireForHospital(
    hospitalId: string,
    doctorId: string,
  ): Promise<{
    id: string;
    departmentId: string;
    defaultConsultMins: number;
    isActive: boolean;
    accountId: string | null;
  }> {
    const row = await this.prisma.doctor.findFirst({
      where: { id: doctorId, hospitalId },
      select: {
        id: true,
        departmentId: true,
        defaultConsultMins: true,
        isActive: true,
        accountId: true,
      },
    });
    if (!row) throw new NotFoundError('Doctor not found');
    return row;
  }
}
