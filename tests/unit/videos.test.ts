/**
 * tests/unit/videos.test.ts — `lib/videos.ts`, the pure client-safe half of the videos data layer
 * (S1.6; ADR-0043 D6 / D12; 01 INV-57; 00 S1.6.AC2, AC5, AC6, AC8). Supporting helpers for
 * T-E2E-6 / T-E2E-1 / T-E2E-47 — no catalogue id of their own until the Session-A ADR assigns one
 * (T-UNIT-54 precedent, ADR-0041 D8). `splitVideos([])` is the literal-empty arm T-E2E-47 cannot
 * reach (ADR-0043 D9: the e2e empties the VISIBLE rows through `/admin`; zero rows is proven here).
 * Pure — no DOM, no network, no clock.
 */
import { describe, expect, it } from 'vitest';
import {
  blurbFrom,
  latestLongVideos,
  splitVideos,
  UP_NEXT_COUNT,
  YOUTUBE_CHANNEL_URL,
  youtubeEmbedUrl,
  youtubeWatchUrl,
  type VideoCardData,
  type VideoStageItem,
} from '@/lib/videos';

/** The visible SEED-11 rows in reader order (`published_at desc`) — ids and dates as seed.sql has them. */
function video(n: number, publishedAt: string, extra: Partial<VideoCardData> = {}): VideoCardData {
  const youtubeId = `seedvid000${n}`;
  return {
    id: `00000000-0000-4000-8000-00000000090${n}`,
    youtubeId,
    title: `Seed Video ${n}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    durationSeconds: 600,
    publishedAt,
    viewCount: 100,
    isShort: false,
    ...extra,
  };
}

const SEED_VISIBLE: VideoCardData[] = [
  video(1, '2026-09-01T12:00:00+00:00'),
  video(3, '2026-08-25T12:00:00+00:00', { isShort: true, durationSeconds: 45 }),
  video(4, '2026-08-15T12:00:00+00:00'),
  video(5, '2026-07-30T12:00:00+00:00'),
  video(6, '2026-07-04T12:00:00+00:00'),
  video(7, '2026-06-12T12:00:00+00:00'),
];

const ids = (videos: VideoCardData[]): string[] => videos.map((v) => v.youtubeId);

describe('lib/videos constants', () => {
  it('UP_NEXT_COUNT is 4 (ADR-0043 D12; 02 §6 "player well + 4 facade shells")', () => {
    expect(UP_NEXT_COUNT).toBe(4);
  });

  it('YOUTUBE_CHANNEL_URL is the 02 RP-13 channel link', () => {
    expect(YOUTUBE_CHANNEL_URL).toBe('https://www.youtube.com/@OdSens');
    expect(new URL(YOUTUBE_CHANNEL_URL).hostname).toBe('www.youtube.com');
  });
});

describe('lib/videos URL builders (01 INV-57; 00 S1.6.AC2)', () => {
  it('youtubeEmbedUrl → https://www.youtube-nocookie.com/embed/<id>?autoplay=1', () => {
    expect(youtubeEmbedUrl('seedvid0001')).toBe(
      'https://www.youtube-nocookie.com/embed/seedvid0001?autoplay=1',
    );
  });

  it('youtubeWatchUrl → https://www.youtube.com/watch?v=<id>', () => {
    expect(youtubeWatchUrl('seedvid0001')).toBe('https://www.youtube.com/watch?v=seedvid0001');
  });

  it('keeps the url-safe characters a real id uses (`-` and `_`) verbatim', () => {
    expect(youtubeEmbedUrl('a-B_c1d2E3f')).toBe(
      'https://www.youtube-nocookie.com/embed/a-B_c1d2E3f?autoplay=1',
    );
    expect(youtubeWatchUrl('a-B_c1d2E3f')).toBe('https://www.youtube.com/watch?v=a-B_c1d2E3f');
  });

  it('an id can never leave its path segment / query value, and the embed never uses youtube.com', () => {
    for (const hostile of [
      '../evil',
      'a/b',
      'x?y=1',
      'x#y',
      'a b',
      'x&list=PL1',
      '@evil.example',
    ]) {
      const embed = new URL(youtubeEmbedUrl(hostile));
      expect(embed.origin).toBe('https://www.youtube-nocookie.com');
      expect(embed.pathname.split('/').filter(Boolean)).toHaveLength(2);
      expect(embed.pathname.startsWith('/embed/')).toBe(true);
      expect([...embed.searchParams.entries()]).toEqual([['autoplay', '1']]);
      expect(embed.hash).toBe('');

      const watch = new URL(youtubeWatchUrl(hostile));
      expect(watch.origin).toBe('https://www.youtube.com');
      expect(watch.pathname).toBe('/watch');
      expect([...watch.searchParams.entries()]).toEqual([['v', hostile]]);
      expect(watch.hash).toBe('');
    }
  });
});

describe('splitVideos (00 S1.6.AC5 — Shorts only in ShortsRow)', () => {
  it('splitVideos([]) → { long: [], shorts: [] } — the literal-empty arm of the §11.7 empty state (AC8, T-E2E-47 twin)', () => {
    expect(splitVideos([])).toEqual({ long: [], shorts: [] });
  });

  it('SEED-11 visible rows → five long, one short, order kept (newest first)', () => {
    const { long, shorts } = splitVideos(SEED_VISIBLE);
    expect(ids(long)).toEqual([
      'seedvid0001',
      'seedvid0004',
      'seedvid0005',
      'seedvid0006',
      'seedvid0007',
    ]);
    expect(ids(shorts)).toEqual(['seedvid0003']);
  });

  it('on seed: Up next = the first UP_NEXT_COUNT long videos, MORE VIDEOS = the rest (ADR-0043 D12)', () => {
    const { long } = splitVideos(SEED_VISIBLE);
    expect(ids(long.slice(0, UP_NEXT_COUNT))).toEqual([
      'seedvid0001',
      'seedvid0004',
      'seedvid0005',
      'seedvid0006',
    ]);
    expect(ids(long.slice(UP_NEXT_COUNT))).toEqual(['seedvid0007']);
  });

  it('only shorts → long is empty (no hero), only long → shorts is empty (no ShortsRow)', () => {
    const short = video(3, '2026-08-25T12:00:00+00:00', { isShort: true });
    expect(splitVideos([short])).toEqual({ long: [], shorts: [short] });
    const long = video(1, '2026-09-01T12:00:00+00:00');
    expect(splitVideos([long])).toEqual({ long: [long], shorts: [] });
  });

  it('keeps the wider item type and never mutates its input', () => {
    const items: VideoStageItem[] = SEED_VISIBLE.map((v) => ({ ...v, blurb: `blurb ${v.id}` }));
    const before = structuredClone(items);
    const { long, shorts } = splitVideos(items);
    expect(long[0]?.blurb).toBe(`blurb ${SEED_VISIBLE[0]?.id}`);
    expect(shorts[0]?.blurb).toBe(`blurb ${SEED_VISIBLE[1]?.id}`);
    expect(items).toEqual(before);
    expect(long[0]).toBe(items[0]); // same object references — no copies to drift
  });
});

describe('latestLongVideos (00 S1.6.AC6; 02 §2.1 item 4 — Home 2-up)', () => {
  it('on seed: the two newest non-short videos are seedvid0001 + seedvid0004 (the short between them is skipped)', () => {
    expect(ids(latestLongVideos(SEED_VISIBLE, 2))).toEqual(['seedvid0001', 'seedvid0004']);
  });

  it('does not depend on the caller ordering, and does not mutate it', () => {
    const shuffled = [...SEED_VISIBLE].reverse();
    const before = ids(shuffled);
    expect(ids(latestLongVideos(shuffled, 2))).toEqual(['seedvid0001', 'seedvid0004']);
    expect(ids(shuffled)).toEqual(before);
  });

  it('fewer long videos than asked → what there is; none → []', () => {
    const one = [video(1, '2026-09-01T12:00:00+00:00'), SEED_VISIBLE[1] as VideoCardData];
    expect(ids(latestLongVideos(one, 2))).toEqual(['seedvid0001']);
    expect(latestLongVideos([SEED_VISIBLE[1] as VideoCardData], 2)).toEqual([]);
    expect(latestLongVideos([], 2)).toEqual([]);
  });

  it('ties keep the reader order; an unparseable date sorts last instead of throwing', () => {
    const a = video(4, '2026-08-15T12:00:00+00:00');
    const b = video(5, '2026-08-15T12:00:00+00:00');
    const junk = video(6, 'not a date');
    const junk2 = video(7, '');
    expect(ids(latestLongVideos([junk, a, junk2, b], 4))).toEqual([
      'seedvid0004',
      'seedvid0005',
      'seedvid0006',
      'seedvid0007',
    ]);
  });

  it('compares instants, not strings (offset forms of the same feed)', () => {
    const later = video(4, '2026-08-15T23:30:00-05:00'); // = 2026-08-16T04:30Z
    const earlier = video(5, '2026-08-16T01:00:00+00:00');
    expect(ids(latestLongVideos([earlier, later], 1))).toEqual(['seedvid0004']);
  });

  it('count 0 / negative / NaN → []; a fractional count floors', () => {
    expect(latestLongVideos(SEED_VISIBLE, 0)).toEqual([]);
    expect(latestLongVideos(SEED_VISIBLE, -2)).toEqual([]);
    expect(latestLongVideos(SEED_VISIBLE, Number.NaN)).toEqual([]);
    expect(ids(latestLongVideos(SEED_VISIBLE, 2.9))).toEqual(['seedvid0001', 'seedvid0004']);
  });
});

describe('blurbFrom (the hero blurb — first paragraph of videos.description)', () => {
  it('null / empty / whitespace-only → null (RSS-only rows, SEED-11 seedvid0006: no blurb)', () => {
    expect(blurbFrom(null)).toBeNull();
    expect(blurbFrom('')).toBeNull();
    expect(blurbFrom('  \n\n \t ')).toBeNull();
  });

  it('a one-paragraph description comes back trimmed', () => {
    expect(blurbFrom('  An hour of bad decisions, lightly edited. ')).toBe(
      'An hour of bad decisions, lightly edited.',
    );
  });

  it('SEED-11 seedvid0001: only the first of three paragraphs', () => {
    const description =
      'I gave the mace a metal pipe sound and then could not stop swinging it.\n\n' +
      'This is the whole build, start to finish: the model swap, the sound file, and the part where I broke my own world twice.\n\n' +
      'The pack is on the projects page.';
    expect(blurbFrom(description)).toBe(
      'I gave the mace a metal pipe sound and then could not stop swinging it.',
    );
  });

  it('leading blank lines are skipped; CRLF and whitespace-only separator lines count as blank', () => {
    expect(blurbFrom('\n\nFirst.\n\nSecond.')).toBe('First.');
    expect(blurbFrom('First.\r\n\r\nSecond.')).toBe('First.');
    expect(blurbFrom('First.\n  \t\nSecond.')).toBe('First.');
  });

  it('single line breaks and runs of whitespace inside the paragraph fold to one space', () => {
    expect(blurbFrom('Line one\nline two\r\nline   three\n\nNext paragraph')).toBe(
      'Line one line two line three',
    );
  });

  it('is plain text: markup and links pass through as characters, never parsed', () => {
    expect(blurbFrom('<b>bold</b> https://example.test #shorts\n\nmore')).toBe(
      '<b>bold</b> https://example.test #shorts',
    );
  });
});
