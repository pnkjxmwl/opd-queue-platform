import { z } from 'zod';

// Load .env explicitly with Node's built-in loader (no dotenv dependency).
// Prisma also loads .env as a side effect of importing its client, but depending on
// that import order is fragile - a refactor that moves the import breaks config.
// Absent .env is normal in deployed environments, where the platform injects vars.
try {
  process.loadEnvFile?.();
} catch {
  // no .env file - expected outside local development
}

/**
 * Environment contract. docs/Rules.md 1.5: everything comes from env, nothing from the repo.
 *
 * This is validated ONCE at boot and the process refuses to start if it is wrong -
 * a missing DATABASE_URL should fail loudly at startup, not as a confusing 500
 * on the first request.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Separate secrets per token type: a leaked access secret must not let an
  // attacker mint refresh tokens. 32 chars minimum - short secrets are brute-forceable.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  /// Access tokens stay short-lived; the refresh token carries the session.
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  /**
   * Signs the check-in QR (P6-BE-01, `common/checkin-code.ts`).
   *
   * Its OWN secret, not a reuse of a JWT one, for the reason stated above: a leak
   * must not cross purposes. Required rather than defaulted, because the whole point
   * of the scheme is that a code is refused unless it was signed - a deployment that
   * quietly fell back to no signing would look identical and check anybody in.
   */
  CHECKIN_SECRET: z.string().min(32),

  /// Comma-separated Google OAuth client ids (iOS, Android and web each have one).
  /// Empty disables POST /auth/google rather than failing boot - Google is optional.
  GOOGLE_CLIENT_IDS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  // Razorpay, test mode for MVP (docs/PRD.md 10, docs/Rules.md 9).
  //
  // All three default to empty so the API still BOOTS without them. That is
  // deliberate: everything except join and the webhook works without Razorpay, and
  // failing boot would stop a contributor running discovery or the queue engine at
  // all just because they have no gateway account. `paymentsConfigured()` below is
  // the single check, and join fails loudly with a real message when it is false.
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  /// Set in the Razorpay dashboard when registering the webhook URL. This is what
  /// the inbound signature is verified against, and it is NOT the API secret.
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

  /**
   * The publicly reachable origin of THIS api, e.g. the dev tunnel.
   *
   * Razorpay's redirect mode sends the patient's browser back here after they pay,
   * so it has to be a real address the gateway will accept and a phone can reach -
   * `localhost` and a LAN ip are neither. Empty falls back to a sentinel the app
   * intercepts locally, which works but leaves the redirect target unresolvable.
   */
  PUBLIC_BASE_URL: z.string().default(''),

  /// How long an unpaid reservation holds its slot. Ten minutes is comfortably more
  /// than a UPI round trip on a bad connection and short enough that an abandoned
  /// checkout does not block a real patient for the rest of the clinic.
  RESERVATION_TTL_SEC: z.coerce.number().int().positive().default(600),

  /**
   * Background workers to keep switched OFF, comma-separated (Phase 8).
   *
   * docs/Phases.md asks for this by name: *"Give every worker its own env-flag kill
   * switch, so a misbehaving timer can be disabled without a redeploy."* A timer that
   * is skipping patients or sending pushes in a loop has to be stoppable in the time
   * it takes to restart a process, not the time it takes to ship a fix.
   *
   * Names are the `name` on each Sweeper: grace, cutoff, reconcile, notify,
   * reservation, eta-tick.
   */
  DISABLED_WORKERS: z
    .string()
    .default('')
    .transform((raw) => raw.split(',').map((name) => name.trim()).filter(Boolean)),

  /**
   * Expo push access token (Phase 8). Empty disables sending, and the API still
   * boots and still RECORDS every notification - the same posture as Razorpay above,
   * so a contributor with no Expo account can run everything else.
   */
  EXPO_ACCESS_TOKEN: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

/** Boot-time singleton. Import this, do not read process.env directly. */
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test seam - lets a test reset the memoised value. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * Whether this deployment can take money.
 *
 * One place, so no handler invents its own idea of "configured" and so a
 * half-configured environment (a key but no webhook secret) is treated as OFF
 * rather than accepting payments it can never verify.
 */
export function paymentsConfigured(config: Env = env()): boolean {
  return (
    config.RAZORPAY_KEY_ID !== '' &&
    config.RAZORPAY_KEY_SECRET !== '' &&
    config.RAZORPAY_WEBHOOK_SECRET !== ''
  );
}
