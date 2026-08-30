import { Injectable } from '@nestjs/common';
import type {
  ConfigListQuery,
  CreateDepartmentRequest,
  Department,
  Paginated,
  UpdateDepartmentRequest,
} from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundError } from '../../common/errors';
import { mapPrismaErrors } from '../../common/prisma-errors';

type DepartmentRow = { id: string; name: string; isActive: boolean; createdAt: Date };

const toDto = (row: DepartmentRow): Department => ({
  id: row.id,
  name: row.name,
  isActive: row.isActive,
  createdAt: row.createdAt.toISOString(),
});

const DUPLICATE = 'A department with this name already exists';

/**
 * Departments, scoped to the caller's hospital.
 *
 * hospitalId always comes from TenantGuard and always appears in the WHERE clause
 * (docs/Rules.md 1.3). There is no fetch-then-check: another hospital's id simply
 * does not match, so it is a 404 and never confirms the row exists.
 */
@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(hospitalId: string, query: ConfigListQuery): Promise<Paginated<Department>> {
    const where = { hospitalId, ...(query.includeInactive ? {} : { isActive: true }) };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        orderBy: { name: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.department.count({ where }),
    ]);

    return { items: rows.map(toDto), total, limit: query.limit, offset: query.offset };
  }

  async create(hospitalId: string, input: CreateDepartmentRequest): Promise<Department> {
    const row = await mapPrismaErrors(
      () => this.prisma.department.create({ data: { hospitalId, name: input.name } }),
      { conflict: DUPLICATE },
    );
    return toDto(row);
  }

  async update(
    hospitalId: string,
    id: string,
    input: UpdateDepartmentRequest,
  ): Promise<Department> {
    // updateMany, not update: hospitalId has to be part of the WHERE, or an id from
    // another hospital would be edited by a caller who has no business with it.
    const { count } = await mapPrismaErrors(
      () =>
        this.prisma.department.updateMany({
          where: { id, hospitalId },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.isActive !== undefined && { isActive: input.isActive }),
          },
        }),
      { conflict: DUPLICATE },
    );
    if (count === 0) throw new NotFoundError('Department not found');

    return this.get(hospitalId, id);
  }

  async get(hospitalId: string, id: string): Promise<Department> {
    const row = await this.prisma.department.findFirst({ where: { id, hospitalId } });
    if (!row) throw new NotFoundError('Department not found');
    return toDto(row);
  }

  /**
   * DELETE deactivates. Doctors and sessions reference a department with
   * `onDelete: Restrict`, so a hard delete stops working the day the department is
   * first used and never works again - including for the case that actually
   * happens, a unit that closes. Phase 3 discovery filters on the same flag.
   */
  async deactivate(hospitalId: string, id: string): Promise<void> {
    const { count } = await this.prisma.department.updateMany({
      where: { id, hospitalId },
      data: { isActive: false },
    });
    if (count === 0) throw new NotFoundError('Department not found');
  }

  /** Used by other config services to prove a department belongs to this hospital. */
  async assertBelongs(hospitalId: string, departmentId: string): Promise<void> {
    const found = await this.prisma.department.findFirst({
      where: { id: departmentId, hospitalId },
      select: { id: true },
    });
    if (!found) throw new NotFoundError('Department not found');
  }
}
