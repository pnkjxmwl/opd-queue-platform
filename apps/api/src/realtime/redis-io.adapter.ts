import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import Redis from 'ioredis';
import { env } from '../config/env';

/**
 * The Redis adapter for Socket.IO (docs/Architecture.md 9).
 *
 * **Installed now, on a single instance, on purpose.** docs/Phases.md: *"Add the
 * Redis adapter now, even on a single instance. The day you scale to two, every
 * socket bug you have will be an invisible one where half the users get no updates."*
 * With one process it changes nothing observable; with two it is the difference
 * between a working product and a lottery.
 *
 * It needs its own pair of connections - the adapter takes over the client it is
 * given for pub/sub, so sharing RedisService's client would break every other use of
 * it.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly log = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connect(): Promise<void> {
    const publisher = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
    const subscriber = publisher.duplicate();
    // Same reason as RedisService: without a listener ioredis throws an unhandled
    // 'error' and takes the process down whenever Redis blinks.
    publisher.on('error', () => undefined);
    subscriber.on('error', () => undefined);

    this.adapterConstructor = createAdapter(publisher, subscriber);
    this.log.log('socket.io redis adapter connected');
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (a: ReturnType<typeof createAdapter>) => void;
    };
    if (this.adapterConstructor !== undefined) server.adapter(this.adapterConstructor);
    return server;
  }
}
