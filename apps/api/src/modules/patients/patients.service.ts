import { Injectable } from '@nestjs/common';
import type { CreatePatientRequest, Patient, UpdatePatientRequest } from '@opd/contracts';
import type { Gender, PatientRelation } from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundError } from '../../common/errors';

type PatientRow = {
  id: string;
  name: string;
  dob: Date | null;
  gender: string | null;
  relation: string;
  createdAt: Date;
};

const toDto = (p: PatientRow): Patient => ({
  id: p.id,
  name: p.name,
  dob: p.dob?.toISOString() ?? null,
  gender: (p.gender as Gender | null) ?? null,
  relation: p.relation as PatientRelation,
  createdAt: p.createdAt.toISOString(),
});

/**
 * Family profiles, scoped to the owning account.
 *
 * Every method takes accountId and puts it in the WHERE clause. There is no
 * findById-then-check: an id belonging to another account simply does not match,
 * so a wrong id is a 404 and never leaks that the record exists (docs/Rules.md 1.3).
 */
@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(accountId: string): Promise<Patient[]> {
    const rows = await this.prisma.patient.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(accountId: string, input: CreatePatientRequest): Promise<Patient> {
    const row = await this.prisma.patient.create({
      data: {
        accountId,
        name: input.name,
        dob: input.dob ? new Date(input.dob) : null,
        gender: input.gender ?? null,
        relation: input.relation,
      },
    });
    return toDto(row);
  }

  async update(accountId: string, id: string, input: UpdatePatientRequest): Promise<Patient> {
    // updateMany (not update) so accountId is part of the WHERE - update-by-id
    // alone would edit another account's row.
    const { count } = await this.prisma.patient.updateMany({
      where: { id, accountId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.dob !== undefined && { dob: new Date(input.dob) }),
        ...(input.gender !== undefined && { gender: input.gender }),
        ...(input.relation !== undefined && { relation: input.relation }),
      },
    });
    if (count === 0) throw new NotFoundError('Patient not found');

    const row = await this.prisma.patient.findFirst({ where: { id, accountId } });
    if (!row) throw new NotFoundError('Patient not found');
    return toDto(row);
  }

  async remove(accountId: string, id: string): Promise<void> {
    const { count } = await this.prisma.patient.deleteMany({ where: { id, accountId } });
    if (count === 0) throw new NotFoundError('Patient not found');
  }
}
