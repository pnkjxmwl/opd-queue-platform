import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES } from '../decorators';
import { ForbiddenError } from '../errors';
import type { AuthedRequest } from '../auth-context';
import type { Role } from '@opd/contracts';

/**
 * Enforces @Roles(...) against the tenant resolved by TenantGuard.
 * Runs AFTER TenantGuard - a role only means anything inside a hospital.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    // @Roles() on a route with no :hospitalId is a wiring bug, not a permission failure.
    if (!req.tenant) throw new ForbiddenError('Route requires a hospital context');

    if (!required.includes(req.tenant.role)) throw new ForbiddenError();
    return true;
  }
}
