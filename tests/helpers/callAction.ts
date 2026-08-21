/**
 * tests/helpers/callAction.ts — `callAction(action, input, { role, headers? })` (05 §1.3, H-6) plus the
 * route-handler twin `callRoute(handler, request, { role })` and the generic `withActionContext`.
 *
 * Invokes a Server Action module function DIRECTLY (never over HTTP) with a server-side session for the
 * role and returns its `ActionResult<T>` (04 SC-03 / ADR-0002 C14, `lib/actions/result.ts`).
 *
 * How it works — the module mocks live in tests/helpers/setup.db.ts (setupFiles, so every `db` test
 * file gets them; `vi.mock` is hoisted per file and could not be exported from here):
 *   `@/lib/supabase/server` createServerClient() → an `@supabase/ssr` client bound to an in-memory cookie
 *   store that holds the role's real local-stack session cookies (obtained once per role per file by
 *   `signInWithPassword`, tests/helpers/sessionCookies.ts). `lib/auth.ts getUser()` therefore verifies a
 *   real JWT against the local GoTrue; RLS runs as that user; `lib/supabase/admin.ts` is NOT mocked.
 *   `next/headers` cookies()/headers() read the same context; `next/cache` revalidateTag/Path are
 *   recorders (tests/helpers/spies.ts `spyRevalidateTag()` / `spyRevalidatePath()`).
 *
 * Usage (tests/db/actions/*.test.ts):
 *   import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
 *   import { completeOnboarding } from '@/lib/actions/accounts';
 *   setupActionMocks();                                  // top of file: asserts mocks, resets state
 *   const res = await callAction(completeOnboarding, { handle: 'Seed_User_9' }, { role: 'nohandle' });
 *   const asFactory = await callActionAs(updateProfile, { removeAvatar: true }, { profileId });
 *   getActionContext().cookies.getAll()                  // e.g. "session cookies cleared" after sign-out
 *
 * Route handlers (tests/db/routes/*.test.ts — T-ACT-8/9): because `next/headers` is mocked, a handler's
 * `createServerClient()` reads the MOCKED `cookies()`, not the `Cookie:` header of the `Request` you
 * pass — so seed the session through the context, not the header:
 *   import { POST } from '@/app/auth/sign-out/route';
 *   const res = await callRoute(POST, new NextRequest('http://localhost:3000/auth/sign-out', {
 *     method: 'POST', headers: { origin: 'http://localhost:3000' } }), { role: 'user' });
 *   expect(res.status).toBe(303);
 *   expect(lastActionCookies().getAll()).toEqual([]);    // signOut cleared the jar (cookies().set(''))
 * The handler's `headers()` sees the request's headers (plus `options.headers` on top). Cookies the
 * handler writes land in the context's store (`lastActionCookies()`), not in the `Response` — in
 * production Next copies them onto the response; here you assert the store.
 * Anything else that needs a session (e.g. calling `lib/auth.ts getViewer()` directly):
 *   await withActionContext({ role: 'admin' }, () => getViewer());
 *
 * `role: 'anon'` = empty cookie jar. `headers` become the mocked `headers()` (e.g. `x-forwarded-for`).
 * Actions that take `FormData` accept it here too — `input` is passed through untouched.
 * Each call runs in its own AsyncLocalStorage context, so concurrent calls (`Promise.all`) are safe;
 * `getActionContext()` / `lastActionCookies()` refer to the most recently STARTED call.
 * Proxy tests (T-ACT-10) do NOT use this file: `proxy.ts` reads `request.cookies`, so build the request
 * with `cookieHeader(await seedSessionCookies(role))` from tests/helpers/sessionCookies.ts.
 */
import type { ActionResult } from '@/lib/actions/result';
import {
  actionMocksInstalled,
  getActionContext,
  MockCookieStore,
  resetActionContext,
  resetCacheSpies,
  runWithActionContext,
  type ActionContext,
  type ActionRole,
} from './actionContext';
import { seedSessionCookies, userSessionCookies, type SessionCookie } from './sessionCookies';

