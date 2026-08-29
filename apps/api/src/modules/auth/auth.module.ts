import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Module({
  // global: JwtGuard is registered app-wide in AppModule, so JwtService must be
  // resolvable from that context, not just inside this module.
  // No default secret: access and refresh are signed with different ones, passed
  // per sign/verify call.
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [TokenService],
})
export class AuthModule {}
