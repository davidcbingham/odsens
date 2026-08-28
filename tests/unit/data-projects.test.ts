/**
 * tests/unit/data-projects.test.ts — pure pieces of `lib/data/projects.ts`.
 *
 * Supplementary tests (no 05 IDs — the S1.2 §8 row assigns none to the data layer; the featured
 * behaviour itself is e2e-proved by T-E2E-1 and the AC is 00 S1.2.AC7). Covers the pure helpers
 * only: `selectFeatured` (02 §2.1 #1/#2 verbatim, seed arrangement from SEED-6), `isNewProject`
 * (ADR-0002 #41), `projectChips`, `parseGalleryEntries`/`mergeGallery`/`pickScreenshot`
 * (02 §2.1 #1, §2.3 #2), `isExclusive`, `modrinthProjectUrl`, `resolveMediaUrl`. The cached
 * readers (`listPublishedProjects`, `getProjectDetail`, `getHomeFeatured`) hit the DB and are
 * exercised by the page e2e, not here (unit = no network, 05 §1.1).
 */
import { describe, expect, it } from 'vitest';
import {
  isExclusive,
  isNewProject,
  mergeGallery,
  modrinthProjectUrl,
  parseGalleryEntries,
  pickScreenshot,
  projectChips,
  publicStorageUrl,
  resolveMediaUrl,
  selectFeatured,
  type FeaturedCandidate,
} from '@/lib/data/projects';

const candidate = (
  slug: string,
  downloadsTotal: number,
  featuredOrder: number | null = null,
  featured = featuredOrder !== null,
): FeaturedCandidate => ({ slug, featured, featuredOrder, downloadsTotal });

describe('selectFeatured (02 §2.1 #1/#2; 00 S1.2.AC7)', () => {
  // SEED-6 arrangement: pixel-chameleon featured_order 1, seed-exclusive-pack 2, mace unfeatured.
  const seed = [
    candidate('metal-pipe-mace', 2531),
    candidate('pixel-chameleon', 1688, 1),
    candidate('seed-exclusive-pack', 7, 2),
  ];

  it('hero = lowest featured_order; 4-up = the next featured ONLY, never back-filled (T-E2E-1)', () => {
    const { hero, next } = selectFeatured(seed);
    expect(hero?.slug).toBe('pixel-chameleon');
    // metal-pipe-mace out-downloads everything but is not featured — it must NOT appear.
    expect(next.map((p) => p.slug)).toEqual(['seed-exclusive-pack']);
  });

  it('nothing featured → hero = highest downloads_total, next = the following four', () => {
    const rows = [
      candidate('a', 10),
      candidate('b', 50),
      candidate('c', 40),
      candidate('d', 30),
      candidate('e', 20),
      candidate('f', 5),
    ];
    const { hero, next } = selectFeatured(rows);
    expect(hero?.slug).toBe('b');
    expect(next.map((p) => p.slug)).toEqual(['c', 'd', 'e', 'a']);
  });

  it('fewer than 4 → render what exists; 0 published → nothing (section not rendered)', () => {
    expect(selectFeatured([candidate('only', 1)])).toEqual({
      hero: candidate('only', 1),
      next: [],
    });
    expect(selectFeatured([])).toEqual({ hero: null, next: [] });
  });

  it('caps the 4-up at 4 featured rows, ordered by featured_order', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => candidate(`p${n}`, 100 - n, 7 - n));
    const { hero, next } = selectFeatured(rows);
    expect(hero?.slug).toBe('p6'); // featured_order 1
    expect(next.map((p) => p.slug)).toEqual(['p5', 'p4', 'p3', 'p2']);
  });

  it('featured with a null featured_order sorts after numbered ones, then by downloads', () => {
    const rows = [
      candidate('no-order-small', 10, null, true),
      candidate('ordered', 1, 5),
      candidate('no-order-big', 999, null, true),
    ];
    const { hero, next } = selectFeatured(rows);
    expect(hero?.slug).toBe('ordered');
    expect(next.map((p) => p.slug)).toEqual(['no-order-big', 'no-order-small']);
  });
});

