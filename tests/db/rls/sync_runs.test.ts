/**
 * tests/db/rls/sync_runs.test.ts — RLS matrix for `sync_runs`
 * (docs/build/05-test-plan.md §7.1 T-RLS-111..114; data-model §2.9/§4). Policies:
 * supabase/migrations/20260827090400_sync_runs.sql — select/update/delete = admin; insert has NO
 * grant and NO policy for JWT roles, so even admin is denied (T-RLS-112: rows are only ever created
 * by jobs through the service role, 04 SC-11) — the asymmetry vs update/delete is deliberate.
 * `source` is text with `sync_runs_source_check` on the 7 registry values (not an enum). Cell order
 * of every cell comment: anon | user | banned | mod | admin | svc.
 *
 * Seed rows (SEED-12, ids group 08) stay read-only (H-1): denied write cells target seed `…0801`
 * and are proven no-ops through `service`; allowed write cells use `makeSyncRun` factory rows
 * (removed by `cleanupFactories`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeSyncRun } from '@/tests/helpers/factories';
import { SEED_SYNC_RUNS } from '@/tests/helpers/seedIds';

const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');
const SEED_RUN_IDS = Object.values(SEED_SYNC_RUNS);

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-111 select — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-111 sync_runs select', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-111 %s cannot read sync runs', async (role) => {
    await expectPolicy({
      table: 'sync_runs',
      op: 'select',
      role,
      allowed: false,
      filter: { id: SEED_SYNC_RUNS.modrinth },
    });
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-111 %s reads the SEED-12 runs (one ok=true per source)',
    async (role) => {
      const { data, error } = await asRole(role).from('sync_runs').select('id, source, ok');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of SEED_RUN_IDS) expect(ids.has(id), id).toBe(true);
      expect(data?.find((r) => r.id === SEED_SYNC_RUNS.modrinth)?.source).toBe('modrinth');
      expect(data?.find((r) => r.id === SEED_SYNC_RUNS.modrinth)?.ok).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-112 insert — D | D | D | D | D | A (admin cannot insert directly; jobs use service)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-112 sync_runs insert', () => {
  it.each(['anon', ...NON_ADMIN, 'admin'] as const)(
    'T-RLS-112 %s cannot insert a sync run',
    async (role) => {
      const id = randomUUID();
      await expectPolicy({
        table: 'sync_runs',
        op: 'insert',
        role,
        allowed: false,
        row: { id, source: 'modrinth' },
      });
      const { data } = await service.from('sync_runs').select('id').eq('id', id);
      expect(data).toEqual([]);
    },
  );

  it('T-RLS-112 service inserts an open run (finished_at/ok/items stay NULL — the SC-11 lifecycle)', async () => {
    const id = randomUUID();
    await expectPolicy({
      table: 'sync_runs',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { id, source: 'modrinth' },
      expectRows: 1,
    });
    const { data } = await service
      .from('sync_runs')
      .select('finished_at, ok, items')
      .eq('id', id)
      .single();
    expect(data).toEqual({ finished_at: null, ok: null, items: null });
    const removed = await service.from('sync_runs').delete().eq('id', id).select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
  });

  it('T-RLS-112 an unknown source fails sync_runs_source_check even for service (23514, not RLS)', async () => {
    const { error } = await service.from('sync_runs').insert({ source: 't_bogus' });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23514'); // check_violation — the registry list is closed
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-113 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-113 sync_runs update', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-113 %s cannot update a sync run',
    async (role) => {
      await expectPolicy({
        table: 'sync_runs',
        op: 'update',
        role,
        allowed: false,
        filter: { id: SEED_SYNC_RUNS.modrinth },
        patch: { items: 999999 },
      });
      const { data } = await service
        .from('sync_runs')
        .select('items')
        .eq('id', SEED_SYNC_RUNS.modrinth)
        .single();
      expect(data?.items).toBe(18);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-113 %s updates a sync run (factory)',
    async (role) => {
      const id = await makeSyncRun({ source: 'modrinth' });
      await expectPolicy({
        table: 'sync_runs',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: { finished_at: new Date().toISOString(), ok: true, items: 0 },
        expectRows: 1,
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-114 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-114 sync_runs delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-114 %s cannot delete a sync run',
    async (role) => {
      await expectPolicy({
        table: 'sync_runs',
        op: 'delete',
        role,
        allowed: false,
        filter: { id: SEED_SYNC_RUNS.modrinth },
      });
      const { data } = await service
        .from('sync_runs')
        .select('id')
        .eq('id', SEED_SYNC_RUNS.modrinth);
      expect(data).toHaveLength(1);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-114 %s deletes a sync run (factory)',
    async (role) => {
      const id = await makeSyncRun({ source: 'modrinth' });
      await expectPolicy({
        table: 'sync_runs',
        op: 'delete',
        role,
        allowed: true,
        filter: { id },
        expectRows: 1,
      });
    },
  );
});
