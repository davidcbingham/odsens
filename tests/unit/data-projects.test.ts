/**
 * tests/unit/data-projects.test.ts — pure pieces of `lib/data/projects.ts`.
 *
 * Supplementary tests (the S1.2 §8 row assigns no IDs to the data layer; the featured behaviour
 * itself is e2e-proved by T-E2E-1 and the AC is 00 S1.2.AC7) plus two 05 IDs: T-UNIT-36
 * (`isExclusive` — amended by ADR-0037 D7 to state parity with the view column `is_exclusive`)
 * and T-UNIT-49 (ADR-0037 D6 read model: per-file `href`/`kind`, CDN-only rows hidden while
 * exclusive, the Modrinth-home fallback of `pickPrimaryFile`, `platformRows`, `modrinthHome`).
 * Covers the pure helpers only: `selectFeatured` (02 §2.1 #1/#2 verbatim, seed arrangement from
 * SEED-6), `isNewProject` (ADR-0002 #41), `projectChips`, `parseGalleryEntries`/`mergeGallery`/
 * `pickScreenshot` (02 §2.1 #1, §2.3 #2), `resolveMediaUrl`. The cached readers
 * (`listPublishedProjects`, `getProjectDetail`, `resolveProjectPage`, `getHomeFeatured`) hit the
 * DB and are exercised by the page e2e, not here (unit = no network, 05 §1.1).
 */
