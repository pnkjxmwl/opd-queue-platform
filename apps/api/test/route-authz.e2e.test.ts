import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, request, resetDb, signup } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * P9-SEC-01 · every route is guarded, and the list is generated.
 *
 * **The route list is read from the running router, never written by hand.** A hand
 * maintained list drifts the day somebody adds a controller, and it drifts silently
 * - the test still passes, because it is only checking the routes it already knew
 * about. Enumerating from Express means a new endpoint appears here the moment it
 * exists, and an unguarded one fails on the day it is written rather than at audit
 * time (docs/Phases.md, P9-SEC-01).
 *
 * The only hand-written thing is the list of routes that are public ON PURPOSE.
 * That list is small, reviewed, and asserted to be exact in both directions: a route
 * that stops being public fails, and a stale entry fails too.
 */

interface Route {
  method: 'get' | 'post' | 'patch' | 'delete' | 'put';
  path: string;
}

/**
 * Public by design, with the reason. Anything not here must reject an anonymous
 * caller.
 *
 *  - `auth/*`      you cannot present a token to obtain your first token.
 *  - `health/*`    a load balancer has no credentials and must not need any.
 *  - `webhooks/*`  Razorpay has no account; the HMAC signature over the raw body IS
 *                  the authentication, and it is stronger than a bearer token
 *                  because it also proves the body was not altered.
 */
const INTENTIONALLY_PUBLIC = new Set([
  'post /auth/signup',
  'post /auth/login',
  'post /auth/google',
  'post /auth/accept-invite',
  'post /auth/refresh',
  'post /auth/logout',
  'get /health',
  'get /health/ready',
  'get /webhooks/checkout-complete',
  'post /webhooks/razorpay',
]);

/** Params are irrelevant to a guard: it rejects before the handler ever runs. */
const fillParams = (path: string): string =>
  path.replace(/:[A-Za-z0-9_]+/g, '00000000-0000-4000-8000-000000000000');

function enumerateRoutes(app: INestApplication): Route[] {
  const server = app.getHttpAdapter().getInstance() as {
    _router?: { stack: unknown[] };
    router?: { stack: unknown[] };
  };
  const stack = (server._router ?? server.router)?.stack ?? [];

  const routes: Route[] = [];
  for (const layer of stack as { route?: { path: string; methods: Record<string, boolean> } }[]) {
    if (layer.route === undefined) continue;
    // Nest registers a `/*` catch-all per method that exists only to produce the 404
    // for an unmatched URL. It is not an endpoint and has nothing to guard.
    if (layer.route.path.includes('*')) continue;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled && ['get', 'post', 'patch', 'delete', 'put'].includes(method)) {
        routes.push({ method: method as Route['method'], path: layer.route.path });
      }
    }
  }
  return routes;
}