describe('isNewProject (ADR-0002 #41: published_at < 30 days)', () => {
  const now = Date.parse('2026-08-27T00:00:00Z');

  it('29 days old → NEW; 31 days old → not', () => {
    expect(isNewProject('2026-07-29T00:00:00Z', now)).toBe(true);
    expect(isNewProject('2026-07-27T00:00:00Z', now)).toBe(false);
  });

  it('null or unparseable published_at → never NEW', () => {
    expect(isNewProject(null, now)).toBe(false);
    expect(isNewProject('not-a-date', now)).toBe(false);
  });
});

describe('projectChips (02 §2.1/§2.3 "versions/loaders"; 03 V-01 groups)', () => {
  it('version groups (newest first) then loaders, verbatim', () => {
    expect(projectChips(['1.21.1'], ['fabric'])).toEqual(['1.21.x', 'fabric']);
    expect(projectChips(['1.20.1', '1.21', '1.21.4'], ['fabric', 'quilt'])).toEqual([
      '1.21.x',
      '1.20.x',
      'fabric',
      'quilt',
    ]);
  });

  it('drops the platform-noise loaders minecraft/datapack (the TypeBadge already says it)', () => {
    expect(projectChips(['1.21', '1.21.1'], ['minecraft'])).toEqual(['1.21.x']); // seed …0101
    expect(projectChips(['1.21'], ['datapack'])).toEqual(['1.21.x']); // seed …0103
  });
});

describe('gallery helpers (02 §2.1 #1, §2.3 #2)', () => {
  const base = [
    { url: 'https://cdn.modrinth.com/g1.png', title: 'In hand', ordering: 0, featured: false },
    { url: 'https://cdn.modrinth.com/g2.png', title: 'Bonk', ordering: 1, featured: true },
  ];

  it('parseGalleryEntries skips malformed items and resolves storage paths to public URLs', () => {
    const entries = parseGalleryEntries([
      ...base,
      { path: 'project-media/p1/gallery/x.png', ordering: 2 },
      { nope: true },
      'junk',
      null,
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[2]?.url).toContain('/storage/v1/object/public/project-media/p1/gallery/x.png');
  });

  it('mergeGallery puts the featured image first and always provides alt text', () => {
    const merged = mergeGallery(
      base,
      [{ path: 'project-media/p1/gallery/x.png', ordering: 0 }],
      'Metal Pipe Mace',
    );
    expect(merged.map((image) => image.alt)).toEqual([
      'Bonk', // featured first
      'In hand',
      'Metal Pipe Mace screenshot 3', // untitled extra falls back
    ]);
  });

  it('pickScreenshot: gallery head → icon → null (02 §2.1 hero rail)', () => {
    const merged = mergeGallery(base, null, 'Metal Pipe Mace');
    expect(pickScreenshot(merged, null, 'Metal Pipe Mace')).toEqual({
      url: 'https://cdn.modrinth.com/g2.png',
      alt: 'Bonk',
    });
    expect(pickScreenshot([], 'https://cdn.modrinth.com/icon.png', 'X')).toEqual({
      url: 'https://cdn.modrinth.com/icon.png',
      alt: 'X icon',
    });
    expect(pickScreenshot([], null, 'X')).toBeNull();
  });
});

describe('small predicates and URL builders', () => {
  it('T-UNIT-36 isExclusive: odsens source without cross-post links only (DESIGN.md §5 badge rule; 00 S1.3.AC8)', () => {
    expect(isExclusive('odsens')).toBe(true);
    expect(isExclusive('modrinth')).toBe(false);
    expect(isExclusive('odsens', [{ platform: 'curseforge' }])).toBe(false);
  });

  it('modrinthProjectUrl uses the type-neutral /project/ path (04 §5.2 remapped types)', () => {
    expect(modrinthProjectUrl('pixel-chameleon')).toBe(
      'https://modrinth.com/project/pixel-chameleon',
    );
  });

  it('resolveMediaUrl passes absolute URLs through and templates storage paths', () => {
    expect(resolveMediaUrl('https://cdn.modrinth.com/icon.png')).toBe(
      'https://cdn.modrinth.com/icon.png',
    );
    expect(resolveMediaUrl('project-media/p/icon/h.png')).toBe(
      publicStorageUrl('project-media/p/icon/h.png'),
    );
    expect(publicStorageUrl('project-media/p/icon/h.png')).toMatch(
      /\/storage\/v1\/object\/public\/project-media\/p\/icon\/h\.png$/,
    );
  });
});
