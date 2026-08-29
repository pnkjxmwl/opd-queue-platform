import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '@opd/contracts';
import type { AuthedRequest, TenantContext } from '../auth-context';

/** Opt a route out of JwtGuard. Greppable on purpose - every use is a decision. */
export const IS_PUBLIC = 'auth:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route to specific hospital roles. Implies a tenant-scoped route. */
export const ROLES = 'auth:roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** The authenticated account. Never trust an id from the body/query instead of this. */
export const CurrentAccount = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().account;
});

/** The resolved tenant (hospital + role), set by TenantGuard. */
export const CurrentHospital = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext | undefined => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().tenant;
  },
);

export type { Request };
