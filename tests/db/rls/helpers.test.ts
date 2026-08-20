/**
 * tests/db/rls/helpers.test.ts — T-RLS-124 (docs/build/05-test-plan.md §7.1) for the S0 helpers
 * migration (supabase/migrations/*_helpers.sql): `public.is_admin()`, `public.is_moderator()`,
 * `public.set_updated_at()`.
 *
 * S0 asserts what exists today: both role helpers are callable by anon and service and return false
 * (no JWT sub → the auth.uid() guard short-circuits before touching `profiles`), and the trigger
 * function is present in the catalog.
 * TODO(S1.1): when SEED-3 lands (`auth.users` + `profiles`), assert the full matrix here —
 *   is_admin: admin → true; mod/user/banned → false · is_moderator: mod + admin → true; user/banned → false.
 */
import { describe, expect, it } from 'vitest';
import { asRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';

describe('T-RLS-124 role helpers', () => {
  it('T-RLS-124 is_admin() and is_moderator() are false for anon (no error)', async () => {
    const anon = asRole('anon');
    const admin = await anon.rpc('is_admin');
    expect(admin.error).toBeNull();
    expect(admin.data).toBe(false);
    const mod = await anon.rpc('is_moderator');
    expect(mod.error).toBeNull();
    expect(mod.data).toBe(false);
  });

  it('T-RLS-124 is_admin() and is_moderator() are callable by service and false without a session', async () => {
    const service = asRole('service');
    const admin = await service.rpc('is_admin');
    expect(admin.error).toBeNull();
    expect(admin.data).toBe(false);
    const mod = await service.rpc('is_moderator');
    expect(mod.error).toBeNull();
    expect(mod.data).toBe(false);
  });

  it('T-RLS-124 helpers are security definer + stable, and set_updated_at() exists', () => {
    const rows = sql(
      "select p.proname, p.prosecdef, p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('is_admin','is_moderator','set_updated_at') order by 1",
    );
    const byName = new Map(
      rows.map(([name, secdef, volatility]) => [name, { secdef, volatility }]),
    );
    expect(byName.get('is_admin')).toEqual({ secdef: 't', volatility: 's' });
    expect(byName.get('is_moderator')).toEqual({ secdef: 't', volatility: 's' });
    expect(byName.has('set_updated_at')).toBe(true);
  });
});
