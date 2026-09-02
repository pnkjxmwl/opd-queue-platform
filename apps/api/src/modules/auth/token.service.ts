import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

    /**
     * The claim, the mint and the family revocation all happen under ONE lock on the
     * family, because the three of them interleave badly without it.
     *
     * **The bug this fixes**, found by CI on a build that had nothing to do with
     * auth, and reproducible only under real concurrency:
     *
     *   1. the winner claims the presented token (marks it revoked)
     *   2. the loser's claim fails, so it revokes every unrevoked row in the family -
     *      which at that instant is none, because...
     *   3. ...the winner now inserts its NEW token
     *
     * The replay was detected and announced, and the new token survived it anyway.
     * "Reuse detected, everyone logs in again" is the entire security value of a
     * token family, and that ordering quietly withdrew it.
     *
     * `SELECT ... FOR UPDATE` on the family is the same instrument, and the same
     * documented exception to "no raw SQL" (docs/Rules.md 2), that serialises two
     * receptionists pressing Call next. Both paths take it first, so the loser's
     * revocation cannot land in the gap between the winner's claim and its insert.
     */
    const rotated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "RefreshToken" WHERE "familyId" = ${existing.familyId} FOR UPDATE
      `;

      // Atomic claim: a single conditional UPDATE, so exactly one caller can consume
      // a given token. A read-then-write here would let two concurrent refreshes both
      // succeed - handing out two live sessions AND hiding genuine replay, because
      // neither would observe the other's revocation.
      const claimed = await tx.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Already consumed - by an attacker replaying it, or by a racing client. The
      // family has to die, but NOT in here: throwing inside the transaction would
      // roll the revocation back with everything else, and the replay would be
      // announced while every token it was meant to kill stayed alive. (It did
      // exactly that for one run, which is why this is spelled out.)
      if (claimed.count === 0) return null;

      return this.mint(existing.account, existing.familyId, tx);
    });

    if (rotated === null) {
      // Outside the transaction, and correct precisely because the lock above is
      // what orders these: the loser waited for the winner to COMMIT before it could
      // claim, so the winner's new token exists by now and is revoked with the rest.
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedError('Refresh token reuse detected; session revoked');
    }

    return rotated;
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
    /** The rotation's transaction, so the new token lands under the family lock. */
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<AuthTokens> {
    const config = env();

    const accessToken = await this.jwt.signAsync(
      { sub: account.id, email: account.email },
      { secret: config.JWT_ACCESS_SECRET, expiresIn: config.JWT_ACCESS_TTL_SEC },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    await client.refreshToken.create({
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
