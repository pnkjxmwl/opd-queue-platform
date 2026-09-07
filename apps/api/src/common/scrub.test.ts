import { describe, expect, it } from 'vitest';
import { REDACTED, scrub, scrubText } from './scrub';

/**
 * P9-OBS-01 · the egress scrubber.
 *
 * Tested directly and thoroughly because its failure is silent and expensive: it
 * would keep working, reports would keep arriving, and patient names would be
 * sitting in a third party's database until somebody looked. There is no error to
 * notice.
 */
describe('scrub', () => {
  it('redacts a patient out of a realistic error payload', () => {
    const event = {
      request: {
        url: '/sessions/abc/walk-in',
        body: { name: 'Asha Semwal', phone: '+91 98765 43210', tokenLabel: 'B007' },
      },
      tags: { hospitalId: 'aaaa-1111' },
    };

    const out = scrub(event) as typeof event;
    expect(out.request.body.name).toBe(REDACTED);
    expect(out.request.body.phone).toBe(REDACTED);
    // Not personal, and the only things that make the report worth having.
    expect(out.request.body.tokenLabel).toBe('B007');
    expect(out.request.url).toBe('/sessions/abc/walk-in');
    expect(out.tags.hospitalId).toBe('aaaa-1111');
  });

  it('reaches PII nested deep inside a structure', () => {
    const out = scrub({ a: { b: { c: [{ patientName: 'Rohan', id: 7 }] } } }) as {
      a: { b: { c: { patientName: string; id: number }[] } };
    };
    expect(out.a.b.c[0]?.patientName).toBe(REDACTED);
    expect(out.a.b.c[0]?.id).toBe(7);
  });

  it('redacts credentials as well as identities', () => {
    const out = scrub({
      authorization: 'Bearer abc.def.ghi',
      cookie: 'session=1',
      password: 'hunter2',
      refreshToken: 'rt_live_x',
      razorpaySignature: 'deadbeef',
      CHECKIN_SECRET: 'shhh',
    }) as Record<string, string>;

    for (const key of Object.keys(out)) {
      expect(out[key], `${key} survived`).toBe(REDACTED);
    }
  });

  it('never mutates its input', () => {
    // The caller is usually holding the same object it is about to log locally in
    // full. Scrubbing in place would redact the very logs this exists to preserve.
    const original = { name: 'Asha Semwal', id: 1 };
    scrub(original);
    expect(original.name).toBe('Asha Semwal');
  });

  it('survives a cycle instead of hanging', () => {
    const a: Record<string, unknown> = { id: 1 };
    a.self = a;
    const out = scrub(a) as { id: number; self: string };
    expect(out.id).toBe(1);
    expect(out.self).toBe('[circular]');
  });

  it('caps depth rather than walking forever', () => {
    let deep: Record<string, unknown> = { bottom: 'value' };
    for (let i = 0; i < 30; i += 1) deep = { nested: deep };
    expect(JSON.stringify(scrub(deep))).toContain(REDACTED);
  });

  it('caps a huge array and says how much it dropped', () => {
    const out = scrub(Array.from({ length: 500 }, (_, i) => i)) as unknown[];
    expect(out.length).toBe(51);
    expect(out[50]).toBe('[450 more]');
  });

  it('keeps an Error usable', () => {
    const error = new Error('failed for asha@example.com');
    const out = scrub(error) as { name: string; message: string; stack?: string };
    expect(out.message).toBe(`failed for ${REDACTED}`);
    expect(out.stack).toBeTruthy();
  });

  it('leaves primitives alone', () => {
    expect(scrub('plain')).toBe('plain');
    expect(scrub(42)).toBe(42);
    expect(scrub(null)).toBe(null);
    expect(scrub(undefined)).toBe(undefined);
  });
});

describe('scrubText', () => {
  it('removes an email from free text', () => {
    expect(scrubText('no account for asha.s+test@example.co.in')).toBe(
      `no account for ${REDACTED}`,
    );
  });

  it('removes an Indian mobile number, written either way', () => {
    expect(scrubText('sms to +919876543210 failed')).toBe(`sms to ${REDACTED} failed`);
    expect(scrubText('sms to 9876543210 failed')).toBe(`sms to ${REDACTED} failed`);
  });

  it('leaves a token number alone', () => {
    // The reason this matches phone numbers by shape rather than "any long digits":
    // queue data is full of numbers that are not people.
    expect(scrubText('token B007 in session 12345')).toBe('token B007 in session 12345');
  });

  it('keeps the part of the message that explains the fault', () => {
    expect(scrubText('INVALID_QUEUE_TRANSITION: CHECKED_IN -> COMPLETED')).toBe(
      'INVALID_QUEUE_TRANSITION: CHECKED_IN -> COMPLETED',
    );
  });
});

/**
 * The shape this actually has to survive in production: a Sentry event.
 *
 * Written when the exporter was wired in Phase 10, because the first thing wiring it
 * revealed was that `filename` collides with `name` and every stack frame came back
 * redacted. A scrubber that removes the file a crash happened in is not protecting a
 * patient, it is just breaking the report.
 */
describe('a Sentry event survives with its stack, without its patients', () => {
  const event = () => ({
    event_id: 'abc123',
    exception: {
      values: [
        {
          type: 'TypeError',
          value: 'Cannot read properties of null',
          stacktrace: {
            frames: [
              {
                filename: '/app/dist/modules/queue/commands/call-next.js',
                module: 'queue/commands/call-next',
                function: 'callNext',
                lineno: 42,
              },
            ],
          },
        },
      ],
    },
    request: { url: '/sessions/x/call-next', headers: { authorization: 'Bearer abc' } },
    extra: { patient: { name: 'Asha Semwal', phone: '+919876543210' }, tokenLabel: 'A007' },
  });

  it('keeps what makes the crash findable', () => {
    const out = scrub(event()) as ReturnType<typeof event>;
    const frame = out.exception.values[0].stacktrace.frames[0];

    expect(frame.filename).toBe('/app/dist/modules/queue/commands/call-next.js');
    expect(frame.module).toBe('queue/commands/call-next');
    expect(frame.function).toBe('callNext');
    expect(frame.lineno).toBe(42);
    expect(out.exception.values[0].type).toBe('TypeError');
    // The queue token is the one identifier that makes a queue error legible.
    expect(out.extra.tokenLabel).toBe('A007');
  });

  it('removes the patient and the credential', () => {
    const out = scrub(event()) as ReturnType<typeof event>;

    expect(out.extra.patient.name).toBe(REDACTED);
    expect(out.extra.patient.phone).toBe(REDACTED);
    expect(out.request.headers.authorization).toBe(REDACTED);
  });
});
