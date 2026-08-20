/**
 * tests/helpers/db.ts — local-stack helper for `db` tests that need raw SQL (catalog checks, seeding
 * state that has no PostgREST surface). Uses `psql` (brew install libpq) against the local Supabase DB.
 * Never points at anything but 127.0.0.1 — production is unreachable from here by construction.
 */
import { spawnSync } from 'node:child_process';

export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const PSQL_MISSING =
  'psql is not installed or not on PATH. Install it with `brew install libpq` ' +
  '(then `brew link --force libpq`) — docs/dev-tooling.md.';

/** True when a `psql` binary is reachable. */
export function hasPsql(): boolean {
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

/**
 * Runs one SQL statement through psql in tuples-only, unaligned mode and returns the rows,
 * each row = the `|`-separated column values (trimmed). Throws with a clear message when psql
 * is missing or the statement fails.
 */
export function sql(statement: string): string[][] {
  const result = spawnSync(
    'psql',
    [LOCAL_DB_URL, '-X', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', statement],
    {
      encoding: 'utf8',
    },
  );
  if (result.error) {
    throw new Error(`${PSQL_MISSING} (${result.error.message})`);
  }
  if (result.status !== 0) {
    throw new Error(`psql failed (status ${String(result.status)}): ${result.stderr.trim()}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split('|').map((cell) => cell.trim()));
}
