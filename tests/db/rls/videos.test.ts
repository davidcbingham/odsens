/**
 * tests/db/rls/videos.test.ts — RLS matrix for `videos` (docs/build/05-test-plan.md §7.1
 * T-RLS-48..52; data-model §4 row "videos, skins, art": published to all; admin all). Policies:
 * supabase/migrations/20260918120000_videos.sql — select = `hidden = false` or `is_admin()`;
 * insert/update/delete = admin only (direct table access is A for admin here, unlike `sync_runs`);
 * `syncYoutube` / `updateVideo` writes bypass RLS via service. Cell order of every cell comment:
 * anon | user | banned | mod | admin | svc.
 *
 * Select cells read the SEED-11 rows (7 — ADR-0043 D8): six visible, `seedvid0002` hidden. Seed rows
 * stay read-only (H-1): denied write cells target seed `seedvid0001` and are proven no-ops through
 * `service`; allowed write cells use factory rows (`makeVideo`), removed by `cleanupFactories`.
 * `is_short_override` (ADR-0043 D1) rides the same row policies — no column-level rule — and the
 * shared `set_updated_at()` trigger (01 INV-97) is proven under T-RLS-51 (no new id, H-13).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy, type RowValues } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, factoryYoutubeId, makeVideo } from '@/tests/helpers/factories';
import { SEED_VIDEOS } from '@/tests/helpers/seedIds';

/** Signed-in, non-admin roles — every cell below is identical for them (mod is plain D on writes, ADR-0002 C7). */
const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');

const HIDDEN_YOUTUBE_ID = SEED_VIDEOS.hiddenLong.youtubeId;
const VISIBLE_YOUTUBE_IDS = Object.values(SEED_VIDEOS)
  .map((video) => video.youtubeId)
  .filter((youtubeId) => youtubeId !== HIDDEN_YOUTUBE_ID);
