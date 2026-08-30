import { z } from 'zod';
import { Role, StaffStatus } from '../enums/staff';

export const Email = z.string().trim().toLowerCase().email();

/**
 * Minimum password policy. Deliberately length-based rather than a character-class
 * rule: length is what actually resists guessing, and composition rules push users
 * toward predictable substitutions.
 */
export const Password = z.string().min(10).max(200);

export const SignupRequest = z.object({
  email: Email,
  password: Password,
  /** Optional: creates the account holder's own patient profile in the same call. */
  name: z.string().trim().min(1).max(120).optional(),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** The client obtains a Google ID token natively, then exchanges it here. */
export const GoogleAuthRequest = z.object({
  idToken: z.string().min(1),
});
export type GoogleAuthRequest = z.infer<typeof GoogleAuthRequest>;

/**
 * Accepting a staff invitation.
 *
 * The token is the proof the invitation reached the intended person, which is why
 * an invited account cannot simply be claimed by signing up with its email - that
 * would let anyone who guesses an invited address take a role in that hospital.
 *
 * The password is set only if the account has none. An existing user invited to a
 * second hospital keeps the password they already have; accepting only activates
 * the new membership.
 */
export const AcceptInviteRequest = z.object({
  token: z.string().min(1),
  password: Password,
});
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequest>;

export const RefreshRequest = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const LogoutRequest = RefreshRequest;
export type LogoutRequest = z.infer<typeof LogoutRequest>;

export const AuthTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof AuthTokens>;

export const HospitalMembership = z.object({
  hospitalId: z.string().uuid(),
  hospitalName: z.string(),
  role: Role,
  status: StaffStatus,
  permissions: z.array(z.string()),
});
export type HospitalMembership = z.infer<typeof HospitalMembership>;

/** GET /me - who the caller is, and which hospitals they may act in. */
export const MeResponse = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  hasPassword: z.boolean(),
  linkedGoogle: z.boolean(),
  memberships: z.array(HospitalMembership),
});
export type MeResponse = z.infer<typeof MeResponse>;
