/**
 * tests/db/actions/updateVideo.test.ts — T-ACT-68 (05 §7.2; 04 §1.8 `updateVideo`; ADR-0002 #20 /
 * C7; ADR-0043 D1; 00 S1.6.AC7; migration 20260918120000). Carries the SC-24 audit-line assertion
 * T-ACT-69 lists for this action.
 *
 * Auth matrix on the 05 cell's input `{youtube_id:'seedvid0001', hidden:true}`: anon
 * `unauthenticated` · user D `forbidden` · banned D `forbidden` (the seed banned account has role
 * `user`, so `requireRole`'s rank check answers) · **mod D `forbidden`** (ADR-0002 C7: videos are
 * admin-only; moderators read the admin pages only) · admin A. The denied rows never write. The
 * admin row is `mutatesSeed` (05 H-1): it hides SEED-11 `seedvid0001` — the hero of `/videos` and
 * the first Home card — and puts it back in `finally`; `afterAll` re-asserts and re-writes the
 * seed truth of that row regardless (05 H-1: the e2e build prerenders from the DB as the
 * db lane left it). Every other effect runs on `makeVideo` factory rows (`cleanupFactories`).
 *
 * Effects (ADR-0043 D1): `is_short` `true` / `false` writes `is_short_override` AND the effective
 * `is_short`; `is_short: null` clears the override and recomputes `is_short` from the STORED
 * `duration_seconds` / `title` / `description` with the adapter's `isShort` (04 §5.3 rows: ≤ 60 s →
 * true, the `#shorts` tag → true, an unknown duration → false, tag or not). Only the provided keys
 * are written — `hidden` survives an `is_short` call and the override survives a `hidden` call.
 * Every successful call revalidates the `videos` tag exactly once and logs one keys-only `admin`
 * line. Unknown `youtube_id` → `not_found`; validation arms per `updateVideoInput`; DB faults
 * (T-ACT-0 (1), COV-2): the row read, the update, and the update that matches no row.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateVideo } from '@/lib/actions/videos';
import type { UpdateVideoInput } from '@/lib/actions/videos.schema';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  factoryYoutubeId,
  makeVideo,
  type VideoOverrides,
} from '@/tests/helpers/factories';
import { SEED_VIDEOS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

/** SEED-11 `seedvid0001` as `supabase/seed.sql` leaves it: visible, long, no override. */
const SEED_LONG = SEED_VIDEOS.long.youtubeId;
const SEED_LONG_TRUTH = { hidden: false, is_short: false, is_short_override: null } as const;

type VideoState = { hidden: boolean; is_short: boolean; is_short_override: boolean | null };

async function readVideo(youtubeId: string): Promise<VideoState> {
  const { data, error } = await service
    .from('videos')
    .select('hidden, is_short, is_short_override')
    .eq('youtube_id', youtubeId)
    .single();
  if (error) throw new Error(`readVideo(${youtubeId}) failed: ${error.message}`);
  return data;
}

async function restoreSeedLong(): Promise<void> {
  const { error } = await service
    .from('videos')
    .update({ ...SEED_LONG_TRUTH })
    .eq('youtube_id', SEED_LONG);
  if (error) throw new Error(`restore ${SEED_LONG} failed: ${error.message}`);
}

/** A factory video; returns the `youtube_id` the action addresses it by. */
async function makeVideoId(overrides: VideoOverrides = {}): Promise<string> {
  return factoryYoutubeId(await makeVideo(overrides));
}

afterAll(async () => {
  // H-1 / 05 H-1: whatever happened above, SEED-11 leaves this file as seeded.
  await restoreSeedLong();
  expect(await readVideo(SEED_LONG)).toEqual(SEED_LONG_TRUTH);
  await cleanupFactories();
});

