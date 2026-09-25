/**
 * tests/unit/art.test.ts — `lib/art.ts`, the pure client-safe half of the art data layer (S1.7;
 * 03 §2.7 `ArtMasonry` / `ArtCard` / `ArtMasonryLightbox`; 02 route row `/art`; ADR-0048 D17 /
 * ADR-0048 D12). The S1.7 §8 row gives these helpers no id of their own (ADR-R9) — each title carries the
 * id of the test the helper backs: T-E2E-9 (`/art`: the filter row and its counts, `?kind=`
 * parsing, the filtered / empty states, the lightbox Download file name). Pure — no DOM, no
 * network, no clock (05 §1.1).
 */
import { describe, expect, it } from 'vitest';
import {
  ART_KINDS,
  FIXED_FILTER_KINDS,
  applyArtFilter,
  artFilename,
  isArtKind,
  kindCounts,
  kindLabel,
  parseArtFilter,
  type ArtItem,
  type ArtKind,
} from '@/lib/art';

let serial = 0;
function piece(kind: ArtKind, extra: Partial<ArtItem> = {}): ArtItem {
  serial += 1;
  const id = `00000000-0000-4000-8000-0000000007${String(serial).padStart(2, '0')}`;
  const slug = `t-${kind}-${String(serial)}`;
  const imageUrl = `http://127.0.0.1:54321/storage/v1/object/public/art/${id}/0123456789abcdef.png`;
  return {
    id,
    slug,
    title: `Piece ${String(serial)}`,
    kind,
    imageUrl,
    width: 256,
    height: 256,
    year: null,
    credit: null,
    downloadable: false,
    downloadHref: null,
    ...extra,
  };
}

/** SEED-8 as the reader hands it over: one avatar, one thumbnail. */
const SEED: ArtItem[] = [
  piece('avatar', { width: 256, height: 256, year: 2025, downloadable: true }),
  piece('thumbnail', { width: 1280, height: 720 }),
];

describe('T-E2E-9 backing — the kind enum + labels', () => {
  it('T-E2E-9 ART_KINDS is the data-model §2.4 enum in filter-row order; the first three are fixed', () => {
    expect(ART_KINDS).toEqual(['avatar', 'thumbnail', 'icon', 'render', 'other']);
    expect(FIXED_FILTER_KINDS).toEqual(['avatar', 'thumbnail', 'icon']);
  });

  it.each([
    ['avatar', 'AVATARS'],
    ['thumbnail', 'THUMBNAILS'],
    ['icon', 'ICONS'],
    ['render', 'RENDERS'],
    ['other', 'OTHER'],
  ] as const)(
    'T-E2E-9 kindLabel(%s) → %s (uppercase in source — the e2e reads DOM text)',
    (kind, label) => {
      expect(kindLabel(kind)).toBe(label);
    },
  );

  it('T-E2E-9 isArtKind is exact: no case folding, no trimming', () => {
    for (const kind of ART_KINDS) expect(isArtKind(kind)).toBe(true);
    for (const bad of ['AVATAR', ' avatar', 'avatars', '', 'sticker']) {
      expect(isArtKind(bad), bad).toBe(false);
    }
  });
});

describe('T-E2E-9 backing — parseArtFilter (`?kind=`; unknown values fall away)', () => {
  it.each([
    ['?kind=avatar', 'avatar'],
    ['?kind=thumbnail', 'thumbnail'],
    ['?kind=icon', 'icon'],
    ['?kind=render', 'render'],
    ['?kind=other', 'other'],
    ['', null],
    ['?kind=', null],
    ['?kind=nonsense', null],
    ['?kind=AVATAR', null],
    ['?platform=youtube', null],
    ['?kind=avatar&kind=icon', 'avatar'],
  ])('T-E2E-9 parseArtFilter(%j) → %j', (query, expected) => {
    expect(parseArtFilter(new URLSearchParams(query))).toBe(expected);
  });
});

describe('T-E2E-9 backing — applyArtFilter', () => {
  it('T-E2E-9 null keeps everything, as a COPY, in order', () => {
    const all = applyArtFilter(SEED, null);
    expect(all).toEqual(SEED);
    expect(all).not.toBe(SEED);
  });

  it('T-E2E-9 a kind keeps only that kind, in order; a kind with no items → [] (the empty state)', () => {
    expect(applyArtFilter(SEED, 'avatar').map((item) => item.kind)).toEqual(['avatar']);
    expect(applyArtFilter(SEED, 'thumbnail').map((item) => item.kind)).toEqual(['thumbnail']);
    expect(applyArtFilter(SEED, 'icon')).toEqual([]);
    expect(applyArtFilter([], 'avatar')).toEqual([]);
  });

  it('T-E2E-9 never mutates its input', () => {
    const frozen = Object.freeze([...SEED]);
    applyArtFilter(frozen, 'avatar');
    expect(frozen).toEqual(SEED);
  });
});

describe('T-E2E-9 backing — kindCounts (the FilterBarView group)', () => {
  it('T-E2E-9 seed → AVATARS 1 · THUMBNAILS 1 · ICONS 0 (fixed buttons stay at 0; RENDERS / OTHER absent)', () => {
    expect(kindCounts(SEED)).toEqual([
      { value: 'avatar', label: 'AVATARS', count: 1 },
      { value: 'thumbnail', label: 'THUMBNAILS', count: 1 },
      { value: 'icon', label: 'ICONS', count: 0 },
    ]);
  });

  it('T-E2E-9 no art at all → the three fixed buttons, all 0', () => {
    expect(kindCounts([]).map((option) => [option.value, option.count])).toEqual([
      ['avatar', 0],
      ['thumbnail', 0],
      ['icon', 0],
    ]);
  });

  it('T-E2E-9 RENDERS / OTHER appear only when such items exist, in ART_KINDS order, counted over the FULL list', () => {
    const list = [...SEED, piece('other'), piece('render'), piece('render'), piece('avatar')];
    expect(kindCounts(list)).toEqual([
      { value: 'avatar', label: 'AVATARS', count: 2 },
      { value: 'thumbnail', label: 'THUMBNAILS', count: 1 },
      { value: 'icon', label: 'ICONS', count: 0 },
      { value: 'render', label: 'RENDERS', count: 2 },
      { value: 'other', label: 'OTHER', count: 1 },
    ]);
    // Counts are not faceted: filtering the list is the caller's job, the row is always the whole.
    expect(
      kindCounts(applyArtFilter(list, 'render')).find((o) => o.value === 'avatar')?.count,
    ).toBe(0);
  });
});

describe('T-E2E-9 backing — artFilename (the lightbox Download `?download=` name)', () => {
  it.each([
    [
      'seed-art-avatar',
      'art/00000000-0000-4000-8000-000000000701/b64a4e0e96965d51.png',
      'seed-art-avatar.png',
    ],
    [
      'seed-art-thumb',
      'art/00000000-0000-4000-8000-000000000702/6ce87bbf56e4d5f6.png',
      'seed-art-thumb.png',
    ],
    ['a-jpeg', 'art/x/0123456789abcdef.jpg', 'a-jpeg.jpg'],
    ['a-webp', 'art/x/0123456789abcdef.webp', 'a-webp.webp'],
    ['shouty', 'art/x/0123456789abcdef.PNG', 'shouty.png'],
    ['no-ext', 'art/x/0123456789abcdef', 'no-ext.png'],
    ['dot-first', 'art/x/.hidden', 'dot-first.png'],
  ])('T-E2E-9 artFilename(%j, %j) → %j', (slug, imagePath, expected) => {
    expect(artFilename(slug, imagePath)).toBe(expected);
  });
});
