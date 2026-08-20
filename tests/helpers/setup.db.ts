/**
 * tests/helpers/setup.db.ts — Vitest `db` project setupFile (docs/build/05-test-plan.md §1.1, §1.2).
 * Loads `.env.test` into `process.env` for every key that is not already set, so the local-stack
 * URL + the CLI's well-known local anon/service keys are available to `asRole` and friends.
 * `.env.test` is committed and contains no real secret (05 §1.2).
 */
import fs from 'node:fs';
import path from 'node:path';

const ENV_TEST_PATH = path.resolve(import.meta.dirname, '..', '..', '.env.test');

/** Tiny KEY=VALUE parser: ignores blank lines and `#` comments, strips surrounding quotes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Drop a trailing ` # comment` only when the value is unquoted.
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

export function loadEnvTest(): void {
  if (!fs.existsSync(ENV_TEST_PATH)) {
    throw new Error(`setup.db: ${ENV_TEST_PATH} is missing (05 §1.2 says it is committed).`);
  }
  const parsed = parseEnvFile(fs.readFileSync(ENV_TEST_PATH, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvTest();