describe('T-ACT-68 updateVideo', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check fires (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: videos are admin-only; moderators get `forbidden` (00 S1.6.AC7).
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])(
    'T-ACT-68 $role → $code, seedvid0001 untouched, no revalidate',
    async ({ role, code, message }) => {
      const tags = spyRevalidateTag();
      const error = expectFail(
        await callAction(updateVideo, { youtube_id: SEED_LONG, hidden: true }, { role }),
        code,
      );
      expect(error.message).toBe(message);
      expect(await readVideo(SEED_LONG)).toEqual(SEED_LONG_TRUTH);
      expect(tags.calls).toEqual([]);
    },
  );

  it('T-ACT-68 admin hides seedvid0001 (mutatesSeed, restored): videos.hidden written, revalidates videos ONCE, SC-24 audit line', async () => {
    const tags = spyRevalidateTag();
    const logs = spyLog();
    try {
      const data = expectOk(
        await callAction(updateVideo, { youtube_id: SEED_LONG, hidden: true }, { role: 'admin' }),
      );
      expect(data).toEqual({ youtube_id: SEED_LONG, hidden: true, is_short: false });
      // `hidden` only: the Shorts pair is not part of the patch.
      expect(await readVideo(SEED_LONG)).toEqual({ ...SEED_LONG_TRUTH, hidden: true });

      // The public read (anon, RLS `hidden = false`) no longer sees the row — 00 S1.6.AC7.
      const { data: visible, error } = await asRole('anon')
        .from('videos')
        .select('youtube_id')
        .eq('youtube_id', SEED_LONG);
      expect(error).toBeNull();
      expect(visible).toEqual([]);

      expect(tags.calls).toEqual(['videos']);

      // SC-24: keys only — no values.
      const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.msg === 'admin',
      );
      expect(adminLines).toHaveLength(1);
      const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
      expect(line.action).toBe('updateVideo');
      expect(Object.keys(line.meta).sort()).toEqual([
        'actor_profile_id',
        'fields',
        'target_id',
        'target_type',
      ]);
      expect(line.meta.actor_profile_id).toBe(SEED_ROLE_IDS.admin);
      expect(line.meta.target_type).toBe('video');
      expect(line.meta.target_id).toBe(SEED_LONG);
      expect(line.meta.fields).toEqual(['youtube_id', 'hidden']);

      // Show again through the action — the round trip Oliver makes on `/admin`.
      const shown = expectOk(
        await callAction(updateVideo, { youtube_id: SEED_LONG, hidden: false }, { role: 'admin' }),
      );
      expect(shown.hidden).toBe(false);
      expect(await readVideo(SEED_LONG)).toEqual(SEED_LONG_TRUTH);
    } finally {
      logs.restore();
      await restoreSeedLong();
    }
  });

  it('T-ACT-68 is_short true / false sets is_short_override AND is_short (ADR-0043 D1); hidden survives', async () => {
    // 300 s, no tag → the heuristic says "not a Short"; hidden on purpose.
    const youtubeId = await makeVideoId({ hidden: true });
    expect(await readVideo(youtubeId)).toEqual({
      hidden: true,
      is_short: false,
      is_short_override: null,
    });

    const tags = spyRevalidateTag();
    const on = expectOk(
      await callAction(updateVideo, { youtube_id: youtubeId, is_short: true }, { role: 'admin' }),
    );
    expect(on).toEqual({ youtube_id: youtubeId, hidden: true, is_short: true });
    expect(await readVideo(youtubeId)).toEqual({
      hidden: true,
      is_short: true,
      is_short_override: true,
    });
    expect(tags.calls).toEqual(['videos']);

    const off = expectOk(
      await callAction(updateVideo, { youtube_id: youtubeId, is_short: false }, { role: 'admin' }),
    );
    expect(off).toEqual({ youtube_id: youtubeId, hidden: true, is_short: false });
    expect(await readVideo(youtubeId)).toEqual({
      hidden: true,
      is_short: false,
      is_short_override: false,
    });
  });

  it('T-ACT-68 hidden leaves an is_short override alone; both keys in one call write both', async () => {
    const youtubeId = await makeVideoId({ duration_seconds: 45, is_short: true });
    expectOk(
      await callAction(updateVideo, { youtube_id: youtubeId, is_short: false }, { role: 'admin' }),
    );
    expectOk(
      await callAction(updateVideo, { youtube_id: youtubeId, hidden: true }, { role: 'admin' }),
    );
    expect(await readVideo(youtubeId)).toEqual({
      hidden: true,
      is_short: false,
      is_short_override: false,
    });

    const both = expectOk(
      await callAction(
        updateVideo,
        { youtube_id: youtubeId, hidden: false, is_short: true },
        { role: 'admin' },
      ),
    );
    expect(both).toEqual({ youtube_id: youtubeId, hidden: false, is_short: true });
    expect(await readVideo(youtubeId)).toEqual({
      hidden: false,
      is_short: true,
      is_short_override: true,
    });
  });

  it.each<{ name: string; row: VideoOverrides; override: boolean; recomputed: boolean }>([
    {
      name: '45 s, no tag → true (≤ 60 s)',
      row: { duration_seconds: 45 },
      override: false,
      recomputed: true,
    },
    {
      name: '61 s, no tag → false',
      row: { duration_seconds: 61 },
      override: true,
      recomputed: false,
    },
    {
      name: '120 s with #Shorts in the description → true',
      row: { duration_seconds: 120, description: 'a quick one #Shorts' },
      override: false,
      recomputed: true,
    },
    {
      name: '600 s with #shorts in the title → true',
      row: { duration_seconds: 600, title: 't_ bonk #shorts' },
      override: false,
      recomputed: true,
    },
    {
      name: 'duration NULL (RSS-only row) with the tag → false — the null guard comes first',
      row: { duration_seconds: null, description: '#shorts' },
      override: true,
      recomputed: false,
    },
    {
      name: 'description NULL, 300 s → false',
      row: { duration_seconds: 300, description: null },
      override: true,
      recomputed: false,
    },
  ])(
    'T-ACT-68 is_short:null clears the override and recomputes from the stored fields — $name',
    async ({ row, override, recomputed }) => {
      const youtubeId = await makeVideoId(row);
      // Arrange the opposite of what the heuristic says, as an override.
      expectOk(
        await callAction(
          updateVideo,
          { youtube_id: youtubeId, is_short: override },
          { role: 'admin' },
        ),
      );
      expect(await readVideo(youtubeId)).toMatchObject({
        is_short: override,
        is_short_override: override,
      });

      const tags = spyRevalidateTag();
      const data = expectOk(
        await callAction(updateVideo, { youtube_id: youtubeId, is_short: null }, { role: 'admin' }),
      );
      expect(data).toEqual({ youtube_id: youtubeId, hidden: false, is_short: recomputed });
      expect(await readVideo(youtubeId)).toEqual({
        hidden: false,
        is_short: recomputed,
        is_short_override: null,
      });
      expect(tags.calls).toEqual(['videos']);
    },
  );

  it('T-ACT-68 is_short:null on a row with no override is idempotent (still ok, still the heuristic)', async () => {
    const youtubeId = await makeVideoId({ duration_seconds: 45, is_short: true });
    const data = expectOk(
      await callAction(updateVideo, { youtube_id: youtubeId, is_short: null }, { role: 'admin' }),
    );
    expect(data.is_short).toBe(true);
    expect(await readVideo(youtubeId)).toEqual({
      hidden: false,
      is_short: true,
      is_short_override: null,
    });
  });

  it('T-ACT-68 unknown youtube_id → not_found, no revalidate, no audit line', async () => {
    const tags = spyRevalidateTag();
    const logs = spyLog();
    try {
      const error = expectFail(
        await callAction(
          updateVideo,
          { youtube_id: 't_nosuchvid', hidden: true },
          { role: 'admin' },
        ),
        'not_found',
      );
      expect(error.message).toBe("That video doesn't exist.");
      expect(tags.calls).toEqual([]);
      expect(
        (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin'),
      ).toEqual([]);
    } finally {
      logs.restore();
    }
  });

  it.each<{ name: string; input: UpdateVideoInput; path: string; message: string }>([
    {
      name: 'neither hidden nor is_short',
      input: { youtube_id: SEED_LONG },
      path: 'hidden',
      message: 'Nothing to change.',
    },
    {
      name: 'youtube_id 10 chars',
      input: { youtube_id: 'seedvid000', hidden: true },
      path: 'youtube_id',
      message: 'Pick a video.',
    },
    {
      name: 'youtube_id 12 chars',
      input: { youtube_id: 'seedvid00011', hidden: true },
      path: 'youtube_id',
      message: 'Pick a video.',
    },
    {
      name: 'youtube_id outside [A-Za-z0-9_-]',
      input: { youtube_id: 'seedvid000!', hidden: true },
      path: 'youtube_id',
      message: 'Pick a video.',
    },
    {
      name: 'youtube_id missing',
      input: { hidden: true } as unknown as UpdateVideoInput,
      path: 'youtube_id',
      message: 'Pick a video.',
    },
    {
      name: 'hidden is not a boolean',
      input: { youtube_id: SEED_LONG, hidden: 'true' } as unknown as UpdateVideoInput,
      path: 'hidden',
      message: 'Hidden is on or off.',
    },
    {
      name: 'is_short is not a boolean or null',
      input: { youtube_id: SEED_LONG, is_short: 'auto' } as unknown as UpdateVideoInput,
      path: 'is_short',
      message: 'Short is on, off or automatic.',
    },
  ])(
    'T-ACT-68 $name → validation (before auth: asked as anon)',
    async ({ input, path, message }) => {
      // zod runs before `requireRole` (04 SC-02 / T-ACT-0 (2)) — anon gets `validation`, not
      // `unauthenticated`.
      const error = expectFail(
        await callAction(updateVideo, input, { role: 'anon' }),
        'validation',
      );
      expect(error.message).toBe('Check the form.');
      expect(error.field).toBe(path);
      expect(error.issues).toEqual([{ path, message }]);
    },
  );

  it('T-ACT-68 unknown input keys are stripped — never written, never logged as values', async () => {
    const youtubeId = await makeVideoId();
    const data = expectOk(
      await callAction(
        updateVideo,
        { youtube_id: youtubeId, hidden: true, title: 'hijacked' } as unknown as UpdateVideoInput,
        { role: 'admin' },
      ),
    );
    expect(data.hidden).toBe(true);
    const { data: row, error } = await service
      .from('videos')
      .select('title')
      .eq('youtube_id', youtubeId)
      .single();
    expect(error).toBeNull();
    expect(row?.title).not.toBe('hijacked');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-68 — DB faults (T-ACT-0 (1); COV-2): the row read, the update, the update that finds no row
// ---------------------------------------------------------------------------------------------
describe('T-ACT-68 updateVideo DB faults', () => {
  let logs: LogSpy;

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  it.each<{ name: string; op: 'select' | 'update' }>([
    { name: 'the row read', op: 'select' },
    { name: 'the update', op: 'update' },
  ])(
    'T-ACT-68 $name fails → internal + one log.error line, row untouched, no revalidate, no audit line',
    async ({ op }) => {
      const youtubeId = await makeVideoId();
      const tags = spyRevalidateTag();
      const res = await withDbFault({ table: 'videos', op }, {}, () =>
        callAction(
          updateVideo,
          { youtube_id: youtubeId, hidden: true, is_short: true },
          { role: 'admin' },
        ),
      );
      expectInternal(res, 'updateVideo', logs);
      expect(await readVideo(youtubeId)).toEqual({
        hidden: false,
        is_short: false,
        is_short_override: null,
      });
      expect(tags.calls).toEqual([]);
      expect(
        (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin'),
      ).toEqual([]);
    },
  );

  it('T-ACT-68 the update matches no row (removed by hand mid-call) → not_found, no revalidate', async () => {
    const youtubeId = await makeVideoId();
    const tags = spyRevalidateTag();
    const res = await withDbFault(
      { table: 'videos', op: 'update' },
      { result: { data: null, error: null } },
      () => callAction(updateVideo, { youtube_id: youtubeId, hidden: true }, { role: 'admin' }),
    );
    const error = expectFail(res, 'not_found');
    expect(error.message).toBe("That video doesn't exist.");
    expect(tags.calls).toEqual([]);
  });
});
