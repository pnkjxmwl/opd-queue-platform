import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { env } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { EtaModule } from './modules/eta/eta.module';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ConfigModule } from './modules/config/config.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { StaffModule } from './modules/staff/staff.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { QueueModule } from './modules/queue/queue.module';
import { PaymentsModule } from './modules/payments/payments.module';
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
    QueueModule,
    PaymentsModule,
    EtaModule,
    RealtimeModule,
    NotificationsModule,
    /**
     * A generous global ceiling, tightened per route where abuse is cheap.
     *
     * 120/minute is well above anything a receptionist working a queue produces -
     * the console polls and holds a socket rather than hammering REST - so this
     * catches scripts, not staff. The routes that actually need defending
     * (`auth/*`, join) carry their own `@Throttle`, and the Razorpay webhook is
     * exempt entirely.
     *
     * ponytail: in-memory storage, so limits are per process. Redis is already a
     * dependency and `ThrottlerStorageRedisService` would make them cluster-wide;
     * that matters only once more than one API instance runs, which is a Phase 10
     * decision. Until then this is enforcement, not decoration - there is one
     * process.
     */
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  // Registered through DI, not app.useGlobalFilters(): nestjs-pino's PinoLogger
  // is transient-scoped and cannot be resolved with app.get().
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Rate limiting runs BEFORE authentication, deliberately: the attack it defends
    // against is credential stuffing, where every request is unauthenticated by
    // definition. A limiter behind the JwtGuard would only ever throttle people who
    // had already logged in.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
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
