import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Creates and migrates `<database>_test` once, before any worker starts.
    globalSetup: ['./test/global-setup.ts'],
    // Repoints DATABASE_URL at that database. Must run before PrismaClient is
    // constructed, which happens inside each test file's Nest module - so a setup
    // file, not an env var somebody has to remember to create.
    setupFiles: ['./test/use-test-database.ts'],
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
