/**
 * tests/db/rls/stats_daily.test.ts — RLS matrix for `stats_daily`
 * (docs/build/05-test-plan.md §7.1 T-RLS-107..110; data-model §2.9/§4). Policies:
 * supabase/migrations/20260926120000_stats_daily.sql — select/update/delete = admin; insert has NO
 * grant and NO policy for JWT roles, so even admin is denied (T-RLS-108: rows are only ever written
 * by `snapshotStats` through the service role, 04 §3.5) — the `sync_runs` asymmetry (T-RLS-112),
 * deliberate (ADR-0049 D2). `metric` / `source` / `entity_type` are text with CHECKs on the closed registry
 * lists (not enums); the PK is the 04 §3.5 idempotency key (day, metric, source, entity_type,
 * entity_id) and the job's `on conflict … do update set value` arm is asserted through `service`.
 * Cell order of every cell comment: anon | user | banned | mod | admin | svc.
 *
 * Seed rows (SEED-12 — six site `downloads` rows over two UTC days, ADR-0049 D4) stay read-only (H-1):
 * denied write cells target today's modrinth site row and are proven no-ops through `service`;
 * allowed write cells use `t_`-style rows inserted through `service` on a day no reader window
 * reaches (`2000-01-01`) and removed in the same test (`afterAll` sweeps that day as a safety net).
 * The seed's "today" is read back through `service` (the newest day) rather than computed, so the
 * file holds across a UTC midnight after the reset.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy } from '@/tests/helpers/expectPolicy';

/** Registry "Conventions" site / channel sentinel (= `lib/stats.ts` `SITE_ENTITY_ID` — ADR-0049 D1). */
const SITE_ENTITY_ID = '00000000-0000-0000-0000-000000000000';
/** A day outside every read window (ADR-0049 D11: 38 days) — the arranged rows never reach a tile. */
const T_DAY = '2000-01-01';

const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');

type StatsKey = {
  day: string;
  metric: string;
  source: string;
  entity_type: string;
  entity_id: string;
};

/** ADR-0049 D4: today = the SEED-4 live totals; yesterday = today − (40, 3, 2). */
const SEED_TODAY = { modrinth: 4099, curseforge: 120, direct: 7 } as const;
const SEED_YESTERDAY = { modrinth: 4059, curseforge: 117, direct: 5 } as const;

let seedToday: string;
let seedYesterday: string;
/** Today's modrinth site row — the denied write cells' target. */
let seedKey: StatsKey;

/** UTC day arithmetic on 'YYYY-MM-DD' (never a local getter — 01 INV-68). */
function addUtcDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

async function readValue(key: StatsKey): Promise<number | null> {
  const { data, error } = await service
    .from('stats_daily')
    .select('value')
    .match(key)
    .maybeSingle();
  if (error) throw new Error(`stats_daily read failed: ${error.message}`);
  return data?.value ?? null;
}

/** A fresh arranged row through `service` (the production writer); returns its key. */
async function insertRow(overrides: Partial<StatsKey> = {}, value = 1): Promise<StatsKey> {
  const key: StatsKey = {
    day: T_DAY,
    metric: 'downloads',
    source: 'direct',
    entity_type: 'project',
    entity_id: randomUUID(),
    ...overrides,
  };
  const { error } = await service.from('stats_daily').insert({ ...key, value });
  if (error) throw new Error(`arrange: stats_daily insert failed: ${error.message}`);
  return key;
}

async function removeRow(key: StatsKey): Promise<void> {
  const { error } = await service.from('stats_daily').delete().match(key);
  if (error) throw new Error(`cleanup: stats_daily delete failed: ${error.message}`);
}

beforeAll(async () => {
  const { data, error } = await service
    .from('stats_daily')
    .select('day, source, value')
    .eq('entity_type', 'site')
    .eq('entity_id', SITE_ENTITY_ID)
    .eq('metric', 'downloads')
    .order('day', { ascending: false })
    .order('source');
  if (error) throw new Error(`arrange: seed read failed: ${error.message}`);
  const days = [...new Set((data ?? []).map((row) => row.day))];
  expect(days, 'SEED-12 stats_daily spans exactly two days').toHaveLength(2);
  seedToday = days[0] ?? '';
  seedYesterday = days[1] ?? '';
  seedKey = {
    day: seedToday,
    metric: 'downloads',
    source: 'modrinth',
    entity_type: 'site',
    entity_id: SITE_ENTITY_ID,
  };
});

afterAll(async () => {
  // Safety net: nothing of this file's arranging survives on the arranged day.
  const { error } = await service.from('stats_daily').delete().eq('day', T_DAY);
  if (error) throw new Error(`cleanup: stats_daily sweep failed: ${error.message}`);
});

