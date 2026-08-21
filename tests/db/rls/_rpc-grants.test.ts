/**
 * tests/db/rls/_rpc-grants.test.ts — T-RLS-129 (docs/build/05-test-plan.md §7.1): execute grants on
 * the RPCs, asserted in the catalog (`has_function_privilege`) AND behaviourally through PostgREST.
 *   check_handle(text)                              anon D · authenticated A
 *   rate_limit_ok(text,text,integer,interval)       anon/authenticated D · service A
 *   purge_rate_limit_hits(integer)                  anon/authenticated D · service A
 *   is_reserved_handle(text)                        anon/authenticated/service A — pure, immutable,
 *                                                   invoker rights (no table access), the one SQL copy
 *                                                   of the H3 list (ADR-0020)
 * Not yet in the schema (asserted absent so this file is revisited when they land):
 *   record_download, purge_project_downloads → S1.2 · can_comment → S1.4 · record_skin_download → S1.7.
 * Every table-reading RPC is `security definer` with `search_path = public` (01 INV-49); `is_reserved_handle`
 * reads no table and stays invoker-rights on purpose (ADR-0020).
 */
import { describe, expect, it } from 'vitest';
import { asRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';

const FUNCTIONS = {
  check_handle: 'public.check_handle(text)',
  rate_limit_ok: 'public.rate_limit_ok(text,text,integer,interval)',
  purge_rate_limit_hits: 'public.purge_rate_limit_hits(integer)',
  is_reserved_handle: 'public.is_reserved_handle(text)',
} as const;

function canExecute(role: 'anon' | 'authenticated' | 'service_role', fn: string): boolean {
  const value = sql(`select has_function_privilege('${role}', '${fn}', 'execute')`)[0]?.[0];
  return value === 't';
}

/** True when the function's ACL grants EXECUTE to PUBLIC (an `=X/owner` entry). */
function publicCanExecute(name: string): boolean {
  const rows = sql(
    `select coalesce(p.proacl::text, '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${name}'`,
  );
  expect(rows, `${name} must exist`).toHaveLength(1);
  const acl = rows[0]?.[0] ?? '';
  // A NULL ACL would mean the default (PUBLIC execute) — the migrations always revoke explicitly.
  expect(acl, `${name} must have an explicit ACL`).not.toBe('');
  return /(^\{|,)=X\//.test(acl);
}

describe('T-RLS-129 RPC grants (catalog)', () => {
  it('T-RLS-129 check_handle: anon denied, authenticated allowed, never PUBLIC', () => {
    expect(canExecute('anon', FUNCTIONS.check_handle)).toBe(false);
    expect(canExecute('authenticated', FUNCTIONS.check_handle)).toBe(true);
    expect(publicCanExecute('check_handle')).toBe(false);
  });

  it.each(['rate_limit_ok', 'purge_rate_limit_hits'] as const)(
    'T-RLS-129 %s: anon/authenticated denied, service_role allowed, never PUBLIC',
    (name) => {
      expect(canExecute('anon', FUNCTIONS[name])).toBe(false);
      expect(canExecute('authenticated', FUNCTIONS[name])).toBe(false);
      expect(canExecute('service_role', FUNCTIONS[name])).toBe(true);
      expect(publicCanExecute(name)).toBe(false);
    },
  );

  it('T-RLS-129 is_reserved_handle: every API role may call it, never PUBLIC; immutable SQL, invoker rights (ADR-0020)', () => {
    for (const role of ['anon', 'authenticated', 'service_role'] as const) {
      expect(canExecute(role, FUNCTIONS.is_reserved_handle), role).toBe(true);
    }
    expect(publicCanExecute('is_reserved_handle')).toBe(false);
    // Not security definer on purpose: it reads no table, so it is left out of the definer list below.
    const rows = sql(
      "select p.provolatile, p.prosecdef, l.lanname from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang where n.nspname = 'public' and p.proname = 'is_reserved_handle'",
    );
    expect(rows).toEqual([['i', 'f', 'sql']]);
  });

  it('T-RLS-129 every S1.1 RPC is security definer with search_path = public', () => {
    const rows = sql(
      "select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('check_handle','rate_limit_ok','purge_rate_limit_hits','handle_new_user') order by 1",
    );
    expect(rows.map(([name]) => name)).toEqual([
      'check_handle',
      'handle_new_user',
      'purge_rate_limit_hits',
      'rate_limit_ok',
    ]);
    for (const [name, secdef, config] of rows) {
      expect(secdef, `${name} security definer`).toBe('t');
      expect(config, `${name} search_path`).toContain('search_path=public');
    }
  });

  it('T-RLS-129 later-slice RPCs are not present yet (record_download/purge_project_downloads S1.2, can_comment S1.4, record_skin_download S1.7)', () => {
    const rows = sql(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('can_comment','record_download','record_skin_download','purge_project_downloads')",
    );
    expect(rows).toEqual([]);
  });
});

describe('T-RLS-129 RPC grants (behaviour through PostgREST)', () => {
  it('T-RLS-129 check_handle: anon key without a session is denied', async () => {
    const { data, error } = await asRole('anon').rpc('check_handle', { p_handle: 'seed_user' });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('T-RLS-129 is_reserved_handle answers anon and authenticated alike (ADR-0020)', async () => {
    for (const role of ['anon', 'user'] as const) {
      const reserved = await asRole(role).rpc('is_reserved_handle', { p_handle: 'OddSense' });
      expect(reserved.error, role).toBeNull();
      expect(reserved.data, role).toBe(true);
      const free = await asRole(role).rpc('is_reserved_handle', { p_handle: 'seed_user' });
      expect(free.error, role).toBeNull();
      expect(free.data, role).toBe(false);
    }
  });

  it('T-RLS-129 check_handle: authenticated callers get the four verdicts', async () => {
    const user = asRole('user');
    const verdict = async (p_handle: string): Promise<string | null> => {
      const { data, error } = await user.rpc('check_handle', { p_handle });
      expect(error).toBeNull();
      return data;
    };
    expect(await verdict('ab')).toBe('invalid'); // H1: too short
    expect(await verdict('a'.repeat(21))).toBe('invalid'); // H1: too long
    expect(await verdict('has-dash')).toBe('invalid'); // H1: charset
    expect(await verdict('admin')).toBe('reserved'); // H3
    expect(await verdict('oddsense')).toBe('reserved'); // H3 wins over "taken"
    expect(await verdict('seed_mod')).toBe('taken');
    expect(await verdict('SEED_MOD')).toBe('taken'); // H2: case-insensitive
    expect(await verdict('seed_user')).toBe('available'); // own handle is not "taken"
    expect(await verdict('t_free_handle')).toBe('available');

    // Every JWT role may call it (onboarding and renames need it), incl. the handle-less newbie.
    for (const role of ['nohandle', 'banned', 'mod', 'admin'] as const) {
      const { data, error } = await asRole(role).rpc('check_handle', { p_handle: 'seed_user2' });
      expect(error, role).toBeNull();
      expect(data).toBe('taken');
    }
  });

  it.each(['anon', 'user', 'mod', 'admin'] as const)(
    'T-RLS-129 %s cannot call rate_limit_ok / purge_rate_limit_hits',
    async (role) => {
      const client = asRole(role);
      const ok = await client.rpc('rate_limit_ok', {
        p_scope: 't_rls_129',
        p_key: role,
        p_max: 1,
        p_window: '1 minute',
      });
      expect(ok.error?.code).toBe('42501');
      expect(ok.data).toBeNull();
      const purge = await client.rpc('purge_rate_limit_hits', { p_days: 1 });
      expect(purge.error?.code).toBe('42501');
      expect(purge.data).toBeNull();
      // The denied call recorded nothing.
      expect(sql("select count(*) from public.rate_limit_hits where scope = 't_rls_129'")).toEqual([
        ['0'],
      ]);
    },
  );

  it('T-RLS-129 service can call rate_limit_ok and purge_rate_limit_hits', async () => {
    const service = asRole('service');
    const ok = await service.rpc('rate_limit_ok', {
      p_scope: 't_rls_129',
      p_key: 'service',
      p_max: 1,
      p_window: '1 minute',
    });
    expect(ok.error).toBeNull();
    expect(ok.data).toBe(true);
    const purge = await service.rpc('purge_rate_limit_hits', { p_days: 1 });
    expect(purge.error).toBeNull();
    expect(typeof purge.data).toBe('number');
    sql("delete from public.rate_limit_hits where scope = 't_rls_129'");
  });
});
