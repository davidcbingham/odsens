/**
 * tests/helpers/setup.unit.ts — Vitest `unit` project setupFile (docs/build/05-test-plan.md §1.1, H-5).
 *
 * 1. `server-only` is mocked so unit tests can import `lib/env.ts`, `lib/auth.ts`, `lib/log.ts` and the
 *    server Supabase clients (they all `import 'server-only'`, which throws outside a React Server
 *    Component runtime).
 * 2. `.env.test` (committed, no real secret — 05 §1.2) is loaded into `process.env` for every key that is
 *    not already set: `lib/env.ts` parses `process.env` at import (01 INV-35) and `lib/auth.ts` /
 *    `lib/log.ts` import it transitively, so the 9 boot-required names must exist before those modules load (tests/helpers/envTest.ts).
 * 3. A fetch guard: unit tests never open a socket to anything but the loopback host (05 H-5).
 */
import { vi } from 'vitest';
import { loadEnvTest } from './envTest';

vi.mock('server-only', () => ({}));

loadEnvTest();

// ---- Fetch guard (05 H-5): unit tests must not open sockets to any non-loopback host. ----
const realFetch: typeof fetch = globalThis.fetch;
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).hostname;
  if (!LOOPBACK_HOSTS.includes(host)) {
    throw new Error(`unit tests must not open sockets to ${host} (05 H-5)`);
  }
  return realFetch(input, init);
}) as typeof fetch;
