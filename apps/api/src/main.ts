import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  // Validate configuration before anything else boots. Fail loudly, fail early.
  const config = env();

  // rawBody keeps the UNPARSED bytes on req.rawBody, which the Razorpay webhook
  // needs: the signature is an HMAC over exactly what was sent, and Nest's JSON
  // parser re-serialises the body into something with a different digest. Turning
  // this on AFTER writing the verification is how docs/Phases.md says hours get
  // lost to a phantom "invalid signature".
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  await app.listen(config.PORT);
}

void bootstrap();
