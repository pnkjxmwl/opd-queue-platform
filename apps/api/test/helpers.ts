import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { CurrentHospital, Roles } from '../src/common/decorators';
import type { TenantContext } from '../src/common/auth-context';

/**
 * A route that exists only in tests, so the global TenantGuard can be exercised
 * before Phase 2 introduces real hospital-scoped endpoints. It deliberately echoes
 * the resolved tenant: if the guard ever failed open, this would return another
 * hospital's context and the test would catch it.
 */
@Controller('hospitals/:hospitalId')
class TenantProbeController {
  @Get('probe')
  probe(@CurrentHospital() tenant?: TenantContext) {
    return tenant ?? null;
  }

  @Roles('ADMIN')
  @Get('admin-only')
  adminOnly(@CurrentHospital() tenant?: TenantContext) {
    return tenant ?? null;
  }
}

@Module({ imports: [AppModule], controllers: [TenantProbeController] })
class TestAppModule {}

export async function createTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/**
 * Wipes every table between tests.
 *
 * ponytail: runs against the DEVELOPMENT database rather than a dedicated test one.
 * Local dev data is regenerable (`prisma migrate reset && pnpm seed`) so the cost of
 * losing it is a re-seed. Give the suite its own database once seed data becomes
 * expensive to rebuild. The guard below is what keeps that shortcut from being
 * catastrophic instead of merely annoying.
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  const isLocal = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
  if (process.env.NODE_ENV === 'production' || !isLocal) {
    throw new Error(`Refusing to TRUNCATE a non-local database: ${url.replace(/:[^:@]*@/, ':***@')}`);
  }

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "RefreshToken", "Patient", "HospitalStaff", "Doctor",
                   "Department", "Hospital", "Account"
    RESTART IDENTITY CASCADE
  `);
}

/** Signs up an account and returns its tokens plus id. */
export async function signup(
  app: INestApplication,
  email: string,
  password = 'correct-horse-battery',
): Promise<{ accountId: string; accessToken: string; refreshToken: string }> {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password })
    .expect(201);

  const me = await request(app.getHttpServer())
    .get('/me')
    .set('Authorization', `Bearer ${res.body.accessToken}`)
    .expect(200);

  return {
    accountId: me.body.id,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
export { request };
