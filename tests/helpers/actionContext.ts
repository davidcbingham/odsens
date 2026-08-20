/**
 * tests/helpers/actionContext.ts — the state behind the `db` project's module mocks (installed by
 * tests/helpers/setup.db.ts; driven by tests/helpers/callAction.ts; read by tests/helpers/spies.ts).
 *
 *   - `MockCookieStore`              → what the mocked `next/headers` `cookies()` resolves to
 *   - `createContextServerClient()`  → what the mocked `@/lib/supabase/server` `createServerClient()`
 *                                      returns: a real `@supabase/ssr` server client (anon key) whose
 *                                      cookie adapter is the current context's store — so `lib/auth.ts`
 *                                      `getUser()` verifies the JWT against the local GoTrue for real
 *   - `nextHeadersMock` / `nextCacheMock` → the module shapes for `next/headers` and `next/cache`
 *
 * This module must not import anything that is itself mocked (it is loaded from the mock factories).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { Database } from '@/lib/supabase/types';
import type { SeedRole } from './asRole'; // type-only: no runtime import cycle
import { assertLocalSupabase, requireTestEnv } from './envTest';

/** `'anon'` = empty cookie jar; a seed role = that SEED-3 user's real local session (05 §1.4). */
export type ActionRole = 'anon' | SeedRole;

type StoredCookie = { name: string; value: string; options: CookieOptions };

/** Minimal `ReadonlyRequestCookies`-shaped store (get/getAll/has/set/delete/toString). */
export class MockCookieStore {
  private readonly jar = new Map<string, StoredCookie>();

  getAll(): { name: string; value: string }[] {
    return [...this.jar.values()].map(({ name, value }) => ({ name, value }));
  }

  get(name: string): { name: string; value: string } | undefined {
    const hit = this.jar.get(name);
    return hit ? { name: hit.name, value: hit.value } : undefined;
  }

  has(name: string): boolean {
    return this.jar.has(name);
  }

  set(
    nameOrCookie:
      string | { name: string; value: string } | ({ name: string; value: string } & CookieOptions),
    value?: string,
    options: CookieOptions = {},
  ): this {
    if (typeof nameOrCookie === 'string') {
      this.write(nameOrCookie, value ?? '', options);
    } else {
      const { name, value: v, ...rest } = nameOrCookie;
      this.write(name, v, rest);
    }
    return this;
  }

  /** Next's `cookies().delete` accepts a name or `{ name, path?, domain? }` — both unwrap to the name. */
  delete(name: string | { name: string }): this {
    this.jar.delete(typeof name === 'string' ? name : name.name);
    return this;
  }

  clear(): this {
    this.jar.clear();
    return this;
  }

  /** `Cookie:` header form. */
  toString(): string {
    return this.getAll()
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
  }

  private write(name: string, value: string, options: CookieOptions): void {
    // An empty value or maxAge 0 is how @supabase/ssr clears a cookie (sign-out).
    if (value === '' || options.maxAge === 0) this.jar.delete(name);
    else this.jar.set(name, { name, value, options });
  }
}

export type ActionContext = {
  role: ActionRole | `user:${string}`;
  cookies: MockCookieStore;
  headers: Headers;
};

function anonContext(): ActionContext {
  return { role: 'anon', cookies: new MockCookieStore(), headers: new Headers() };
}

/**
 * Each `callAction` runs inside `runWithActionContext`, so the mocked `cookies()` / `headers()` /
 * `createServerClient()` resolve the context of the call they were made from — concurrent calls
 * (`Promise.all([...])` for a rate-limit or race assertion) never see each other's cookies or headers.
 * `current` remembers the most recently STARTED call for inspection after the fact.
 */
const storage = new AsyncLocalStorage<ActionContext>();

let current: ActionContext = anonContext();

export function runWithActionContext<T>(context: ActionContext, fn: () => T): T {
  current = context;
  return storage.run(context, fn);
}

/** The context the calling code is executing under (mock factories read this). */
export function activeActionContext(): ActionContext {
  return storage.getStore() ?? current;
}

/** The context of the most recently started `callAction` (inspect cookies after sign-out, etc.). */
export function getActionContext(): ActionContext {
  return current;
}

export function resetActionContext(): void {
  current = anonContext();
}

// ---- @/lib/supabase/server ---------------------------------------------------------------------

/** Mirrors lib/supabase/server.ts, bound to the current context's cookie store. */
export async function createContextServerClient(): Promise<SupabaseClient<Database>> {
  const url = requireTestEnv('NEXT_PUBLIC_SUPABASE_URL');
  assertLocalSupabase(url, 'callAction');
  const store = activeActionContext().cookies;
  return createServerClient<Database>(url, requireTestEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) store.set(name, value, options);
      },
    },
  });
}

// ---- next/headers -------------------------------------------------------------------------------

export const nextHeadersMock = {
  cookies: async () => activeActionContext().cookies,
  headers: async () => activeActionContext().headers,
  draftMode: async () => ({ isEnabled: false, enable: () => undefined, disable: () => undefined }),
};

// ---- next/cache ---------------------------------------------------------------------------------

export const revalidateTagCalls: string[] = [];
export const revalidatePathCalls: string[] = [];

export const revalidateTag = vi.fn((tag: string): void => {
  revalidateTagCalls.push(tag);
});
export const revalidatePath = vi.fn((path: string): void => {
  revalidatePathCalls.push(path);
});
export const updateTag = vi.fn((): void => undefined);
export const refresh = vi.fn((): void => undefined);

/**
 * Mirrors the export list of `next/cache` in the installed Next (16.3: `revalidateTag`,
 * `revalidatePath`, `updateTag`, `refresh`, `unstable_cache`, `unstable_noStore`, `io`, `cacheTag`,
 * `cacheLife`, `unstable_cacheTag`, `unstable_cacheLife`). Vitest throws "No export is defined on the
 * mock" for anything app code imports that is missing here — re-check this list on a Next upgrade.
 */
export const nextCacheMock = {
  revalidateTag,
  revalidatePath,
  updateTag,
  refresh,
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T): T => fn,
  unstable_noStore: (): void => undefined,
  io: async (): Promise<void> => undefined,
  cacheTag: (): void => undefined,
  cacheLife: (): void => undefined,
  unstable_cacheTag: (): void => undefined,
  unstable_cacheLife: (): void => undefined,
};

export function resetCacheSpies(): void {
  revalidateTagCalls.length = 0;
  revalidatePathCalls.length = 0;
  revalidateTag.mockClear();
  revalidatePath.mockClear();
  updateTag.mockClear();
  refresh.mockClear();
}

// ---- install flag (set by setup.db.ts after its vi.mock calls) ----------------------------------

let installed = false;

export function markActionMocksInstalled(): void {
  installed = true;
}

export function actionMocksInstalled(): boolean {
  return installed;
}
