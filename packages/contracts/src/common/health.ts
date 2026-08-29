import { z } from 'zod';

/** GET /health - liveness. The process is up. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  uptimeSec: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** GET /health/ready - readiness. Dependencies are reachable. */
export const ReadinessResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: z.enum(['up', 'down']),
    redis: z.enum(['up', 'down']),
  }),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
