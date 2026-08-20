/**
 * tests/helpers/globalSetup.db.ts — Vitest `db` project globalSetup (docs/build/05-test-plan.md §1.5 H-1).
 * Runs `supabase db reset` ONCE per run: applies supabase/migrations/* + supabase/seed.sql against the
 * local stack (API :54321, DB :54322). Set SKIP_DB_RESET=1 to reuse the current local state.
 */
import { spawnSync } from 'node:child_process';

export default async function globalSetup(): Promise<void> {
  if (process.env.SKIP_DB_RESET === '1') {
    console.log(
      '[db] SKIP_DB_RESET=1 — reusing the current local database state (H-1 reset skipped)',
    );
    return;
  }
  console.log('[db] supabase db reset (H-1: once per run)…');
  const result = spawnSync('supabase', ['db', 'reset'], { stdio: 'inherit', timeout: 240_000 });
  if (result.error) {
    throw new Error(
      `[db] could not run "supabase db reset": ${result.error.message}. ` +
        'Install the Supabase CLI and run `supabase start` first (docs/dev-tooling.md).',
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `[db] "supabase db reset" exited with status ${String(result.status)} (signal ${String(result.signal)}). ` +
        'Is the local stack running? Check `supabase status`.',
    );
  }
}
