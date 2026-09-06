import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { env } from './config/env';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  // Validate configuration before anything else boots. Fail loudly, fail early.
  const config = env();

  // rawBody keeps the UNPARSED bytes on req.rawBody, which the Razorpay webhook
  // needs: the signature is an HMAC over exactly what was sent, and Nest's JSON
  // parser re-serialises the body into something with a different digest. Turning
  // this on AFTER writing the verification is how docs/Phases.md says hours get
  // lost to a phantom "invalid signature".
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  // Express announces itself on every response. It tells an attacker which stack to
  // look up known issues for and tells a legitimate client nothing at all.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Socket.IO across every instance, not just this one (docs/Phases.md Phase 7).
  // Installed HERE and not in the test bootstrap: the tests exercise one process and
  // the default in-memory adapter is exactly right for them, while a test suite that
  // needed Redis pub/sub to pass would be testing the adapter instead of the product.
  const realtime = new RedisIoAdapter(app);
  await realtime.connect();
  app.useWebSocketAdapter(realtime);

  await app.listen(config.PORT);
}

void bootstrap();
