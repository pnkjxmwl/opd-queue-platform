import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(env().REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    // Without a listener ioredis emits an unhandled 'error' event and crashes the
    // process whenever Redis is briefly unavailable. /health/ready is what reports it.
    this.client.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Cheap liveness probe for /health/ready. */
  async isReachable(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
