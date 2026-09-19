/**
 * tests/db/data/videos.test.ts — `lib/data/videos.ts` `listVisibleVideos` against the local stack
 * (00 S1.6.AC7 "hidden video never renders publicly"; 02 route row `/videos` Data "`videos` (not
 * hidden)"; ADR-0043 D6 — one reader for `/videos` and Home). Supplementary: the S1.6 §8 row gives
 * the data layer no id of its own — the behaviour is e2e-proved by T-E2E-6 (smoke, on seed) and
 * T-E2E-47 (hide / unhide through `/admin`); this file pins the reader's contract where a failure
 * names the reader, and tags its titles with the e2e id it backs.
 *
 * In the db lane `next/cache` `unstable_cache` is the pass-through of tests/helpers/setup.db.ts, so
 * every call is a fresh read on the cookie-less anon client (RLS as a visitor — 05 T-RLS-48/49).
 * Rows are factory rows (`t_` tagged, dated years away from SEED-11 so the ordering assertions
 * hold whatever other videos exist) and are removed in `afterAll` — seed truth is left behind (H-1).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { listVisibleVideos } from '@/lib/data/videos';
import { cleanupFactories, factoryYoutubeId, makeVideo } from '@/tests/helpers/factories';

afterAll(async () => {
  await cleanupFactories();
});

describe('T-E2E-6 backing — listVisibleVideos (lib/data/videos.ts)', () => {
  it('T-E2E-6 reader: visible rows only, newest first, camelCase + ISO dates, blurb = first paragraph, nulls kept', async () => {
    const newest = await makeVideo({
      title: 't_ newest long',
      description: 'First paragraph,\nstill the first.\n\nSecond paragraph.',
      published_at: '2031-03-02T10:00:00+00:00',
      duration_seconds: 724,
      view_count: 8200,
    });
    const hidden = await makeVideo({
      title: 't_ hidden, newer than everything',
      published_at: '2031-03-03T10:00:00+00:00',
      hidden: true,
    });
    const short = await makeVideo({
      title: 't_ short',
      published_at: '2031-03-01T10:00:00+00:00',
      duration_seconds: 45,
      is_short: true,
    });
    // RSS-only shape (04 §3.3, no API key): no description, duration or counts.
    const degraded = await makeVideo({
      title: 't_ rss only',
      description: null,
      published_at: '2031-02-28T10:00:00+00:00',
      duration_seconds: null,
      view_count: null,
      like_count: null,
    });

    const videos = await listVisibleVideos();
    const ids = videos.map((video) => video.id);

    // AC7: the hidden row never leaves the reader — even as the newest row in the table.
    expect(ids).not.toContain(hidden);
    expect(videos.map((video) => video.youtubeId)).not.toContain(factoryYoutubeId(hidden));

    // published_at desc: the three visible factory rows lead, in date order (long + Short together).
    expect(ids.slice(0, 3)).toEqual([newest, short, degraded]);
    const times = videos.map((video) => Date.parse(video.publishedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    expect(videos[0]).toEqual({
      id: newest,
      youtubeId: factoryYoutubeId(newest),
      title: 't_ newest long',
      thumbnailUrl: `https://i.ytimg.com/vi/${factoryYoutubeId(newest)}/hqdefault.jpg`,
      durationSeconds: 724,
      publishedAt: '2031-03-02T10:00:00.000Z',
      viewCount: 8200,
      isShort: false,
      blurb: 'First paragraph, still the first.',
    });
    expect(videos[1]).toMatchObject({ id: short, isShort: true, durationSeconds: 45 });
    expect(videos[2]).toMatchObject({
      id: degraded,
      durationSeconds: null,
      viewCount: null,
      blurb: null,
    });
    // Props are serialisable (03 C-19): plain JSON round-trips unchanged.
    expect(JSON.parse(JSON.stringify(videos))).toEqual(videos);
  });
});
