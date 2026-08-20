/**
 * tests/helpers/envTest.ts — loads the committed `.env.test` (05 §1.2) into `process.env` for every key
 * that is not already set. Shared by the Vitest setup files and the Playwright helpers (`loginAs`),
 * which run in their own Node process and therefore do not inherit Vitest's setup.
 * `.env.test` holds the local-stack URL and the CLI's well-known demo keys only — never a real secret.
 *
 * No `import.meta` here: Playwright transpiles spec files (and what they import) to CommonJS, where
 * `import.meta` is a SyntaxError. Paths are resolved from the repo root, found by walking up from
 * `process.cwd()` to the first directory that holds `package.json` + `.env.test` (both runners start at
 * the repo root; the walk just makes a sub-directory cwd work too).
 */
import fs from 'node:fs';
import path from 'node:path';

function findRepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, '.env.test'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Absolute repo root (the directory holding `package.json` and `.env.test`). */
export const REPO_ROOT = findRepoRoot();

export const ENV_TEST_PATH = path.join(REPO_ROOT, '.env.test');

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

let loaded = false;

/** Idempotent: the file is read once per process; existing `process.env` values always win. */
export function loadEnvTest(): void {
  if (loaded) return;
  if (!fs.existsSync(ENV_TEST_PATH)) {
    throw new Error(`envTest: ${ENV_TEST_PATH} is missing (05 §1.2 says it is committed).`);
  }
  const parsed = parseEnvFile(fs.readFileSync(ENV_TEST_PATH, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  loaded = true;
}

/** Reads a required env name (after `loadEnvTest`), with a message that points at the fix. */
export function requireTestEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — is .env.test loaded (tests/helpers/envTest.ts)?`);
  }
  return value;
}

/** 05 H-9: every harness helper refuses to touch a Supabase host that is not the local stack. */
export function assertLocalSupabase(url: string, who: string): void {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`${who}: refusing to run against non-local Supabase host "${host}" (05 H-9).`);
  }
}
