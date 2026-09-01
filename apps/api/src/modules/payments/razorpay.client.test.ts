import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RazorpayClient } from './razorpay.client';
import { loadEnv } from '../../config/env';

/**
 * The webhook signature is the only thing standing between "Razorpay says this was
 * paid" and "anyone on the internet says this was paid". It gets its own test with
 * no database and no network, because it is pure and because every branch of it is a
 * way to be wrong.
 */

const SECRET = 'webhook-secret-for-tests';

const client = (overrides: Record<string, string> = {}) =>
  new RazorpayClient(
    loadEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_REFRESH_SECRET: 'y'.repeat(32),
      CHECKIN_SECRET: 'z'.repeat(32),
      RAZORPAY_KEY_ID: 'rzp_test_key',
      RAZORPAY_KEY_SECRET: 'api-secret',
      RAZORPAY_WEBHOOK_SECRET: SECRET,
      ...overrides,
    } as NodeJS.ProcessEnv),
  );

const sign = (body: Buffer, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('razorpay webhook signature (P5-BE-02)', () => {
  const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: {} }));

  it('accepts a signature computed over the raw body', () => {
    expect(client().verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(client().verifyWebhookSignature(body, sign(body, 'not-the-secret'))).toBe(false);
  });

  it('rejects a body that was altered after signing', () => {
    const signature = sign(body);
    const tampered = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { x: 1 } }));
    expect(client().verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  it('rejects a re-serialised body, which is the whole reason we need the raw bytes', () => {
    // This is the failure docs/Phases.md warns costs hours: Nest parses the body,
    // something re-stringifies it, and the digest no longer matches even though not
    // one value changed. Here the difference is only whitespace.
    const signature = sign(body);
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2));
    expect(reserialised.toString()).not.toBe(body.toString());
    expect(client().verifyWebhookSignature(reserialised, signature)).toBe(false);
  });

  it('rejects a missing, empty or malformed signature instead of throwing', () => {
    // timingSafeEqual throws on unequal lengths, so without the length guard each of
    // these would be a 500 - and a 500 makes Razorpay retry a forgery forever.
    for (const bad of [undefined, '', 'not-hex-at-all', 'ab', sign(body) + 'ff']) {
      expect(() => client().verifyWebhookSignature(body, bad)).not.toThrow();
      expect(client().verifyWebhookSignature(body, bad)).toBe(false);
    }
  });

  it('rejects everything when no webhook secret is configured', () => {
    // An unconfigured deployment must not be MORE permissive than a configured one.
    const unconfigured = client({ RAZORPAY_WEBHOOK_SECRET: '' });
    expect(unconfigured.configured).toBe(false);
    expect(unconfigured.verifyWebhookSignature(body, sign(body, ''))).toBe(false);
  });

  it('treats a half-configured environment as switched off', () => {
    // A key but no webhook secret means we could take money and never confirm it.
    expect(client({ RAZORPAY_WEBHOOK_SECRET: '' }).configured).toBe(false);
    expect(client({ RAZORPAY_KEY_SECRET: '' }).configured).toBe(false);
    expect(client({ RAZORPAY_KEY_ID: '' }).configured).toBe(false);
    expect(client().configured).toBe(true);
  });
});
