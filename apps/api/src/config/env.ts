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
const EnvSchema = z.object({
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

  /// Comma-separated Google OAuth client ids (iOS, Android and web each have one).
  /// Empty disables POST /auth/google rather than failing boot - Google is optional.
  GOOGLE_CLIENT_IDS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
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
