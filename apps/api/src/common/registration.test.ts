import { describe, expect, it } from 'vitest';
import { registrationGate, type RegistrationGateInput } from './registration';

/**
 * docs/PRD.md 8.12 - four independent mechanisms, ANDed.
 *
 * Pure, so every combination is testable without a database. The point of the tests
 * below is not that each limit works in isolation but that they are ANDed: a
 * hospital that sets a token cap must not thereby lose the clock cutoff, which is
 * the failure `packages/contracts` warns about in the QueuePolicy comment.
 */

const NOW = new Date('2026-08-31T10:00:00.000Z');

const input = (overrides: Partial<RegistrationGateInput> = {}): RegistrationGateInput => ({
  status: 'OPEN_FOR_REGISTRATION',
  registrationClosedAt: null,
  scheduledEnd: new Date('2026-08-31T13:00:00.000Z'),
  policy: { cutoffMinsBeforeEnd: null, maxOnlineTokens: null },
  onlineTokensHeld: 0,
  now: NOW,
  ...overrides,
});

describe('registration gate (docs/PRD.md 8.12)', () => {
  it('is open for a session that is taking bookings', () => {
    expect(registrationGate(input())).toEqual({ open: true, reason: null });
  });

  it('stays open once the doctor has started seeing people', () => {
    // The first call-next makes a session ACTIVE. Closing here would shut every
    // clinic the moment it opened its doors.
    expect(registrationGate(input({ status: 'ACTIVE' })).open).toBe(true);
  });

  it('is closed for a session that never opened or has finished', () => {
    for (const status of ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'ENDED_EARLY'] as const) {
      expect(registrationGate(input({ status })), status).toEqual({
        open: false,
        reason: 'SESSION_NOT_OPEN',
      });
    }
  });

  it('respects a manual close by staff', () => {
    expect(registrationGate(input({ registrationClosedAt: NOW })).reason).toBe('MANUALLY_CLOSED');
  });

  it('closes once the session end has passed', () => {
    expect(registrationGate(input({ scheduledEnd: NOW })).reason).toBe('SESSION_ENDED');
  });

  it('closes N minutes before the end, and not a minute earlier', () => {
    // Ends 13:00, cutoff 60 minutes: open at 11:59, closed from 12:00.
    const at = (iso: string) =>
      registrationGate(input({ now: new Date(iso), policy: { cutoffMinsBeforeEnd: 60, maxOnlineTokens: null } }));

    expect(at('2026-08-31T11:59:59.000Z').open).toBe(true);
    expect(at('2026-08-31T12:00:00.000Z')).toEqual({ open: false, reason: 'PAST_CUTOFF' });
  });

  it('closes at the token cap, and not one booking earlier', () => {
    const held = (n: number) =>
      registrationGate(input({ onlineTokensHeld: n, policy: { cutoffMinsBeforeEnd: null, maxOnlineTokens: 3 } }));

    expect(held(2).open).toBe(true);
    expect(held(3)).toEqual({ open: false, reason: 'TOKEN_CAP_REACHED' });
    // Above the cap too - a cap reached by a race must not reopen.
    expect(held(4).open).toBe(false);
  });

  it('ANDs the limits instead of choosing between them', () => {
    // A hospital that sets a token cap must NOT thereby lose the clock cutoff.
    const both = { cutoffMinsBeforeEnd: 60, maxOnlineTokens: 3 };
    expect(registrationGate(input({ policy: both, onlineTokensHeld: 0 })).open).toBe(true);
    expect(registrationGate(input({ policy: both, onlineTokensHeld: 3 })).open).toBe(false);
    expect(
      registrationGate(input({ policy: both, now: new Date('2026-08-31T12:30:00.000Z') })).open,
    ).toBe(false);
  });

  it('is inert on the Phase 7 term until Phase 7 sets it', () => {
    // etaOverrun is absent everywhere today, so it can only ever make the gate
    // stricter later - never accidentally permissive now.
    expect(registrationGate(input({ etaOverrun: undefined })).open).toBe(true);
    expect(registrationGate(input({ etaOverrun: false })).open).toBe(true);
    expect(registrationGate(input({ etaOverrun: true })).open).toBe(false);
  });
});
