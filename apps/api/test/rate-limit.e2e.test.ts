import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, request, resetDb } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * P9-BE-01 · rate limiting.
 *
 * Two things are being proven, and the second matters more than the first:
 *
 *   1. an abusive caller is cut off with 429 in the standard error envelope;
 *   2. the Razorpay webhook is NEVER cut off, however many times it is replayed.
 *
 * docs/Phases.md calls the second out by name as the way this task goes wrong:
 * throttling the webhook drops legitimate retries and silently loses payments that
 * have already been taken from a patient. A limiter that is merely "on everywhere"
 * would pass a naive test and fail a hospital.
 */
describe('rate limiting (P9-BE-01)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  const login = () =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@example.test', password: 'wrong-password-here' });

  it('cuts off credential guessing with 429', async () => {
    // The auth controller allows ten a minute. Eleven attempts must not all be
    // answered - each unthrottled one is a free guess.
    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await login();
      codes.push(res.status);
    }

    expect(codes).toContain(429);
    // The early ones must still have been served: a limiter that rejects the first
    // attempt has broken login rather than protected it.
    expect(codes[0]).not.toBe(429);
  });

  it('answers with the standard error envelope, not a bare framework message', async () => {
    let body: { error?: { code?: string; message?: string } } = {};
    for (let i = 0; i < 12; i += 1) {
      const res = await login();
      if (res.status === 429) {
        body = res.body as typeof body;
        break;
      }
    }

    // RATE_LIMITED, not VALIDATION_FAILED. A client told its request was invalid
    // will "fix" it and retry immediately, which is the opposite of what 429 asks
    // for - and every surface matches on the code, never the message
    // (docs/Rules.md 7).
    expect(body.error?.code).toBe('RATE_LIMITED');
    expect(body.error?.message).toMatch(/too many requests/i);
  });

  it('NEVER throttles the Razorpay webhook, however hard it retries', async () => {
    // The failure this test exists to prevent: Razorpay retries a webhook it thinks
    // failed. A 429 reads as a failure, so it retries harder, then gives up - and a
    // payment already taken from a patient never becomes a token.
    //
    // 130 replays - past the GLOBAL ceiling of 120/min, which is the only count that
    // actually exercises the exemption. An earlier version of this test sent twenty
    // and passed with @SkipThrottle deleted, proving nothing: twenty never reaches
    // any limit. Signature verification rejects them (4xx), which is the correct
    // gate; what must never appear is 429.
    const statuses: number[] = [];
    for (let i = 0; i < 130; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/webhooks/razorpay')
        .set('x-razorpay-signature', 'not-a-valid-signature')
        .send({ event: 'payment.captured', payload: {} });
      statuses.push(res.status);
    }

    expect(statuses).not.toContain(429);
    // And they were genuinely processed and rejected on their merits, not silently
    // swallowed by some earlier guard.
    expect(statuses.every((s) => s >= 400 && s < 500)).toBe(true);
  });

  it('leaves an authenticated console alone under normal use', async () => {
    // Staff working a queue must never meet a limiter. Thirty reads of a public
    // discovery route in a burst is more than a console produces and well under the
    // global ceiling.
    const statuses = await Promise.all(
      Array.from({ length: 30 }, () => request(app.getHttpServer()).get('/cities').then((r) => r.status)),
    );
    expect(statuses).not.toContain(429);
  });
});
