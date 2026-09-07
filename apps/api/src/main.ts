import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { env } from './config/env';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { initSentry } from './common/sentry';
import helmet from 'helmet';

async function bootstrap(): Promise<void> {
  // Validate configuration before anything else boots. Fail loudly, fail early.
  const config = env();

  // rawBody keeps the UNPARSED bytes on req.rawBody, which the Razorpay webhook
  // needs: the signature is an HMAC over exactly what was sent, and Nest's JSON
  // parser re-serialises the body into something with a different digest. Turning
  // this on AFTER writing the verification is how docs/Phases.md says hours get
  // lost to a phantom "invalid signature".
  // Before the app exists, so a fault DURING boot is still reported. Empty DSN is
  // the normal local state and skips init entirely (common/sentry.ts).
  initSentry(config.SENTRY_DSN, config.NODE_ENV);

  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  // Express announces itself on every response. It tells an attacker which stack to
  // look up known issues for and tells a legitimate client nothing at all.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // Security headers (Phase 10). Two of helmet's defaults are wrong for an API and
  // are set deliberately rather than inherited:
  //
  //   contentSecurityPolicy  off. This process serves JSON to two native clients and
  //     a console on another origin, never HTML. A CSP here protects nothing.
  //   crossOriginResourcePolicy  'cross-origin', not helmet's 'same-origin'. The
  //     console and the Expo app are BOTH on a different origin from the API, which
  //     is the whole deployment shape (P10-WEB-01 puts the console on Vercel). The
  //     default would be a header that exists only to break them.
  //
  // HSTS is left ON at helmet's default year. It is inert over plain HTTP, so it
  // costs nothing locally and is already correct the moment TLS terminates in front.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

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
