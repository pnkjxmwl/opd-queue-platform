import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenError, TenantMismatchError, UnauthorizedError } from '../errors';
import type { AuthedRequest } from '../auth-context';
import type { Role } from '@opd/contracts';

/**
 * Resolves the tenant for any route carrying a :hospitalId parameter, by looking up
 * the caller's HospitalStaff membership (docs/Rules.md 1.3).
 *
 * Registered GLOBALLY and keyed off the route parameter, so every hospital-scoped
 * route added in any later phase is scoped automatically. There is no per-controller
 * decorator to forget - which is the failure mode that leaks another hospital's data.
 *
 * Routes with no :hospitalId are account-scoped and pass through untouched.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const hospitalId = (req.params as Record<string, string> | undefined)?.hospitalId;
    if (!hospitalId) return true;

    if (!req.account) throw new UnauthorizedError();

    const membership = await this.prisma.hospitalStaff.findUnique({
      where: { hospitalId_accountId: { hospitalId, accountId: req.account.id } },
      select: { role: true, permissions: true, status: true },
    });

    // Same answer for "no such hospital" and "not your hospital": a 404-vs-403
    // difference would let a caller enumerate which hospital ids exist.
    if (!membership) throw new TenantMismatchError();
    if (membership.status !== 'ACTIVE') throw new ForbiddenError('Membership is not active');

    req.tenant = {
      hospitalId,
      role: membership.role as Role,
      permissions: membership.permissions,
    };
    return true;
  }
}
