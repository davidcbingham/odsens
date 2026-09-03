/**
 * tests/helpers/dbFault.ts — per-call fault injection and mid-flight hooks on the Supabase clients
 * (05 T-ACT-0 (1): "a thrown DB error → `{ok:false, error:{code:'internal'}}` + one `log.error` line
 * with `id`"; the `if (error) throw …` arms of lib/actions/** and app/api/** that no local-stack
 * state reaches; and the between-the-check-and-the-write races 04 §1.2 names — comments closed,
 * a row gone, a ban, a handle taken — reproduced on the REAL stack by a hook that runs inside the
 * action's own sequence).
 *
 * Mechanism: `vi.spyOn` on `SupabaseClient.prototype.from` / `.rpc` — the prototype behind every
 * client in the process: the service singleton of lib/supabase/admin.ts, the harness's `asRole`
 * clients, and the cookie-bound RLS client `@supabase/ssr` builds (its `createServerClient` may
 * resolve a second copy of supabase-js under Vitest's loader, so that prototype is discovered from
 * a throwaway ssr client and spied too). A plan matches per call on
 * `{ table, op }` (the `.from(table).<op>(…)` pair) or `{ rpc }`, fires on the nth match only
 * (default the first), and lives exactly as long as the `fn` it wraps — arrange/assert calls outside
 * that window, and the service calls a hook makes inside it, run against the real stack. The spies
 * are restored when the last plan ends; a plan that never fired throws (a silent no-op would be a
 * test bug, not coverage).
 *
 *   await withDbFault({ table: 'comments', op: 'update' }, {}, () => callAction(…));      // XX000
 *   await withDbFault({ rpc: 'check_handle' }, { result: { data: 'weird', error: null } }, …);
 *   await withDbFault({ rpc: 'record_download' }, { throws: 'boom' }, …);   // the await rejects
 *   await withDbHook({ rpc: 'rate_limit_ok' }, async () => { …service write… }, () => callAction(…));
 *   await withDbHook({ table: 'comment_likes', op: 'select' }, hook, fn, { when: 'after' });
 *
 * `expectInternal(res, action, logs)` is the T-ACT-0 (1) assertion these tests share.
 */
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { SupabaseClient } from '@supabase/supabase-js';
import { expect, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { expectFail } from './actionResult';
import { requireTestEnv } from './envTest';
import type { LogSpy } from './spies';

export type DbOp = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
export type DbCallTarget = { table: string; op: DbOp } | { rpc: string };

/** `nth`: fire on the nth matching call only (1-based, default 1) or on every match (`'all'`). */
export type DbFaultOptions = {
  /** PostgREST error code the fake answers with (default `XX000`, internal_error). */
  code?: string;
  message?: string;
  nth?: number | 'all';
  /** Reject the awaited call with this value instead of resolving an error result. */
  throws?: unknown;
  /** Resolve with this result instead of an error (an unexpected verdict, a count-less answer). */
  result?: { data: unknown; error: unknown; count?: number | null };
};

export type DbHookOptions = { nth?: number | 'all'; when?: 'before' | 'after' };

type Plan = {
  target: DbCallTarget;
  nth: number | 'all';
  seen: number;
  fired: number;
  /** fault: what the awaited call resolves/rejects with. */
  respond?: () => Promise<unknown>;
  /** hook: runs before or after the real call. */
  hook?: () => Promise<void>;
  when?: 'before' | 'after';
};

type Fn = (...args: unknown[]) => unknown;
type ClientProto = { from: Fn; rpc: Fn };

const OPS: ReadonlySet<string> = new Set(['select', 'insert', 'update', 'upsert', 'delete']);
const INTERNAL_MESSAGE = 'Something broke.'; // lib/actions/run.ts INTERNAL_MESSAGE (db lane only here)

const plans: Plan[] = [];
let installed = false;
/** > 0 while a hook runs: its own service calls pass straight through (no re-entrancy). */
let suspended = 0;

function matches(target: DbCallTarget, call: DbCallTarget): boolean {
  if ('rpc' in target) return 'rpc' in call && call.rpc === target.rpc;
  return 'table' in call && call.table === target.table && call.op === target.op;
}

/** The first plan whose nth match this call is, counting the match against every plan it fits. */
function claim(call: DbCallTarget): Plan | null {
  if (suspended > 0) return null;
  for (const plan of plans) {
    if (!matches(plan.target, call)) continue;
    plan.seen += 1;
    if (plan.nth === 'all' || plan.seen === plan.nth) {
      plan.fired += 1;
      return plan;
    }
  }
  return null;
}

/** A chain-agnostic thenable: every method returns itself; `await` yields `respond()`. */
function failingBuilder(respond: () => Promise<unknown>): unknown {
  const proxy: unknown = new Proxy(function fake() {}, {
    get(_target, prop) {
      if (prop === 'then') return (a?: Fn, b?: Fn) => respond().then(a, b);
      if (prop === 'catch') return (b?: Fn) => respond().catch(b);
      if (prop === 'finally') return (c?: () => void) => respond().finally(c);
      if (typeof prop === 'symbol') return undefined;
      return () => proxy;
    },
  });
  return proxy;
}

async function runHook(plan: Plan): Promise<void> {
  suspended += 1;
  try {
    await plan.hook?.();
  } finally {
    suspended -= 1;
  }
}

/** The real builder, with the hook spliced into its `then` (chained filters keep the proxy). */
function hookedBuilder(builder: object, plan: Plan): unknown {
  const run = async (): Promise<unknown> => {
    if (plan.when === 'before') await runHook(plan);
    const result: unknown = await (builder as PromiseLike<unknown>);
    if (plan.when === 'after') await runHook(plan);
    return result;
  };
  const proxy: unknown = new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === 'then') return (a?: Fn, b?: Fn) => run().then(a, b);
      if (prop === 'catch') return (b?: Fn) => run().catch(b);
      if (prop === 'finally') return (c?: () => void) => run().finally(c);
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const out: unknown = Reflect.apply(value, target, args);
        return out === target ? proxy : out;
      };
    },
  });
  return proxy;
}

