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
   * Readiness: dependencies are reachable.
   * Returns 503 when anything is down so an orchestrator stops routing traffic here.
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

    res.status(body.status === 'ok' ? 200 : 503).json(body);
  }
}
