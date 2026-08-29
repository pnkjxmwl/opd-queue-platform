import type { Request } from 'express';
import type { Role } from '@opd/contracts';

/** Claims carried in the access token. Kept small - a JWT is not a cache. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
}

export interface AuthedAccount {
  id: string;
  email: string;
}

/**
 * The hospital the current request acts within, resolved by TenantGuard from the
 * caller's membership - never from the request body (docs/Rules.md 1.3).
 */
export interface TenantContext {
  hospitalId: string;
  role: Role;
  permissions: string[];
}

export interface AuthedRequest extends Request {
  account?: AuthedAccount;
  tenant?: TenantContext;
}
