import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { env } from '../../config/env';
import { IS_PUBLIC } from '../decorators';
import { UnauthorizedError } from '../errors';
import type { AccessTokenClaims, AuthedRequest } from '../auth-context';

/**
 * Authenticates every request. Registered globally - routes opt OUT with @Public(),
 * so a new route is protected by default rather than by remembering to guard it.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();

    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(header.slice(7), {
        secret: env().JWT_ACCESS_SECRET,
      });
      req.account = { id: claims.sub, email: claims.email };
      return true;
    } catch {
      // Expired, tampered or signed with the refresh secret - all the same to a caller.
      throw new UnauthorizedError();
    }
  }
}
