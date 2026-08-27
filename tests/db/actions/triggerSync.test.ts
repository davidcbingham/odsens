/**
 * tests/db/actions/triggerSync.test.ts — T-ACT-42 + the `triggerSync` clause of T-ACT-70
 * (05 §7.2; 04 §1.7, SC-13, SC-24; 01 INV-72; ADR-0002 C7 / C16; migration 20260827090400).
 * `mutatesSeed`: the admin run is a real `syncCurseforge` pass (no-change against the SEED-6
 * fixture-mirroring link, so only `synced_at` moves and one `sync_runs` row lands) — content
 * tables restore from a snapshot in `afterAll` (05 H-1).
 *
 * Auth: admin A, **mod D `forbidden`**, user D `forbidden` (ADR-0002 C7), anon `unauthenticated`.
 * Input: `source` ∈ the five triggerable values — `notify`, `skins` (a `sync_runs` source with no
 * standalone job) and unknown strings → `validation`; `full:true` accepted only for `youtube`.
 * The admin call runs the job function directly (adapter `fetch` mocked to fixtures — never the
 * HTTP route, 01 INV-72), returns the `JobSummary` as `data`, writes `sync_runs`, and logs the
 * SC-24 audit line. An open run (5 min old) → D `conflict` "Already running." with no second row
 * (T-ACT-70; the job/route sides live in tests/db/jobs/). `youtube`/`mentions`/`stats` are enum-
 * valid but their jobs land in S1.6/S1.8/S1.9 — until then the action answers `upstream_error`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { triggerSync } from '@/lib/actions/admin';
import type { TriggerSyncInput } from '@/lib/actions/admin.schema';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { cleanupFactories, makeSyncRun } from '@/tests/helpers/factories';
import { spyFetch, spyLog } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const CF_BASE = process.env.CURSEFORGE_API_BASE ?? '';
const MOD_URL = `${CF_BASE}/mods/900001`;

let snapshot: ContentSnapshot;

beforeAll(async () => {
  snapshot = await snapshotContentTables();
});

afterAll(async () => {
  await restoreContentTables(snapshot);
  await cleanupFactories();
});

async function syncRunCount(source: string): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', source);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

describe('T-ACT-42 triggerSync', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: sync is admin-only; moderators get `forbidden`.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-42 $role → $code, no sync_runs row written', async ({ role, code, message }) => {
    const before = await syncRunCount('modrinth');
    const error = expectFail(await callAction(triggerSync, { source: 'modrinth' }, { role }), code);
    expect(error.message).toBe(message);
    expect(await syncRunCount('modrinth')).toBe(before);
  });

  it.each<{ name: string; input: TriggerSyncInput }>([
    {
      name: "source 'notify' (not triggerable, 04 §1.7)",
      input: { source: 'notify' } as unknown as TriggerSyncInput,
    },
    {
      name: "source 'skins' (a sync_runs source, not a job)",
      input: { source: 'skins' } as unknown as TriggerSyncInput,
    },
    { name: "unknown source 'bogus'", input: { source: 'bogus' } as unknown as TriggerSyncInput },
    { name: 'full:true for modrinth (youtube only)', input: { source: 'modrinth', full: true } },
    {
      name: 'full:true for curseforge (youtube only)',
      input: { source: 'curseforge', full: true },
    },
  ])('T-ACT-42 $name → validation', async ({ input }) => {
    expectFail(await callAction(triggerSync, input, { role: 'admin' }), 'validation');
  });

  it('T-ACT-42 full:true for youtube passes the schema (S1.6 lands syncYoutube — upstream_error until then)', async () => {
    const error = expectFail(
      await callAction(triggerSync, { source: 'youtube', full: true }, { role: 'admin' }),
      'upstream_error',
    );
    expect(error.message).toBe("That sync isn't built yet.");
  });

  it('T-ACT-42 admin runs the job function directly → {ok:true, data:<JobSummary>}, sync_runs written, SC-24', async () => {
    const before = await syncRunCount('curseforge');
    const fetchSpy = spyFetch({ [MOD_URL]: 'curseforge/mod.json' });
    const logs = spyLog();
    try {
      const summary = expectOk(
        await callAction(triggerSync, { source: 'curseforge' }, { role: 'admin' }),
      );
      expect(summary.ok).toBe(true);
      expect(summary.source).toBe('curseforge');
      expect(typeof summary.run_id).toBe('string');
      expect(typeof summary.items).toBe('number');
      expect(typeof summary.ms).toBe('number');

      // The job ran for real: one finalized `sync_runs` row, adapter fetch hit the fixture.
      expect(await syncRunCount('curseforge')).toBe(before + 1);
      const { data: run, error } = await service
        .from('sync_runs')
        .select('source, finished_at, ok')
        .eq('id', summary.run_id)
        .single();
      expect(error).toBeNull();
      expect(run?.source).toBe('curseforge');
      expect(run?.finished_at).not.toBeNull();
      expect(run?.ok).toBe(true);
      expect(fetchSpy.calls).toContain(MOD_URL);

      // SC-24: keys only.
      const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.msg === 'admin',
      );
      expect(adminLines).toHaveLength(1);
      const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
      expect(line.action).toBe('triggerSync');
      expect(Object.keys(line.meta).sort()).toEqual([
        'actor_profile_id',
        'fields',
        'target_id',
        'target_type',
      ]);
      expect(line.meta.actor_profile_id).toBe(SEED_ROLE_IDS.admin);
      expect(line.meta.target_type).toBe('sync_run');
      expect(line.meta.target_id).toBe(summary.run_id);
      expect(line.meta.fields).toEqual(['source']);
    } finally {
      logs.restore();
      fetchSpy.restore();
    }
  });

  it("T-ACT-70 open run (5 min old) → conflict 'Already running.', no second row", async () => {
    await makeSyncRun({
      source: 'curseforge',
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      finished_at: null,
    });
    const withLock = await syncRunCount('curseforge');

    const error = expectFail(
      await callAction(triggerSync, { source: 'curseforge' }, { role: 'admin' }),
      'conflict',
    );
    expect(error.message).toBe('Already running.');
    expect(await syncRunCount('curseforge')).toBe(withLock);
  });
});
