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
 *
 * COV-4 (05 §6, enforced from S1.5; ADR-0030 D18): `lib/jobs/**` and `lib/notify/**` at 85 lines /
 * 80 branches, read on the COMBINED unit + db run only (`pnpm test:coverage` = an unfiltered
 * `vitest run --coverage`, CI-3): the pure notify modules (`matrix.ts`, `constants.ts`, the deliverer
 * builders behind T-ADP-19) are unit-covered and the jobs/deliverers are db-covered, so neither lane
 * alone reaches the scope's real number. `pnpm test:db --coverage` still enforces COV-2 only.
 *
 * COV-5 (05 §6, enforced from S1.6): the GLOBAL number — `lib/**`, `app/api/**`, `emails/**` (plus
 * `app/auth/**`, which COV-2 needs in `coverage.include`) — at 75 lines / 70 branches, read on the
 * COMBINED run only for the COV-4 reason: neither lane alone loads every module (the unit lane never
 * loads the actions / routes / jobs, the db lane never loads the pure helpers). `emails/**` joins
 * `coverage.include` with it, so the templates and their previews count in the denominator. As wired
 * at the S1.6 build pass (2026-09-18, combined run): 92.7 lines / 82.2 branches (90.0 statements).
 */
const alias = { '@': path.resolve(import.meta.dirname) };

/** COV-2 (05 §6, enforced from S1.4): 85 lines / 80 branches over each scope, aggregated per scope. */
const COV_2 = { lines: 85, branches: 80 } as const;
/** COV-4 (05 §6, enforced from S1.5): same numbers over `lib/jobs/**` and `lib/notify/**`, combined run only. */
const COV_4 = { lines: 85, branches: 80 } as const;
/** COV-5 (05 §6, enforced from S1.6): the global floor over everything in `coverage.include`, combined run only. */
const COV_5 = { lines: 75, branches: 70 } as const;

function selectedProjects(argv: readonly string[]): string[] {
  const selected: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === '--project') selected.push(argv[index + 1] ?? '');
    else if (arg.startsWith('--project=')) selected.push(arg.slice('--project='.length));
  });
  return selected;
}

/** `--project db` / `--project=db` is selected, or there is no project filter (every project runs). */
function runIncludesDbProject(argv: readonly string[]): boolean {
  const selected = selectedProjects(argv);
  return selected.length === 0 || selected.includes('db');
}

/** No project filter at all — the combined unit + db run (`pnpm test:coverage`, CI-3) that reads COV-4. */
function runIsCombined(argv: readonly string[]): boolean {
  return selectedProjects(argv).length === 0;
}

export default defineConfig({
  test: {
    retry: 0, // 05 CI-11
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text-summary', 'lcov'],
      include: ['lib/**', 'app/api/**', 'app/auth/**', 'emails/**'],
      ...(runIncludesDbProject(process.argv)
        ? {
            thresholds: {
              'lib/actions/**': COV_2,
              'app/api/**': COV_2,
              'app/auth/**': COV_2,
              ...(runIsCombined(process.argv)
                ? { ...COV_5, 'lib/jobs/**': COV_4, 'lib/notify/**': COV_4 }
                : {}),
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
