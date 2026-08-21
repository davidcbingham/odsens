/**
 * tests/helpers/setup.db.ts — Vitest `db` project setupFile (docs/build/05-test-plan.md §1.1, §1.2).
 *
 * 1. Loads `.env.test` into `process.env` for every key that is not already set (local-stack URL + the
 *    CLI's well-known local anon/service keys) so `asRole` and friends — and `lib/env.ts`, which parses
 *    `process.env` at import — have the 9 boot-required names. `.env.test` is committed, no real secret.
 *
 * 2. Installs the module mocks every `db` test file needs to call Server Actions directly (05 §1.3
 *    `callAction`, H-6). `vi.mock` is hoisted per file, so the mocks live HERE (setupFiles run before
 *    each test file in the same module registry) instead of in `tests/helpers/callAction.ts`:
 *      - `server-only`            → `{}` (actions, `lib/auth.ts`, `lib/rate-limit.ts`… import it)
 *      - `@/lib/supabase/server`  → `createServerClient()` returns an `@supabase/ssr` server client bound
 *                                   to the CURRENT action context's cookie store (the role `callAction`
 *                                   was given; anon = empty jar) — same code path as production
 *      - `next/headers`           → `cookies()` / `headers()` read the current action context
 *      - `next/cache`             → `revalidateTag` / `revalidatePath` are `vi.fn` recorders that
 *                                   `tests/helpers/spies.ts` exposes (`spyRevalidateTag()` …)
 *    `lib/supabase/admin.ts` is NOT mocked: the service client hits the local stack for real.
 *    Pattern in a test file:
 *      import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
 *      import { completeOnboarding } from '@/lib/actions/accounts';
 *      setupActionMocks();            // asserts the mocks above are active, resets context + spies
 *      const res = await callAction(completeOnboarding, { handle: 'x' }, { role: 'nohandle' });
 */
import { vi } from 'vitest';
import { loadEnvTest } from './envTest';
import { markActionMocksInstalled } from './actionContext';

export { loadEnvTest, parseEnvFile } from './envTest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', async () => {
  const ctx = await import('./actionContext');
  return { createServerClient: ctx.createContextServerClient };
});

vi.mock('next/headers', async () => {
  const ctx = await import('./actionContext');
  return ctx.nextHeadersMock;
});

vi.mock('next/cache', async () => {
  const ctx = await import('./actionContext');
  return ctx.nextCacheMock;
});

loadEnvTest();
markActionMocksInstalled();
