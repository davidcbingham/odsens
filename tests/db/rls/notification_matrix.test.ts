/**
 * tests/db/rls/notification_matrix.test.ts — RLS matrix for `notification_matrix`
 * (docs/build/05-test-plan.md §7.1 T-RLS-98..101; data-model §2.6 / §4; docs/notifications.md
 * "Default matrix"; 05 SEED-2; ADR-0030 D10). Policies: supabase/migrations/
 * 20260903120000_notification_matrix.sql — select / insert / update = `is_admin()`; delete = NO policy
 * and no JWT delete grant (service only — T-RLS-101 admin = D). Cell order of every cell comment:
 * anon | user | banned | mod | admin | svc.
 *
 * The PK is (kind, channel) over the closed event catalog, so there is no factory row: the 16 seeded
 * rows are read-only truths (T-RLS-98 asserts them against `SEED_MATRIX`), the mutating cells use the
 * catalog's spare pairs — `comment.reply` / `comment.approved` (log-only kinds that never sit in the
 * grid) and the Phase 2 channels — and T-RLS-100 flips `enabled` on real rows. `mutatesSeed` (H-1):
 * `afterAll` restores SEED-2 through `restoreSeedMatrix` (extras removed, values re-asserted).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, loose, type TestRole } from '@/tests/helpers/asRole';
import { restoreSeedMatrix, SEED_MATRIX } from '@/tests/helpers/contentReset';
import { sql } from '@/tests/helpers/db';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import { expectPolicy } from '@/tests/helpers/expectPolicy';

const NON_ADMIN = ['anon', 'user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const NON_SERVICE = [...NON_ADMIN, 'admin'] as const satisfies readonly TestRole[];
const service = asRole('service');

const MATRIX_MIGRATION = path.join(
  REPO_ROOT,
  'supabase',
  'migrations',
  '20260903120000_notification_matrix.sql',
);

type Cell = { kind: string; channel: string; enabled: boolean };

const byKey = (a: Cell, b: Cell): number =>
  a.kind.localeCompare(b.kind) || a.channel.localeCompare(b.channel);

async function readMatrix(): Promise<Cell[]> {
  const { data, error } = await service
    .from('notification_matrix')
    .select('kind, channel, enabled');
  if (error) throw new Error(`service could not read notification_matrix: ${error.message}`);
  // Sorted here, not in SQL: `channel` is an enum, which PostgREST orders by declaration order.
  return (data ?? [])
    .map((row) => ({ kind: row.kind, channel: row.channel, enabled: row.enabled }))
    .sort(byKey);
}

async function readCell(kind: string, channel: 'email' | 'discord' | 'inapp' | 'push') {
  const { data, error } = await service
    .from('notification_matrix')
    .select('kind, channel, enabled, created_at, updated_at')
    .eq('kind', kind)
    .eq('channel', channel)
    .maybeSingle();
  if (error) throw new Error(`service could not read notification_matrix: ${error.message}`);
  return data;
}

async function countRows(): Promise<number> {
  const { count, error } = await service
    .from('notification_matrix')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`service could not count notification_matrix: ${error.message}`);
  return count ?? 0;
}

afterAll(restoreSeedMatrix);

// ---------------------------------------------------------------------------------------------
// T-RLS-98 the seed — exactly the docs/notifications.md default matrix, seeded by the migration
// ---------------------------------------------------------------------------------------------
describe('T-RLS-98 notification_matrix seed (SEED-2)', () => {
  it('T-RLS-98 the table holds exactly the 16 default rows of docs/notifications.md', async () => {
    const rows = await readMatrix();
    expect(rows).toHaveLength(16);
    expect(rows).toEqual([...SEED_MATRIX].map((row) => ({ ...row })).sort(byKey));
    // 8 kinds × (email, discord); the Phase 2 channels carry no rows.
    expect(new Set(rows.map((row) => row.kind)).size).toBe(8);
    expect(rows.every((row) => row.channel === 'email' || row.channel === 'discord')).toBe(true);
  });

  it('T-RLS-98 migration 20260903120000 alone seeds the 16 rows and re-applying keeps an admin choice (ADR-0030 D10)', async () => {
    expect(fs.existsSync(MATRIX_MIGRATION), MATRIX_MIGRATION).toBe(true);
    const migration = fs.readFileSync(MATRIX_MIGRATION, 'utf8');
    expect(migration).toMatch(
      /insert\s+into\s+public\.notification_matrix\s*\(\s*kind\s*,\s*channel\s*,\s*enabled\s*\)\s*values[\s\S]*?on\s+conflict\s*\(\s*kind\s*,\s*channel\s*\)\s*do\s+nothing/i,
    );

    // A fresh production / staging database: the migration is the only source of the rows.
    sql('delete from public.notification_matrix');
    expect(await countRows()).toBe(0);
    sql(migration);
    expect(await readMatrix()).toEqual([...SEED_MATRIX].map((row) => ({ ...row })).sort(byKey));

    // A later deploy re-applies nothing over an admin's choice (`do nothing`).
    sql(
      "update public.notification_matrix set enabled = false where kind = 'comment.new' and channel = 'email'",
    );
    sql(migration);
    expect((await readCell('comment.new', 'email'))?.enabled).toBe(false);
    expect(await countRows()).toBe(16);

    await restoreSeedMatrix();
    expect((await readCell('comment.new', 'email'))?.enabled).toBe(true);
  });

  it('T-RLS-98 the kind CHECK is the permanent catalog and channel is the enum (23514 / 22P02)', async () => {
    const badKind = await service
      .from('notification_matrix')
      .insert({ kind: 'comment.unknown', channel: 'email' });
    expect(badKind.error?.code).toBe('23514');
    const badChannel = await loose(service)
      .from('notification_matrix')
      .insert({ kind: 'comment.reply', channel: 'sms' });
    expect(badChannel.error?.code).toBe('22P02');
    expect(await countRows()).toBe(16);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-98 select — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-98 notification_matrix select', () => {
  it.each(NON_ADMIN)('T-RLS-98 %s cannot read the grid', async (role) => {
    await expectPolicy({
      table: 'notification_matrix',
      op: 'select',
      role,
      allowed: false,
      filter: { kind: 'comment.new', channel: 'email' },
    });
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-98 %s reads a cell and the whole grid',
    async (role) => {
      await expectPolicy({
        table: 'notification_matrix',
        op: 'select',
        role,
        allowed: true,
        filter: { kind: 'comment.new', channel: 'email' },
        expectRows: 1,
      });
      const { data, error } = await asRole(role)
        .from('notification_matrix')
        .select('kind, channel, enabled');
      expect(error).toBeNull();
      expect(data).toHaveLength(16);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-99 insert — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-99 notification_matrix insert', () => {
  it.each(NON_ADMIN)('T-RLS-99 %s cannot insert a cell', async (role) => {
    const before = await countRows();
    await expectPolicy({
      table: 'notification_matrix',
      op: 'insert',
      role,
      allowed: false,
      row: { kind: 'comment.reply', channel: 'discord', enabled: false },
    });
    expect(await countRows()).toBe(before);
    expect(await readCell('comment.reply', 'discord')).toBeNull();
  });

  it('T-RLS-99 admin inserts a spare (kind, channel) cell', async () => {
    await expectPolicy({
      table: 'notification_matrix',
      op: 'insert',
      role: 'admin',
      allowed: true,
      row: { kind: 'comment.reply', channel: 'email', enabled: false },
      expectRows: 1,
    });
    expect((await readCell('comment.reply', 'email'))?.enabled).toBe(false);
  });

  it('T-RLS-99 admin cannot duplicate a seeded cell (PK, 23505)', async () => {
    const { error } = await asRole('admin')
      .from('notification_matrix')
      .insert({ kind: 'comment.new', channel: 'email', enabled: false });
    expect(error?.code).toBe('23505');
    expect((await readCell('comment.new', 'email'))?.enabled).toBe(true);
  });

  it('T-RLS-99 service inserts a cell (enabled defaults to false)', async () => {
    await expectPolicy({
      table: 'notification_matrix',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { kind: 'comment.approved', channel: 'inapp' },
      expectRows: 1,
    });
    expect((await readCell('comment.approved', 'inapp'))?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-100 update `enabled` — D | D | D | D | A | A (mutatesSeed — restored per case + afterAll)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-100 notification_matrix update enabled', () => {
  it.each(NON_ADMIN)('T-RLS-100 %s cannot flip a switch', async (role) => {
    await expectPolicy({
      table: 'notification_matrix',
      op: 'update',
      role,
      allowed: false,
      filter: { kind: 'comment.new', channel: 'email' },
      patch: { enabled: false },
    });
    expect((await readCell('comment.new', 'email'))?.enabled).toBe(true);
  });

  it('T-RLS-100 admin flips comment.new × email OFF (updated_at moves) and back', async () => {
    const before = await readCell('comment.new', 'email');
    await expectPolicy({
      table: 'notification_matrix',
      op: 'update',
      role: 'admin',
      allowed: true,
      filter: { kind: 'comment.new', channel: 'email' },
      patch: { enabled: false },
      expectRows: 1,
    });
    const after = await readCell('comment.new', 'email');
    expect(after?.enabled).toBe(false);
    expect(new Date(after?.updated_at ?? 0).getTime()).toBeGreaterThan(
      new Date(before?.updated_at ?? 0).getTime(),
    );
    expect(after?.created_at).toBe(before?.created_at);
    await restoreSeedMatrix();
    expect((await readCell('comment.new', 'email'))?.enabled).toBe(true);
  });

  it('T-RLS-100 service flips sync.failed × discord ON and back', async () => {
    await expectPolicy({
      table: 'notification_matrix',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { kind: 'sync.failed', channel: 'discord' },
      patch: { enabled: true },
      expectRows: 1,
    });
    expect((await readCell('sync.failed', 'discord'))?.enabled).toBe(true);
    await restoreSeedMatrix();
    expect((await readCell('sync.failed', 'discord'))?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-101 delete — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-101 notification_matrix delete', () => {
  it.each(NON_SERVICE)('T-RLS-101 %s cannot delete a cell', async (role) => {
    await expectPolicy({
      table: 'notification_matrix',
      op: 'delete',
      role,
      allowed: false,
      filter: { kind: 'tip.new', channel: 'discord' },
    });
    expect(await readCell('tip.new', 'discord')).not.toBeNull();
    expect(await countRows()).toBeGreaterThanOrEqual(16);
  });

  it('T-RLS-101 service deletes a cell (a spare one it arranges first — T-RLS-100’s restore already removed the T-RLS-99 extras)', async () => {
    const arranged = await service
      .from('notification_matrix')
      .upsert({ kind: 'comment.approved', channel: 'inapp', enabled: false })
      .select('kind');
    expect(arranged.error).toBeNull();
    await expectPolicy({
      table: 'notification_matrix',
      op: 'delete',
      role: 'service',
      allowed: true,
      filter: { kind: 'comment.approved', channel: 'inapp' },
      expectRows: 1,
    });
    expect(await readCell('comment.approved', 'inapp')).toBeNull();
  });
});
