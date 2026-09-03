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

/**
 * `overrides` swaps a provider for a fake - used by the payment tests to stand in
 * for Razorpay. Nothing else may be faked: the database, the guards and the queue
 * engine are all real, because they are what the tests are actually about.
 */
export async function createTestApp(
  overrides: { provide: unknown; useValue: unknown }[] = [],
): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  let builder = Test.createTestingModule({ imports: [TestAppModule] });
  for (const override of overrides) {
    builder = builder.overrideProvider(override.provide).useValue(override.useValue);
  }
  const moduleRef = await builder.compile();
  // rawBody: true to match main.ts - without it the webhook signature test would
  // exercise a code path that does not exist in production.
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/**
 * Wipes every table between tests.
 *
 * Runs against a dedicated `<database>_test`, which `test/use-test-database.ts`
 * selects and `test/global-setup.ts` creates. It used to run against the DEVELOPMENT
 * database on the reasoning that local dev data is regenerable, so losing it cost a
 * re-seed - true when the seed was two hospitals and no queue, and false once it
 * became six hospitals, a mid-clinic queue and a registered push token. The suite
 * destroyed a working test environment twice in one day before this changed
 * (docs/PROGRESS.md 2026-09-03).
 *
 * Three guards, because this statement is irreversible and the cost of getting it
 * wrong is somebody's real data: not production, not remote, and not a database
 * whose name does not end in `_test`. The last one is the one that matters now -
 * the first two were both true of the dev database it kept wiping.
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  const safe = url.replace(/:[^:@]*@/, ':***@');
  const isLocal = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
  if (process.env.NODE_ENV === 'production' || !isLocal) {
    throw new Error(`Refusing to TRUNCATE a non-local database: ${safe}`);
  }

  const name = url === '' ? '' : new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to TRUNCATE "${name}": the suite only ever runs against a *_test ` +
        `database. Something bypassed test/use-test-database.ts. (${safe})`,
    );
  }

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "RefreshToken", "Patient", "OPDSession", "DoctorSchedule",
                   "QueuePolicy", "HospitalStaff", "Doctor", "Department",
                   "Hospital", "Account"
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
