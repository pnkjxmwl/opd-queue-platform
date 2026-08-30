import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { InviteStaffRequest, Role, StaffInvite, StaffStatus } from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { ConflictError, ValidationFailedError } from '../../common/errors';
import { isUniqueViolation } from '../../common/prisma-errors';
import { DoctorsService } from '../config/doctors.service';

/** Seven days. Long enough for a hospital to pass it on, short enough to expire. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Staff invitations. PRD 14: doctors and staff are admin-invited, never self-signup.
 *
 * An invited person gets an Account with NO passwordHash - the column is nullable
 * precisely so an identity can exist before a credential does - plus a HospitalStaff
 * membership in INVITED state carrying a single-use token. Authority lives on the
 * membership, never on the account.
 *
 * The token is what makes the invitation safe. Without it the only way to claim an
 * invited account would be to sign up with its email, which would let anyone who
 * guesses `dr.sharma@hospital.in` take a DOCTOR role in that hospital.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly doctors: DoctorsService,
  ) {}

  async invite(hospitalId: string, input: InviteStaffRequest): Promise<StaffInvite> {
    // Validate the doctor link BEFORE creating anything, so the failure case leaves
    // no half-built invitation behind.
    if (input.role === 'DOCTOR') {
      const doctor = await this.doctors.requireForHospital(hospitalId, input.doctorId!);
      if (!doctor.isActive) {
        throw new ValidationFailedError('Doctor is not active', { doctorId: 'inactive' });
      }
      if (doctor.accountId !== null) {
        throw new ConflictError('This doctor already has a login');
      }
    }

    const token = randomBytes(32).toString('base64url');
    const inviteTokenHash = hashInviteToken(token);
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

    try {
      const membership = await this.prisma.$transaction(async (tx) => {
        // The account may already exist - a patient being made staff, or a doctor at
        // a second hospital. Never touch its password: an invite is not a reset.
        const account = await tx.account.upsert({
          where: { email: input.email },
          update: {},
          create: { email: input.email },
        });

        const existing = await tx.hospitalStaff.findUnique({
          where: { hospitalId_accountId: { hospitalId, accountId: account.id } },
          select: { id: true, status: true },
        });

        // Re-inviting someone whose invitation is still outstanding replaces the
        // token rather than failing: an invite gets lost or expires, and the
        // alternative is an admin with no way to resend one.
        if (existing && existing.status !== 'INVITED') {
          throw new ConflictError('This person is already a member of this hospital');
        }

        const row = existing
          ? await tx.hospitalStaff.update({
              where: { id: existing.id },
              data: { role: input.role, inviteTokenHash, inviteExpiresAt },
            })
          : await tx.hospitalStaff.create({
              data: {
                hospitalId,
                accountId: account.id,
                role: input.role,
                status: 'INVITED',
                inviteTokenHash,
                inviteExpiresAt,
              },
            });

        if (input.role === 'DOCTOR') {
          // Written through the owning service, inside this transaction, so a
          // membership never exists without its doctor link.
          await this.doctors.linkAccount(hospitalId, input.doctorId!, account.id, tx);
        }

        return { row, email: account.email, accountId: account.id };
      });

      return {
        id: membership.row.id,
        accountId: membership.accountId,
        email: membership.email,
        role: membership.row.role as Role,
        status: membership.row.status as StaffStatus,
        doctorId: input.role === 'DOCTOR' ? input.doctorId! : null,
        createdAt: membership.row.createdAt.toISOString(),
        // Returned once and never retrievable again - only its hash is stored.
        inviteToken: token,
        inviteExpiresAt: inviteExpiresAt.toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('This person is already a member of this hospital');
      }
      throw error;
    }
  }

  /**
   * Resolve an outstanding invitation from its token, or null if it is unusable for
   * any reason. The caller must not learn WHICH reason - see AuthService.acceptInvite.
   *
   * This module owns HospitalStaff, so the auth module asks rather than reading the
   * table itself (docs/CLAUDE.md 3).
   */
  async findOpenInvitation(
    token: string,
  ): Promise<{ membershipId: string; accountId: string } | null> {
    const row = await this.prisma.hospitalStaff.findUnique({
      where: { inviteTokenHash: hashInviteToken(token) },
      select: { id: true, status: true, inviteExpiresAt: true, accountId: true },
    });

    if (!row || row.status !== 'INVITED') return null;
    if (!row.inviteExpiresAt || row.inviteExpiresAt.getTime() < Date.now()) return null;

    return { membershipId: row.id, accountId: row.accountId };
  }

  /**
   * Activate the membership and burn the token, atomically. Returns false when
   * another request got there first.
   *
   * The status and token are part of the WHERE, not just checked beforehand: two
   * simultaneous accepts of the same token both pass `findOpenInvitation`, and only
   * one can win this update.
   */
  async consumeInvitation(
    membershipId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const { count } = await client.hospitalStaff.updateMany({
      where: { id: membershipId, status: 'INVITED', inviteTokenHash: { not: null } },
      data: { status: 'ACTIVE', inviteTokenHash: null, inviteExpiresAt: null },
    });
    return count > 0;
  }
}
