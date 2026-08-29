import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
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

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('auth/signup')
  signup(@Body(new ZodBody(SignupRequest)) body: SignupRequest): Promise<AuthTokens> {
    return this.auth.signup(body);
  }

  @Public()
  @HttpCode(200)
  @Post('auth/login')
  login(@Body(new ZodBody(LoginRequest)) body: LoginRequest): Promise<AuthTokens> {
    return this.auth.login(body);
  }

  @Public()
  @HttpCode(200)
  @Post('auth/google')
  google(@Body(new ZodBody(GoogleAuthRequest)) body: GoogleAuthRequest): Promise<AuthTokens> {
    return this.auth.google(body);
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