import { describe, expect, it } from 'vitest';
import {
  fileHref,
  fileKind,
  isExclusive,
  isNewProject,
  applyGalleryOverrides,
  parseGalleryOverrides,
  mergeGallery,
  modrinthHome,
  parseGalleryEntries,
  pickPrimaryFile,
  pickScreenshot,
  platformRows,
  projectChips,
  projectVersions,
  publicStorageUrl,
  resolveMediaUrl,
  selectFeatured,
  type FeaturedCandidate,
  type RawFile,
  type RawVersion,
} from '@/lib/data/projects';
import { modrinthListingUrl } from '@/lib/format/project';

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
  it('version groups (newest first) then loaders as display names (ADR-0034 D2)', () => {
    expect(projectChips(['1.21.1'], ['fabric'])).toEqual(['1.21.x', 'Fabric']);
    expect(projectChips(['1.20.1', '1.21', '1.21.4'], ['fabric', 'neoforge'])).toEqual([
      '1.21.x',
      '1.20.x',
      'Fabric',
      'NeoForge',
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
  it('T-UNIT-36 isExclusive: odsens source without cross-post links only — the same predicate as the view column is_exclusive (ADR-0037 D7; DESIGN.md §5 badge rule; 00 S1.3.AC8, S1.5a.AC5)', () => {
    // Parity with `projects_public.is_exclusive` =
    //   (p.source = 'odsens' and not exists (select 1 from project_links l where l.project_id = p.id)):
    expect(isExclusive('odsens')).toBe(true);
    expect(isExclusive('modrinth')).toBe(false);
    expect(isExclusive('odsens', [{ platform: 'curseforge' }])).toBe(false);
    expect(isExclusive('odsens', [{ platform: 'modrinth' }])).toBe(false); // a Modrinth link too
    expect(isExclusive('modrinth', [{ platform: 'curseforge' }])).toBe(false);
  });

  it('modrinthHome: a synced row → the listing page from external_id; an odsens row → its modrinth link; else null (ADR-0037 D6)', () => {
    expect(modrinthHome('modrinth', 'sd000102', [])).toBe(modrinthListingUrl('sd000102'));
    expect(modrinthHome('modrinth', 'sd000102', [])).toBe('https://modrinth.com/project/sd000102');
    // The id, never our (normalised) slug — ADR-0034 D1.
    expect(modrinthHome('modrinth', null, [])).toBeNull(); // data guard
    expect(
      modrinthHome('odsens', null, [
        { platform: 'curseforge', url: 'https://www.curseforge.com/minecraft/mc-mods/x' },
        { platform: 'modrinth', url: 'https://modrinth.com/project/AANobbMI' },
      ]),
    ).toBe('https://modrinth.com/project/AANobbMI');
    expect(modrinthHome('odsens', null, [])).toBeNull();
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

describe('T-UNIT-49 read model per ADR-0037 D6 (per-file href/kind, hidden CDN rows, primary fallback, rows)', () => {
  const HOME = 'https://modrinth.com/project/sd000102';
  const rawFile = (over: Partial<RawFile> & Pick<RawFile, 'id'>): RawFile => ({
    filename: `${over.id}.jar`,
    size_bytes: 1024,
    sha512: null,
    url: null,
    storage_path: null,
    primary: false,
    ...over,
  });
  const hostedFile = (id: string, primary = true) =>
    rawFile({ id, storage_path: `project-media/p/files/${id}.jar`, primary });
  const cdnFile = (id: string, primary = true) =>
    rawFile({ id, url: `https://cdn.modrinth.com/data/sd000102/versions/${id}.jar`, primary });
  const rawVersion = (
    id: string,
    datePublished: string,
    files: RawFile[],
    over: Partial<RawVersion> = {},
  ): RawVersion => ({
    id,
    version_number: id,
    name: null,
    changelog_md: null,
    game_versions: ['1.21.4'],
    loaders: ['fabric'],
    date_published: datePublished,
    project_files: files,
    ...over,
  });

  it('T-UNIT-49 fileKind/fileHref: hosted → /api/download/<id> (direct) on any source; CDN-only → url (modrinth)', () => {
    const hosted = hostedFile('f-h');
    const cdn = cdnFile('f-c');
    expect(fileKind(hosted)).toBe('direct');
    expect(fileKind(cdn)).toBe('modrinth');
    expect(fileHref(hosted, null)).toBe('/api/download/f-h');
    expect(fileHref(hosted, HOME)).toBe('/api/download/f-h'); // a home never changes a hosted href
    expect(fileHref(cdn, null)).toBe(cdn.url);
    // Data guard: a CDN row with no url → the project's Modrinth page; no home either → null (dropped).
    expect(fileHref(rawFile({ id: 'f-x' }), HOME)).toBe(HOME);
    expect(fileHref(rawFile({ id: 'f-x' }), null)).toBeNull();
  });

  it('T-UNIT-49 projectVersions: per-file href/kind, loaders as display names, hostedFirst order left to the table', () => {
    const versions = projectVersions(
      [rawVersion('1.0.0', '2026-01-01T00:00:00Z', [cdnFile('f-c'), hostedFile('f-h')])],
      { modrinthHomeUrl: HOME, exclusive: false },
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]?.loaders).toEqual(['Fabric']);
    expect(versions[0]?.files.map((f) => [f.id, f.kind, f.href])).toEqual([
      ['f-c', 'modrinth', 'https://cdn.modrinth.com/data/sd000102/versions/f-c.jar'],
      ['f-h', 'direct', '/api/download/f-h'],
    ]);
  });

  it('T-UNIT-49 CDN-only rows are hidden while is_exclusive; a version left empty is dropped; they return once linked', () => {
    const raw = [
      rawVersion('2.0.0', '2026-02-01T00:00:00Z', [cdnFile('f-c2')]), // adopted, CDN-only
      rawVersion('1.0.0', '2026-01-01T00:00:00Z', [hostedFile('f-h1'), cdnFile('f-c1', false)]),
    ];
    const unlinked = projectVersions(raw, { modrinthHomeUrl: null, exclusive: true });
    expect(unlinked.map((v) => [v.id, v.files.map((f) => f.id)])).toEqual([['1.0.0', ['f-h1']]]);
    const linked = projectVersions(raw, { modrinthHomeUrl: HOME, exclusive: false });
    expect(linked.map((v) => [v.id, v.files.map((f) => f.id)])).toEqual([
      ['2.0.0', ['f-c2']],
      ['1.0.0', ['f-h1', 'f-c1']],
    ]);
  });

  it('T-UNIT-49 pickPrimaryFile: the hosted primary of the newest version with a hosted file, on any source', () => {
    const raw = [
      rawVersion('2.0.0', '2026-02-01T00:00:00Z', [cdnFile('f-c2')]), // newer, CDN-only
      rawVersion('1.0.0', '2026-01-01T00:00:00Z', [cdnFile('f-c1'), hostedFile('f-h1')]),
    ];
    const pick = pickPrimaryFile(raw, { modrinthHomeUrl: HOME, exclusive: false });
    expect(pick?.kind).toBe('direct');
    expect(pick?.file.id).toBe('f-h1');
    expect(pick?.file.href).toBe('/api/download/f-h1');
    // The same answer with no Modrinth home (an exclusive): hosted wins regardless.
    expect(pickPrimaryFile(raw, { modrinthHomeUrl: null, exclusive: true })?.file.id).toBe('f-h1');
  });

  it("T-UNIT-49 pickPrimaryFile: no hosted file + a Modrinth home → kind 'modrinth' with the newest version's CDN file meta (today's rule)", () => {
    const raw = [
      rawVersion('1.0.0', '2026-01-01T00:00:00Z', [cdnFile('f-c1')]),
      rawVersion('2.0.0', '2026-02-01T00:00:00Z', [cdnFile('f-c2-src', false), cdnFile('f-c2')]),
    ];
    const pick = pickPrimaryFile(raw, { modrinthHomeUrl: HOME, exclusive: false });
    expect(pick?.kind).toBe('modrinth');
    expect(pick?.file.id).toBe('f-c2'); // newest version, primary first
    expect(pick?.file.href).toBe('https://cdn.modrinth.com/data/sd000102/versions/f-c2.jar');
  });

  it('T-UNIT-49 pickPrimaryFile: no hosted file and no home → null (no panel); hidden CDN rows never become the primary', () => {
    const raw = [rawVersion('1.0.0', '2026-01-01T00:00:00Z', [cdnFile('f-c1')])];
    expect(pickPrimaryFile(raw, { modrinthHomeUrl: null, exclusive: true })).toBeNull();
    expect(pickPrimaryFile(raw, { modrinthHomeUrl: null, exclusive: false })).toBeNull();
    expect(pickPrimaryFile([], { modrinthHomeUrl: HOME, exclusive: false })).toBeNull();
  });

  it('T-UNIT-49 platformRows: from source OR links, counts from the per-platform columns, Modrinth first (00 S1.5a.AC6)', () => {
    const counts = { modrinth: 1568, curseforge: 120 };
    const cf = {
      platform: 'curseforge' as const,
      url: 'https://www.curseforge.com/minecraft/mc-mods/pc',
    };
    // A synced row: Modrinth from `source` (listing URL from the id), CurseForge from its link.
    expect(platformRows('modrinth', 'sd000102', [cf], counts)).toEqual([
      { platform: 'modrinth', url: HOME, downloads: 1568 },
      { platform: 'curseforge', url: cf.url, downloads: 120 },
    ]);
    // An odsens row linked to Modrinth: the link's URL, the project's downloads_modrinth.
    const mr = { platform: 'modrinth' as const, url: 'https://modrinth.com/project/AANobbMI' };
    expect(platformRows('odsens', null, [cf, mr], counts)).toEqual([
      { platform: 'modrinth', url: mr.url, downloads: 1568 },
      { platform: 'curseforge', url: cf.url, downloads: 120 },
    ]);
    // An exclusive: no rows at all.
    expect(platformRows('odsens', null, [], counts)).toEqual([]);
  });
});

// T-UNIT-51 — ADR-0038 D3: per-image curation of a synced gallery (hide / rename), applied on read.
describe('T-UNIT-51 gallery overrides (ADR-0038 D3)', () => {
  const base = [
    { url: 'https://cdn.modrinth.com/g1.png', title: 'In hand', ordering: 0, featured: false },
    { url: 'https://cdn.modrinth.com/g2.png', title: 'Bonk', ordering: 1, featured: true },
    { url: 'https://cdn.modrinth.com/g3.png', title: null, ordering: 2, featured: false },
  ];

  it('parseGalleryOverrides keeps well-formed entries only and normalises hidden/title', () => {
    expect(
      parseGalleryOverrides([
        { url: 'https://cdn.modrinth.com/g1.png', hidden: true },
        { url: 'https://cdn.modrinth.com/g2.png', title: 'Renamed' },
        { url: 'https://cdn.modrinth.com/g3.png', title: '' },
        { url: '' },
        'nope',
        null,
        { hidden: true },
      ]),
    ).toEqual([
      { url: 'https://cdn.modrinth.com/g1.png', hidden: true, title: null },
      { url: 'https://cdn.modrinth.com/g2.png', hidden: false, title: 'Renamed' },
      { url: 'https://cdn.modrinth.com/g3.png', hidden: false, title: null },
    ]);
    expect(parseGalleryOverrides(null)).toEqual([]);
    expect(parseGalleryOverrides('[]')).toEqual([]);
  });

  it('applyGalleryOverrides drops hidden images and swaps in an overridden title, nothing else', () => {
    const entries = parseGalleryEntries(base);
    const out = applyGalleryOverrides(entries, [
      { url: 'https://cdn.modrinth.com/g1.png', hidden: true },
      { url: 'https://cdn.modrinth.com/g2.png', title: 'Renamed bonk' },
      { url: 'https://cdn.modrinth.com/nope.png', hidden: true }, // unknown url — ignored
    ]);
    expect(out.map((entry) => [entry.url, entry.title])).toEqual([
      ['https://cdn.modrinth.com/g2.png', 'Renamed bonk'],
      ['https://cdn.modrinth.com/g3.png', null],
    ]);
    // No overrides → the same entries, a fresh array.
    const same = applyGalleryOverrides(entries, null);
    expect(same).toEqual(entries);
    expect(same).not.toBe(entries);
  });

  it('mergeGallery applies the overrides to the synced entries only; uploaded extras are untouched', () => {
    const merged = mergeGallery(
      base,
      [{ path: 'project-media/p1/gallery/x.png', title: 'Mine', ordering: 0 }],
      'Metal Pipe Mace',
      [
        { url: 'https://cdn.modrinth.com/g2.png', hidden: true }, // the featured one — gone
        { url: 'https://cdn.modrinth.com/g1.png', title: 'Held' },
      ],
    );
    expect(merged.map((image) => image.alt)).toEqual([
      'Held',
      'Mine',
      'Metal Pipe Mace screenshot 3',
    ]);
    expect(merged.some((image) => image.url.endsWith('/g2.png'))).toBe(false);
  });
});
