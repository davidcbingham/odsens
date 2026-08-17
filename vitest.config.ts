import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * vitest.config.ts — two projects per docs/build/05-test-plan.md §1.1:
 *  - `unit`: tests/unit/** — pure, no network, no DB, fully parallel (H-2)
 *  - `db`:   tests/db/**   — against the local Supabase stack; forks, no file parallelism (H-2), db reset once (H-1)
 * Coverage thresholds are enforced per 05 §6 from the slice that turns them on (none at S0).
 */
const alias = { '@': path.resolve(import.meta.dirname) };

export default defineConfig({
  test: {
    retry: 0, // 05 CI-11
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text-summary', 'lcov'],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
          environment: 'node',
          setupFiles: ['tests/helpers/setup.unit.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          fileParallelism: false,
          globalSetup: ['tests/helpers/globalSetup.db.ts'],
          setupFiles: ['tests/helpers/setup.db.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