// ---------------------------------------------------------------------------------------------
// T-RLS-107 select — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-107 stats_daily select', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-107 %s cannot read stats rows', async (role) => {
    await expectPolicy({
      table: 'stats_daily',
      op: 'select',
      role,
      allowed: false,
      filter: seedKey,
    });
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-107 %s reads the SEED-12 pair (six site downloads rows, two consecutive UTC days — ADR-0049 D4)',
    async (role) => {
      const { data, error } = await asRole(role)
        .from('stats_daily')
        .select('day, metric, source, entity_type, entity_id, value')
        .eq('entity_type', 'site')
        .eq('metric', 'downloads');
      expect(error).toBeNull();
      const rows = (data ?? []).filter((row) => row.day === seedToday || row.day === seedYesterday);
      expect(rows).toHaveLength(6);
      for (const row of rows) expect(row.entity_id).toBe(SITE_ENTITY_ID);
      const valueOf = (day: string, source: string): number | undefined =>
        rows.find((row) => row.day === day && row.source === source)?.value;
      for (const source of ['modrinth', 'curseforge', 'direct'] as const) {
        expect(valueOf(seedToday, source), `today ${source}`).toBe(SEED_TODAY[source]);
        expect(valueOf(seedYesterday, source), `yesterday ${source}`).toBe(SEED_YESTERDAY[source]);
      }
      expect(addUtcDays(seedYesterday, 1)).toBe(seedToday);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-108 insert — D | D | D | D | D | A (admin cannot insert directly; the job uses service)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-108 stats_daily insert', () => {
  it.each(['anon', ...NON_ADMIN, 'admin'] as const)(
    'T-RLS-108 %s cannot insert a stats row',
    async (role) => {
      const key: StatsKey = {
        day: T_DAY,
        metric: 'downloads',
        source: 'direct',
        entity_type: 'project',
        entity_id: randomUUID(),
      };
      await expectPolicy({
        table: 'stats_daily',
        op: 'insert',
        role,
        allowed: false,
        row: { ...key, value: 1 },
      });
      expect(await readValue(key)).toBeNull();
    },
  );

  it('T-RLS-108 service inserts a row; the same key again is 23505, and the job’s upsert arm rewrites `value` in place (04 §3.5)', async () => {
    const key: StatsKey = {
      day: T_DAY,
      metric: 'downloads',
      source: 'direct',
      entity_type: 'project',
      entity_id: randomUUID(),
    };
    await expectPolicy({
      table: 'stats_daily',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { ...key, value: 1 },
      expectRows: 1,
    });
    const duplicate = await service.from('stats_daily').insert({ ...key, value: 2 });
    expect(duplicate.error?.code).toBe('23505'); // unique_violation — the PK is the idempotency key
    expect(await readValue(key)).toBe(1);

    const upsert = await service
      .from('stats_daily')
      .upsert({ ...key, value: 2 }, { onConflict: 'day,metric,source,entity_type,entity_id' })
      .select('value');
    expect(upsert.error).toBeNull();
    expect(upsert.data).toEqual([{ value: 2 }]);
    const { data: all } = await service.from('stats_daily').select('value').match(key);
    expect(all).toEqual([{ value: 2 }]); // still one row
    await removeRow(key);
  });

  it.each([
    ['an unknown metric', { metric: 't_bogus' }],
    ['an unknown source', { source: 't_bogus' }],
    ['an unknown entity_type', { entity_type: 't_bogus' }],
    ['a negative value', { value: -1 }],
  ] as const)(
    'T-RLS-108 %s fails its CHECK even for service (23514, not RLS — the registry lists are closed)',
    async (_label, patch) => {
      const { error } = await service.from('stats_daily').insert({
        day: T_DAY,
        metric: 'downloads',
        source: 'direct',
        entity_type: 'project',
        entity_id: randomUUID(),
        value: 1,
        ...patch,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('23514'); // check_violation
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-109 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-109 stats_daily update', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-109 %s cannot update a stats row',
    async (role) => {
      await expectPolicy({
        table: 'stats_daily',
        op: 'update',
        role,
        allowed: false,
        filter: seedKey,
        patch: { value: 999999 },
      });
      expect(await readValue(seedKey)).toBe(SEED_TODAY.modrinth);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-109 %s updates a stats row (arranged) and the trigger stamps updated_at (01 INV-97)',
    async (role) => {
      const key = await insertRow();
      const before = await service
        .from('stats_daily')
        .select('created_at, updated_at')
        .match(key)
        .single();
      expect(before.data?.updated_at).toBe(before.data?.created_at);
      await expectPolicy({
        table: 'stats_daily',
        op: 'update',
        role,
        allowed: true,
        filter: key,
        patch: { value: 42 },
        expectRows: 1,
      });
      const after = await service
        .from('stats_daily')
        .select('value, created_at, updated_at')
        .match(key)
        .single();
      expect(after.data?.value).toBe(42);
      expect(Date.parse(after.data?.updated_at ?? '')).toBeGreaterThan(
        Date.parse(after.data?.created_at ?? ''),
      );
      await removeRow(key);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-110 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-110 stats_daily delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-110 %s cannot delete a stats row',
    async (role) => {
      await expectPolicy({
        table: 'stats_daily',
        op: 'delete',
        role,
        allowed: false,
        filter: seedKey,
      });
      expect(await readValue(seedKey)).toBe(SEED_TODAY.modrinth);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-110 %s deletes a stats row (arranged)',
    async (role) => {
      const key = await insertRow();
      await expectPolicy({
        table: 'stats_daily',
        op: 'delete',
        role,
        allowed: true,
        filter: key,
        expectRows: 1,
      });
      expect(await readValue(key)).toBeNull();
    },
  );
});