export type { ActionContext, ActionRole } from './actionContext';
export { getActionContext, MockCookieStore, runWithActionContext } from './actionContext';

export type CallActionOptions = { role: ActionRole; headers?: HeadersInit };
export type CallActionAsOptions = { profileId: string; headers?: HeadersInit };
/** Who the code under test runs as: a seed role / anon, or a `makeUser` profile id. */
export type ContextOptions = CallActionOptions | CallActionAsOptions;

export type CallAction = <TInput, TData>(
  action: (input: TInput) => Promise<ActionResult<TData>>,
  input: TInput,
  options: CallActionOptions,
) => Promise<ActionResult<TData>>;

const NOT_INSTALLED =
  'callAction: the action mocks are not installed — this helper only works in the `db` Vitest project ' +
  '(tests/db/**), whose setup file tests/helpers/setup.db.ts registers them.';

/**
 * Call once at the top of an action test file: verifies the `db` project mocks are active and resets
 * the action context + revalidate spies so state never leaks between files.
 */
export function setupActionMocks(): void {
  if (!actionMocksInstalled()) throw new Error(NOT_INSTALLED);
  resetActionContext();
  resetCacheSpies();
}

/** A cookie store pre-filled with session cookies (what `cookies()` resolves to inside the context). */
export function cookieStoreFrom(cookies: ReadonlyArray<SessionCookie>): MockCookieStore {
  const store = new MockCookieStore();
  for (const { name, value, options } of cookies) store.set(name, value, options);
  return store;
}

async function contextFor(options: ContextOptions): Promise<ActionContext> {
  const headers = new Headers(options.headers);
  if ('profileId' in options) {
    return {
      role: `user:${options.profileId}`,
      cookies: cookieStoreFrom(await userSessionCookies(options.profileId)),
      headers,
    };
  }
  const cookies = options.role === 'anon' ? [] : await seedSessionCookies(options.role);
  return { role: options.role, cookies: cookieStoreFrom(cookies), headers };
}

/**
 * Runs `fn` with the mocked `cookies()` / `headers()` / `createServerClient()` bound to `options`'
 * identity — the primitive under `callAction`, `callActionAs` and `callRoute`.
 */
export async function withActionContext<T>(
  options: ContextOptions,
  fn: () => T | Promise<T>,
): Promise<T> {
  if (!actionMocksInstalled()) throw new Error(NOT_INSTALLED);
  return runWithActionContext(await contextFor(options), fn);
}

/** Invokes `action(input)` as `role` (05 §1.4) and returns its `ActionResult`. */
export const callAction: CallAction = (action, input, options) =>
  withActionContext(options, () => action(input));

/** Same as `callAction` for a factory-created user (`makeUser` → profile id). */
export function callActionAs<TInput, TData>(
  action: (input: TInput) => Promise<ActionResult<TData>>,
  input: TInput,
  options: CallActionAsOptions,
): Promise<ActionResult<TData>> {
  return withActionContext(options, () => action(input));
}

/**
 * Invokes a route handler (`GET`/`POST`… exported from `app/**\/route.ts`) as `role`. The mocked
 * `headers()` is the request's own headers with `options.headers` layered on top; the session comes from
 * the context (see the header comment). `routeContext` is the handler's second argument for dynamic
 * segments (`{ params: Promise<…> }`) — unused by the S1.1 routes.
 */
export async function callRoute<R extends Request, Res extends Response, C = undefined>(
  handler: (request: R, context: C) => Res | Promise<Res>,
  request: R,
  options: ContextOptions,
  routeContext?: C,
): Promise<Res> {
  const headers = new Headers(request.headers);
  for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
  return withActionContext({ ...options, headers }, () => handler(request, routeContext as C));
}

/** The cookie jar the most recently started call ran with (after the action — sign-out clears it). */
export function lastActionCookies(): MockCookieStore {
  return getActionContext().cookies;
}