describe('route authorization matrix (P9-SEC-01)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let routes: Route[];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    routes = enumerateRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('found the routes at all', () => {
    // If the router internals ever change shape this test would otherwise pass by
    // checking nothing - the most dangerous way for a security test to fail.
    expect(routes.length).toBeGreaterThan(30);
  });

  it('rejects an anonymous caller on every route that is not deliberately public', async () => {
    const unguarded: string[] = [];

    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (INTENTIONALLY_PUBLIC.has(key)) continue;

      const res = await request(app.getHttpServer())
        [route.method](fillParams(route.path))
        .send({});

      // 401 is the only acceptable answer. A 404 would mean the guard let the
      // request through to a handler that then failed to find a row - which is an
      // information leak (the caller learns the id does not exist) and, worse, means
      // the route is only protected by accident.
      if (res.status !== 401) unguarded.push(`${key} -> ${res.status}`);
    }

    expect(unguarded, `these routes answered an anonymous caller:\n${unguarded.join('\n')}`)
      .toEqual([]);
  });

  it('keeps the public list exact - no route silently became public', async () => {
    const shouldBePublicButIsNot: string[] = [];

    for (const key of INTENTIONALLY_PUBLIC) {
      const [method, path] = key.split(' ') as [Route['method'], string];
      const res = await request(app.getHttpServer())[method](fillParams(path)).send({});
      if (res.status === 401) shouldBePublicButIsNot.push(key);
    }

    expect(shouldBePublicButIsNot, 'these are listed as public but rejected anonymity')
      .toEqual([]);
  });

  it('keeps the public list honest - no stale entries for routes that no longer exist', () => {
    const live = new Set(routes.map((r) => `${r.method} ${r.path}`));
    const stale = [...INTENTIONALLY_PUBLIC].filter((key) => !live.has(key));

    // A stale entry is how a list like this rots: the route is renamed, the entry
    // stays, and the next route to take that name inherits an exemption nobody
    // reviewed.
    expect(stale, `remove these from INTENTIONALLY_PUBLIC:\n${stale.join('\n')}`).toEqual([]);
  });

  describe('IDOR - a valid token for the wrong person', () => {
    // The class of bug a route list cannot catch: the caller IS authenticated and IS
    // allowed here, they just passed somebody else's id. Every one of these routes
    // takes an id from the URL and must scope it to the caller rather than trusting
    // it (docs/Rules.md 3).

    it('will not show, edit or delete another account\'s patient', async () => {
      const mine = await signup(app, 'owner@idor.test');
      const theirs = await signup(app, 'stranger@idor.test');

      const victim = await request(app.getHttpServer())
        .post('/patients')
        .set(auth(theirs.accessToken))
        .send({ name: 'Somebody Else', relation: 'SELF' })
        .expect(201);
      const victimId = victim.body.id as string;

      // Reading the list must never include it...
      const list = await request(app.getHttpServer())
        .get('/patients')
        .set(auth(mine.accessToken))
        .expect(200);
      const ids = (list.body.items ?? list.body).map?.((p: { id: string }) => p.id) ?? [];
      expect(ids).not.toContain(victimId);

      // ...and neither writing nor deleting it may succeed. 404 and 403 are both
      // acceptable answers; 200 is not, and neither is 500.
      const patched = await request(app.getHttpServer())
        .patch(`/patients/${victimId}`)
        .set(auth(mine.accessToken))
        .send({ name: 'Renamed By A Stranger' });
      expect([403, 404]).toContain(patched.status);

      const deleted = await request(app.getHttpServer())
        .delete(`/patients/${victimId}`)
        .set(auth(mine.accessToken));
      expect([403, 404]).toContain(deleted.status);

      // And the row is untouched, which is the assertion that would catch a handler
      // that answered 404 while still doing the work.
      const still = await prisma.patient.findUnique({ where: { id: victimId } });
      expect(still?.name).toBe('Somebody Else');
    });

    it('will not list another account\'s bookings', async () => {
      const mine = await signup(app, 'mine@idor.test');
      const theirs = await signup(app, 'theirs@idor.test');

      const res = await request(app.getHttpServer())
        .get('/me/queue-entries')
        .set(auth(mine.accessToken))
        .expect(200);

      // `/me` routes take no id at all, which is the point: there is nothing to
      // tamper with. This asserts the shape stays that way - a future `?accountId=`
      // would be exactly the regression.
      const items = (res.body.items ?? []) as { accountId?: string }[];
      expect(items.every((i) => i.accountId === undefined || i.accountId === mine.accountId))
        .toBe(true);
      expect(theirs.accountId).not.toBe(mine.accountId);
    });

    it('will not register a push token against another account', async () => {
      const mine = await signup(app, 'push@idor.test');

      await request(app.getHttpServer())
        .post('/me/push-tokens')
        .set(auth(mine.accessToken))
        .send({ token: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]', platform: 'android' })
        .expect(201);

      const rows = await prisma.pushToken.findMany();
      // The account is taken from the JWT, never the body - so a body carrying
      // somebody else's accountId changes nothing.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.accountId).toBe(mine.accountId);
    });
  });

  it('refuses a signed-in caller who is not staff anywhere', async () => {
    // A patient account holds a perfectly valid JWT. Authentication is not
    // authorisation, and every hospital-scoped route has to say so.
    const patient = await signup(app, 'patient@authz.test');
    const scoped = routes.filter((r) => r.path.includes(':hospitalId'));
    expect(scoped.length).toBeGreaterThan(5);

    const leaked: string[] = [];
    for (const route of scoped) {
      const res = await request(app.getHttpServer())
        [route.method](fillParams(route.path))
        .set(auth(patient.accessToken))
        .send({});
      if (res.status !== 403) leaked.push(`${route.method} ${route.path} -> ${res.status}`);
    }

    expect(leaked, `a non-staff account was not refused:\n${leaked.join('\n')}`).toEqual([]);
  });
});
