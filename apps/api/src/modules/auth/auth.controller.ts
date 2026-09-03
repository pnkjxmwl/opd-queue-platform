import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AcceptInviteRequest,
  GoogleAuthRequest,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  SignupRequest,
  type AuthTokens,
  type MeResponse,
} from '@opd/contracts';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentAccount, Public } from '../../common/decorators';
import type { AuthedAccount } from '../../common/auth-context';

/**
 * Rate limiting here is deliberately per route, not per controller.
 *
 * The routes worth limiting are the ones where an attacker GUESSES: login and
 * accept-invite are credential stuffing, signup is account farming. Ten a minute per
 * IP is far more than a person mistyping a password and far less than a script is
 * worth running.
 *
 * `auth/refresh` is deliberately NOT among them, and that is a security judgement
 * rather than a convenience. A refresh token is a high-entropy secret, not a guess -
 * and the real defence is already stronger than counting requests: reuse revokes the
 * entire family (token.service.ts), so a stolen token is worth one attempt and then
 * kills itself. Throttling it would mostly punish a client with two tabs open, while
 * the global 120/min ceiling still stops a flood.
 */
const GUESSABLE = { default: { limit: 10, ttl: 60_000 } };

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Throttle(GUESSABLE)
  @Post('auth/signup')
  signup(@Body(new ZodBody(SignupRequest)) body: SignupRequest): Promise<AuthTokens> {
    return this.auth.signup(body);
  }

  @Public()
  @HttpCode(200)
  @Throttle(GUESSABLE)
  @Post('auth/login')
  login(@Body(new ZodBody(LoginRequest)) body: LoginRequest): Promise<AuthTokens> {
    return this.auth.login(body);
  }

  @Public()
  @HttpCode(200)
  @Throttle(GUESSABLE)
  @Post('auth/google')
  google(@Body(new ZodBody(GoogleAuthRequest)) body: GoogleAuthRequest): Promise<AuthTokens> {
    return this.auth.google(body);
  }

  /**
   * Public by necessity: an invitee has no account to authenticate with yet. The
   * token in the body is the only credential, which is why it is single-use and
   * expiring.
   */
  @Public()
  @HttpCode(200)
  @Throttle(GUESSABLE)
  @Post('auth/accept-invite')
  acceptInvite(
    @Body(new ZodBody(AcceptInviteRequest)) body: AcceptInviteRequest,
  ): Promise<AuthTokens> {
    return this.auth.acceptInvite(body);
  }

  @Public()
  @HttpCode(200)
  @Post('auth/refresh')
  refresh(@Body(new ZodBody(RefreshRequest)) body: RefreshRequest): Promise<AuthTokens> {
    return this.tokens.rotate(body.refreshToken);
  }

  /** Public: logging out must work even with an expired access token. */
  @Public()
  @HttpCode(204)
  @Post('auth/logout')
  async logout(@Body(new ZodBody(LogoutRequest)) body: LogoutRequest): Promise<void> {
    await this.tokens.revoke(body.refreshToken);
  }

  @Get('me')
  me(@CurrentAccount() account: AuthedAccount): Promise<MeResponse> {
    return this.auth.me(account.id);
  }
}