const SEED_TITLE = 'Seed Long Video One';

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-48 select hidden=false — pub | pub | pub | pub | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-48 videos select hidden=false', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-48 %s sees the six visible seed rows and never a hidden one',
    async (role) => {
      const { data, error } = await asRole(role).from('videos').select('youtube_id, hidden');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.youtube_id));
      expect(VISIBLE_YOUTUBE_IDS).toHaveLength(6);
      for (const youtubeId of VISIBLE_YOUTUBE_IDS) expect(ids.has(youtubeId), youtubeId).toBe(true);
      expect(ids.has(HIDDEN_YOUTUBE_ID)).toBe(false);
      for (const row of data ?? []) expect(row.hidden).toBe(false);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-48 %s sees every seed row incl. the hidden one',
    async (role) => {
      const { data, error } = await asRole(role).from('videos').select('youtube_id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.youtube_id));
      for (const youtubeId of [...VISIBLE_YOUTUBE_IDS, HIDDEN_YOUTUBE_ID]) {
        expect(ids.has(youtubeId), youtubeId).toBe(true);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-49 select hidden=true (seed `seedvid0002`) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-49 videos select hidden=true (seed seedvid0002)', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-49 %s cannot see the hidden seed row',
    async (role) => {
      await expectPolicy({
        table: 'videos',
        op: 'select',
        role,
        allowed: false,
        filter: { youtube_id: HIDDEN_YOUTUBE_ID },
      });
    },
  );

  it.each(['admin', 'service'] as const)('T-RLS-49 %s reads the hidden seed row', async (role) => {
    await expectPolicy({
      table: 'videos',
      op: 'select',
      role,
      allowed: true,
      filter: { youtube_id: HIDDEN_YOUTUBE_ID },
      expectRows: 1,
    });
  });

  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-49 %s cannot see a hidden factory row either (not a seed-only rule)',
    async (role) => {
      const id = await makeVideo({ hidden: true });
      await expectPolicy({ table: 'videos', op: 'select', role, allowed: false, filter: { id } });
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-50 insert — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
function videoRow(id: string): RowValues {
  const youtubeId = factoryYoutubeId(id);
  return {
    id,
    youtube_id: youtubeId,
    title: `t_rls50_${youtubeId}`,
    thumbnail_url: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    published_at: '2026-01-02T12:00:00.000Z',
  };
}

describe('T-RLS-50 videos insert', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-50 %s cannot insert a video', async (role) => {
    const id = randomUUID();
    await expectPolicy({ table: 'videos', op: 'insert', role, allowed: false, row: videoRow(id) });
    const { data } = await service.from('videos').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-50 %s inserts an RSS-minimal video (defaults: visible, not a short, no override)',
    async (role) => {
      const id = randomUUID();
      await expectPolicy({
        table: 'videos',
        op: 'insert',
        role,
        allowed: true,
        row: videoRow(id),
        expectRows: 1,
      });
      const removed = await service
        .from('videos')
        .delete()
        .eq('id', id)
        .select(
          'hidden, is_short, is_short_override, description, duration_seconds, view_count, like_count',
        );
      expect(removed.error).toBeNull();
      expect(removed.data).toEqual([
        {
          hidden: false,
          is_short: false,
          is_short_override: null,
          description: null,
          duration_seconds: null,
          view_count: null,
          like_count: null,
        },
      ]);
    },
  );

  it('T-RLS-50 service cannot insert a second row with the same youtube_id or a malformed one', async () => {
    const duplicate = await service
      .from('videos')
      .insert({
        youtube_id: SEED_VIDEOS.long.youtubeId,
        title: 't_rls50_duplicate',
        thumbnail_url: 'https://i.ytimg.com/vi/seedvid0001/hqdefault.jpg',
        published_at: '2026-01-02T12:00:00.000Z',
      })
      .select('id');
    expect(duplicate.error?.code).toBe('23505'); // videos_youtube_id_key
    // videos_youtube_id_format = `updateVideoInput`'s regex (04 §1.8): 12 chars, then a bad char.
    for (const youtubeId of ['t_twelve_chr', 't_bad.char0']) {
      const result = await service
        .from('videos')
        .insert({
          youtube_id: youtubeId,
          title: 't_rls50_malformed',
          thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
          published_at: '2026-01-02T12:00:00.000Z',
        })
        .select('id');
      expect(result.error?.code, youtubeId).toBe('23514'); // videos_youtube_id_format
    }
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-51 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-51 videos update', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-51 %s cannot update a video', async (role) => {
    await expectPolicy({
      table: 'videos',
      op: 'update',
      role,
      allowed: false,
      filter: { youtube_id: SEED_VIDEOS.long.youtubeId },
      patch: { title: 't_rls51', hidden: true },
    });
    const { data } = await service
      .from('videos')
      .select('title, hidden')
      .eq('id', SEED_VIDEOS.long.id)
      .single();
    expect(data).toEqual({ title: SEED_TITLE, hidden: false });
  });

  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-51 %s cannot un-hide the hidden seed row',
    async (role) => {
      await expectPolicy({
        table: 'videos',
        op: 'update',
        role,
        allowed: false,
        filter: { youtube_id: HIDDEN_YOUTUBE_ID },
        patch: { hidden: false },
      });
      const { data } = await service
        .from('videos')
        .select('hidden')
        .eq('id', SEED_VIDEOS.hiddenLong.id)
        .single();
      expect(data?.hidden).toBe(true);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-51 %s updates a video (factory) and the updated_at trigger moves',
    async (role) => {
      const id = await makeVideo();
      const before = await service.from('videos').select('updated_at').eq('id', id).single();
      await expectPolicy({
        table: 'videos',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: { hidden: true, is_short: true, is_short_override: true },
        expectRows: 1,
      });
      const after = await service
        .from('videos')
        .select('hidden, is_short, is_short_override, updated_at')
        .eq('id', id)
        .single();
      expect(after.data?.hidden).toBe(true);
      expect(after.data?.is_short).toBe(true);
      expect(after.data?.is_short_override).toBe(true);
      expect(Date.parse(after.data?.updated_at ?? '')).toBeGreaterThan(
        Date.parse(before.data?.updated_at ?? ''),
      );
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-52 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-52 videos delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-52 %s cannot delete a video', async (role) => {
    await expectPolicy({
      table: 'videos',
      op: 'delete',
      role,
      allowed: false,
      filter: { youtube_id: SEED_VIDEOS.long.youtubeId },
    });
    const { data } = await service.from('videos').select('id').eq('id', SEED_VIDEOS.long.id);
    expect(data).toHaveLength(1);
  });

  it.each(['admin', 'service'] as const)('T-RLS-52 %s deletes a video (factory)', async (role) => {
    const id = await makeVideo();
    await expectPolicy({
      table: 'videos',
      op: 'delete',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
  });
});
