import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HealthResponse, ReadinessResponse } from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Public } from '../../common/decorators';

// Health probes must never require a token: an orchestrator polling liveness has no
// credentials, and a 401 here reads as "unhealthy" and gets the service killed.
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: the process is up. Never touches a dependency. */
  @Get()
  health(): HealthResponse {
    return { status: 'ok', uptimeSec: Math.floor(process.uptime()) };
  }

  /**
   * Readiness: can this process serve a request?
   *
   * **Postgres decides the status code; Redis is reported but does not.** Redis is
   * used for exactly two things here - the Socket.IO adapter that fans events across
   * instances, and this probe. Every REST path, the queue engine, payments and
   * discovery are pure Postgres, and rate limiting is in memory. So a Redis blip
   * used to 503 an API that could still answer every request correctly, and an
   * orchestrator would drain or kill it: the product would have degraded from live
   * to stale, and instead it went to zero.
   *
   * `status` still reads `degraded` when Redis is down, so a dashboard and an
   * on-call engineer can both see it. That is what the field is for. Taking traffic
   * away is a stronger action and wants a stronger reason.
   */
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    const [database, redis] = await Promise.all([
      this.prisma.isReachable(),
      this.redis.isReachable(),
    ]);

    const body: ReadinessResponse = {
      status: database && redis ? 'ok' : 'degraded',
      checks: {
        database: database ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
      },
    };

    res.status(database ? 200 : 503).json(body);
  }
}
