/**
 * tests/unit/format-reach.test.ts — 05 T-UNIT-9: `formatReachLine({views, videos, creators})`
 * (`lib/format/reach.ts`; DESIGN.md §12.1 Reach line; 03 §2.8 `ReachLine`; ADR-0002 #77). Every
 * catalogue vector verbatim — `{1200000,6,4}`, `{999,1,1}` singulars, `12.5K`, `1K`, `1.5B`, the
 * omitted views segment for 0 / null, the sr expansion `1.2 million views`, uppercase + `·`
 * separators — plus the shape `ReachLine` renders from (ADR-0045: one `PixelLabel` per segment,
 * each at most two words, because the whole line would trip the 5-word guard) and the
 * nothing-to-say arm. Pure, locale-free.
 */
import { describe, expect, it } from 'vitest';
import { formatReachLine } from '@/lib/format/reach';
import { reachTotals, type MentionCardData } from '@/lib/mentions';

describe('T-UNIT-9 formatReachLine', () => {
  it('T-UNIT-9 {1200000, 6, 4} → 1.2M VIEWS · 6 VIDEOS · 4 CREATORS (catalogue vector)', () => {
    expect(formatReachLine({ views: 1_200_000, videos: 6, creators: 4 })).toEqual({
      text: '1.2M VIEWS · 6 VIDEOS · 4 CREATORS',
      spoken: '1.2 million views · 6 videos · 4 creators',
      segments: ['1.2M VIEWS', '6 VIDEOS', '4 CREATORS'],
    });
  });

  it('T-UNIT-9 {999, 1, 1} → 999 VIEWS · 1 VIDEO · 1 CREATOR (singulars)', () => {
    const line = formatReachLine({ views: 999, videos: 1, creators: 1 });
    expect(line.text).toBe('999 VIEWS · 1 VIDEO · 1 CREATOR');
    expect(line.spoken).toBe('999 views · 1 video · 1 creator');
  });

  it.each([
    [12_500, '12.5K VIEWS', '12.5 thousand views'],
    [1000, '1K VIEWS', '1 thousand views'],
    [1_500_000_000, '1.5B VIEWS', '1.5 billion views'],
  ])('T-UNIT-9 views %d → %s (compact figure, spoken as "%s")', (views, segment, spoken) => {
    const line = formatReachLine({ views, videos: 6, creators: 4 });
    expect(line.segments[0]).toBe(segment);
    expect(line.text).toBe(`${segment} · 6 VIDEOS · 4 CREATORS`);
    expect(line.spoken).toBe(`${spoken} · 6 videos · 4 creators`);
  });

  it.each([
    ['0', 0],
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['a negative', -5],
  ])('T-UNIT-9 views %s → the views segment is omitted (ADR-0002 #77)', (_label, views) => {
    expect(formatReachLine({ views, videos: 2, creators: 2 })).toEqual({
      text: '2 VIDEOS · 2 CREATORS',
      spoken: '2 videos · 2 creators',
      segments: ['2 VIDEOS', '2 CREATORS'],
    });
  });

  it('T-UNIT-9 sr expansion: "1.2 million views" — the spoken figure is the visible figure', () => {
    const line = formatReachLine({ views: 1_249_999, videos: 2, creators: 2 });
    expect(line.segments[0]).toBe('1.2M VIEWS');
    expect(line.spoken.startsWith('1.2 million views')).toBe(true);
  });

  it('T-UNIT-9 exactly one view reads singular too', () => {
    const line = formatReachLine({ views: 1, videos: 1, creators: 1 });
    expect(line.text).toBe('1 VIEW · 1 VIDEO · 1 CREATOR');
    expect(line.spoken).toBe('1 view · 1 video · 1 creator');
  });

  it('T-UNIT-9 the visible line is uppercase with · separators; text = segments joined', () => {
    const line = formatReachLine({ views: 8934, videos: 12, creators: 7 });
    expect(line.text).toBe('8.9K VIEWS · 12 VIDEOS · 7 CREATORS');
    expect(line.text).toBe(line.text.toUpperCase());
    expect(line.text).toBe(line.segments.join(' · '));
    expect(line.spoken).toBe(line.spoken.toLowerCase());
  });

  it('T-UNIT-9 every segment is at most two words (one PixelLabel each — the 5-word guard)', () => {
    for (const totals of [
      { views: 1_200_000, videos: 6, creators: 4 },
      { views: 0, videos: 1, creators: 1 },
      { views: 1_500_000_000, videos: 1200, creators: 999 },
    ]) {
      for (const segment of formatReachLine(totals).segments) {
        expect(segment.split(/\s+/).length, segment).toBeLessThanOrEqual(2);
      }
    }
  });

  it('T-UNIT-9 nothing to say (all zero) → empty text, spoken and segments', () => {
    const empty = { text: '', spoken: '', segments: [] };
    expect(formatReachLine({ views: 0, videos: 0, creators: 0 })).toEqual(empty);
    expect(formatReachLine({ views: null, videos: 0, creators: 0 })).toEqual(empty);
    expect(formatReachLine({ videos: Number.NaN, creators: -1 })).toEqual(empty);
  });

  it('T-UNIT-9 fractions floor, large counts compact like the views do', () => {
    const line = formatReachLine({ views: 999.9, videos: 1500, creators: 2.9 });
    expect(line.text).toBe('999 VIEWS · 1.5K VIDEOS · 2 CREATORS');
    expect(line.spoken).toBe('999 views · 1.5 thousand videos · 2 creators');
  });

  it('T-UNIT-9 SEED-10 totals through reachTotals → 1.2M VIEWS · 2 VIDEOS · 2 CREATORS (05 §3)', () => {
    const base = {
      url: 'https://example.test/',
      externalId: null,
      title: 't',
      creatorUrl: null,
      thumbnailUrl: null,
      publishedAt: null,
      project: null,
    };
    const seed: MentionCardData[] = [
      { ...base, id: 'a', platform: 'youtube', creatorName: 'Seed Creator', viewCount: 1_200_000 },
      { ...base, id: 'b', platform: 'tiktok', creatorName: 'Seed Tok', viewCount: null },
    ];
    expect(formatReachLine(reachTotals(seed)).text).toBe('1.2M VIEWS · 2 VIDEOS · 2 CREATORS');
  });
});
