import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests share one Postgres and TRUNCATE between cases, so files
    // must not run concurrently or they wipe each other's fixtures.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  // esbuild (vitest's default) does NOT implement emitDecoratorMetadata, so NestJS
  // DI resolves every constructor param as undefined. SWC does implement it.
  // This is the trap recorded in docs/PROGRESS.md at the end of Phase 0.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
