import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * vitest.config.ts — two projects per docs/build/05-test-plan.md §1.1:
 *  - `unit`: tests/unit/** — pure, no network, no DB, fully parallel (H-2)
 *  - `db`:   tests/db/**   — against the local Supabase stack; forks, no file parallelism (H-2), db reset once (H-1)
 * Coverage thresholds are enforced per 05 §6 from the slice that turns them on. Coverage options are
 * root-level (Vitest builds one report for the projects a run selects), so COV-2 — `lib/actions/**`,
 * `app/api/**`, `app/auth/**` at 85 lines / 80 branches, enforced from S1.4 — is checked only when the
 * run includes the `db` project (`pnpm test:db --coverage`, CI-3; or an unfiltered `vitest run
 * --coverage`): those modules are exercised by the T-ACT and route tests alone, and the unit lane
 * (`pnpm test:unit --coverage`, CI-2) never loads them, so a threshold there would fail by construction.
 * `coverage.include` names the thresholded scopes plus `lib/**`, so every file in a scope counts —
 * loaded by a test or not (the honest denominator).
 */
const alias = { '@': path.resolve(import.meta.dirname) };

/** COV-2 (05 §6, enforced from S1.4): 85 lines / 80 branches over each scope, aggregated per scope. */
const COV_2 = { lines: 85, branches: 80 } as const;

/** `--project db` / `--project=db` is selected, or there is no project filter (every project runs). */
function runIncludesDbProject(argv: readonly string[]): boolean {
  const selected: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === '--project') selected.push(argv[index + 1] ?? '');
    else if (arg.startsWith('--project=')) selected.push(arg.slice('--project='.length));
  });
  return selected.length === 0 || selected.includes('db');
}

export default defineConfig({
  test: {
    retry: 0, // 05 CI-11
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text-summary', 'lcov'],
      include: ['lib/**', 'app/api/**', 'app/auth/**'],
      ...(runIncludesDbProject(process.argv)
        ? {
            thresholds: {
              'lib/actions/**': COV_2,
              'app/api/**': COV_2,
              'app/auth/**': COV_2,
            },
          }
        : {}),
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
