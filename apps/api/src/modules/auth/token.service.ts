import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthTokens } from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../../config/env';
import { UnauthorizedError } from '../../common/errors';

/** Refresh tokens are opaque random strings; only their hash is stored. */
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Start a new session (login/signup): a fresh token family. */
  async issue(account: { id: string; email: string }): Promise<AuthTokens> {
    return this.mint(account, randomUUID());
  }

  /**
   * Rotate a refresh token.
   *
   * Reuse detection: a token that exists but is already revoked has been replayed,
   * which means it leaked. Revoking only that row would leave the attacker's newer
   * token valid, so the entire family is revoked and both parties must log in again.
   */
  async rotate(presented: string): Promise<AuthTokens> {
    const tokenHash = hash(presented);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { account: { select: { id: true, email: true } } },
    });

    if (!existing) throw new UnauthorizedError('Invalid refresh token');
    if (existing.expiresAt <= new Date()) throw new UnauthorizedError('Refresh token expired');

    // Atomic claim: a single conditional UPDATE, so exactly one caller can consume a
    // given token. A read-then-write here would let two concurrent refreshes both
    // succeed - handing out two live sessions AND hiding genuine replay, because
    // neither would observe the other's revocation.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (claimed.count === 0) {
      // Already consumed - by an attacker replaying it, or by a racing client.
      // Either way the token is no longer exclusively held, so kill the family.
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedError('Refresh token reuse detected; session revoked');
    }

    return this.mint(existing.account, existing.familyId);
  }

  /** Log out: kill the whole family, not just the presented token. */
  async revoke(presented: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(presented) },
      select: { familyId: true },
    });
    // Unknown token: succeed anyway. Logout is idempotent and must not leak
    // whether a token was real.
    if (existing) await this.revokeFamily(existing.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async mint(
    account: { id: string; email: string },
    familyId: string,
  ): Promise<AuthTokens> {
    const config = env();

    const accessToken = await this.jwt.signAsync(
      { sub: account.id, email: account.email },
      { secret: config.JWT_ACCESS_SECRET, expiresIn: config.JWT_ACCESS_TTL_SEC },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        accountId: account.id,
        familyId,
        tokenHash: hash(refreshToken),
        expiresAt: new Date(Date.now() + config.JWT_REFRESH_TTL_SEC * 1000),
      },
    });

    return { accessToken, refreshToken, expiresIn: config.JWT_ACCESS_TTL_SEC };
  }
}