function apply(plan: Plan, builder: unknown): unknown {
  if (plan.respond) return failingBuilder(plan.respond);
  return hookedBuilder(builder as object, plan);
}

/** `.from(table)` result wrapped so the matching `<op>(…)` call is the one intercepted. */
function wrapQueryBuilder(builder: object, table: string): unknown {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (typeof prop !== 'string' || !OPS.has(prop)) {
        return (...args: unknown[]) => Reflect.apply(value, target, args);
      }
      return (...args: unknown[]) => {
        const out: unknown = Reflect.apply(value, target, args);
        const plan = claim({ table, op: prop as DbOp });
        return plan ? apply(plan, out) : out;
      };
    },
  });
}

/** Every `SupabaseClient` prototype in play (supabase-js's own + the one behind an ssr client). */
function clientPrototypes(): ClientProto[] {
  const list: ClientProto[] = [SupabaseClient.prototype as unknown as ClientProto];
  const ssr = createSsrClient(
    requireTestEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireTestEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { cookies: { getAll: () => [], setAll: () => undefined } },
  );
  const proto = Object.getPrototypeOf(ssr) as ClientProto;
  if (!list.includes(proto)) list.push(proto);
  return list;
}

let spied: ClientProto[] = [];

function install(): void {
  if (installed) return;
  spied = clientPrototypes();
  for (const proto of spied) {
    const realFrom = proto.from;
    const realRpc = proto.rpc;
    vi.spyOn(proto, 'from').mockImplementation(function (this: unknown, ...args: unknown[]) {
      const builder: unknown = Reflect.apply(realFrom, this, args);
      if (suspended > 0 || plans.length === 0) return builder;
      return wrapQueryBuilder(builder as object, String(args[0]));
    });
    vi.spyOn(proto, 'rpc').mockImplementation(function (this: unknown, ...args: unknown[]) {
      const builder: unknown = Reflect.apply(realRpc, this, args);
      const plan = claim({ rpc: String(args[0]) });
      return plan ? apply(plan, builder) : builder;
    });
  }
  installed = true;
}

function uninstall(): void {
  if (!installed || plans.length > 0) return;
  for (const proto of spied) {
    vi.mocked(proto.from).mockRestore();
    vi.mocked(proto.rpc).mockRestore();
  }
  spied = [];
  installed = false;
}

function describeTarget(target: DbCallTarget): string {
  return 'rpc' in target ? `rpc ${target.rpc}` : `${target.table}.${target.op}`;
}

async function withPlan<T>(plan: Plan, fn: () => Promise<T>): Promise<T> {
  plans.push(plan);
  install();
  try {
    return await fn();
  } finally {
    plans.splice(plans.indexOf(plan), 1);
    uninstall();
    if (plan.fired === 0) {
      throw new Error(
        `dbFault: the plan on ${describeTarget(plan.target)} (nth ${String(plan.nth)}) never ` +
          `matched — ${plan.seen} matching call(s) were seen. Check the table/op/rpc name and nth.`,
      );
    }
  }
}

/** Runs `fn` with the nth `target` call answered by an error result (or `result` / `throws`). */
export async function withDbFault<T>(
  target: DbCallTarget,
  options: DbFaultOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const respond = (): Promise<unknown> => {
    if ('throws' in options) return Promise.reject(options.throws);
    if (options.result) {
      return Promise.resolve({
        data: options.result.data,
        error: options.result.error,
        count: options.result.count ?? null,
        status: 200,
        statusText: 'OK',
      });
    }
    return Promise.resolve({
      data: null,
      error: {
        name: 'PostgrestError',
        code: options.code ?? 'XX000',
        message: options.message ?? 'dbFault: injected failure',
        details: '',
        hint: '',
      },
      count: null,
      status: 500,
      statusText: 'Internal Server Error',
    });
  };
  return withPlan({ target, nth: options.nth ?? 1, seen: 0, fired: 0, respond }, fn);
}

/** Runs `fn` with `hook` spliced before (default) or after the nth real `target` call. */
export async function withDbHook<T>(
  target: DbCallTarget,
  hook: () => Promise<void>,
  fn: () => Promise<T>,
  options: DbHookOptions = {},
): Promise<T> {
  return withPlan(
    { target, nth: options.nth ?? 1, seen: 0, fired: 0, hook, when: options.when ?? 'before' },
    fn,
  );
}

/**
 * T-ACT-0 (1): `{ok:false, error:{code:'internal', message:'Something broke.'}}` and exactly one
 * `log.error` line `{action, id, msg:'unhandled'}` in `logs` (a `spyLog()` started before the call).
 * Returns that line's `meta` (e.g. `meta.name`, the thrown value's constructor or `typeof`).
 */
export function expectInternal<T>(
  res: ActionResult<T>,
  action: string,
  logs: LogSpy,
): Record<string, unknown> {
  const error = expectFail(res, 'internal');
  expect(error.message).toBe(INTERNAL_MESSAGE);
  expect(error.issues).toBeUndefined();
  const lines = (logs.lines as Array<Record<string, unknown>>).filter(
    (line) => line.level === 'error',
  );
  expect(lines, 'exactly one log.error line').toHaveLength(1);
  const [line] = lines;
  expect(line?.action).toBe(action);
  expect(line?.msg).toBe('unhandled');
  expect(String(line?.id)).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(line)).not.toMatch(/@localhost\.test|injected/);
  return (line?.meta ?? {}) as Record<string, unknown>;
}
