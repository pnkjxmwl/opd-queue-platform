import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { env } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ConfigModule } from './modules/config/config.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { StaffModule } from './modules/staff/staff.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { JwtGuard } from './common/guards/jwt.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env().LOG_LEVEL,
        genReqId: (req, res) => {
          const existing = req.headers['x-request-id'];
          const id = typeof existing === 'string' && existing ? existing : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        // Readable in dev, structured JSON everywhere else.
        transport:
          env().NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
            : undefined,
        // docs/Rules.md 10: never log credentials or tokens.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.passwordHash',
          ],
          remove: true,
        },
        // /health is polled constantly - do not fill the log with it.
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    PatientsModule,
    ConfigModule,
    SessionsModule,
    StaffModule,
    DiscoveryModule,
  ],
  // Registered through DI, not app.useGlobalFilters(): nestjs-pino's PinoLogger
  // is transient-scoped and cannot be resolved with app.get().
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters and is the order listed here: authenticate, then resolve the
    // hospital from membership, then check the role within it. All three are global
    // so a new route is protected by default - JwtGuard opts out via @Public(), and
    // TenantGuard only engages on routes carrying a :hospitalId param.
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
