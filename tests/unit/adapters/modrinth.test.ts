/**
 * tests/unit/adapters/modrinth.test.ts — `lib/adapters/modrinth.ts` (05 T-ADP-2..6 + the modrinth
 * half of T-ADP-20; 04 §4.1 export list, §5.2 P1–P5, §3.1 step 2/3 shapes; ADR-0002 #77).
 * Fixtures: `tests/fixtures/modrinth/{user-projects,versions,versions-empty,error-429}.json`
 * (F-5; `user-projects.json` carries the docs/spec.md §3 snapshot — 18 projects, seed-aligned
 * external ids `sd000101`/`sd000102`). Pure over `mockFetch` (05 H-5); quota waits via fake timers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import {
  MODRINTH_API,
  MOD_LOADERS,
  PLUGIN_LOADERS,
  createModrinth,
  mapProject,
  mapProjectType,
  mapVersion,
  type ModrinthProject,
  type ModrinthVersion,
} from '@/lib/adapters/modrinth';
import { loadFixture, loadFixtureText } from '../../helpers/fixtures';
import { mockFetch } from '../../helpers/mockFetch';

const UA = 'odsens.com/test (localhost)';
const ENV = { MODRINTH_USER_AGENT: UA };

const projects = await loadFixture<ModrinthProject[]>('modrinth', 'user-projects.json');
const versionsFixture = await loadFixture<ModrinthVersion[]>('modrinth', 'versions.json');

function bySlug(slug: string): ModrinthProject {
  const found = projects.find((project) => project.slug === slug);
  if (!found) throw new Error(`fixture project ${slug} missing from user-projects.json`);
  return found;
}

function versionByNumber(versionNumber: string): ModrinthVersion {
  const found = versionsFixture.find((version) => version.version_number === versionNumber);
  if (!found) throw new Error(`fixture version ${versionNumber} missing from versions.json`);
  return found;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('T-ADP-2 mapProjectType (04 §5.2 P1–P5)', () => {
  it('T-ADP-2 constants are the 04 §5.2 loader sets verbatim', () => {
    expect([...PLUGIN_LOADERS].sort()).toEqual(
      [
        'paper',
        'spigot',
        'bukkit',
        'purpur',
        'folia',
        'velocity',
        'bungeecord',
        'waterfall',
        'sponge',
      ].sort(),
    );
    expect([...MOD_LOADERS].sort()).toEqual(
      ['fabric', 'forge', 'neoforge', 'quilt', 'liteloader', 'rift', 'modloader'].sort(),
    );
  });

  it.each([
    // P1 — resourcepack, any loaders
    ['resourcepack', [], 'resourcepack'],
    ['resourcepack', ['minecraft'], 'resourcepack'],
    // P2 — mod whose loaders are non-empty and all `datapack`
    ['mod', ['datapack'], 'datapack'],
    // P3 — plugin loaders only
    ['mod', ['paper', 'velocity'], 'plugin'],
    // P4 — anything else, incl. fabric+datapack, paper+fabric and empty
    ['mod', ['fabric'], 'mod'],
    ['mod', ['fabric', 'datapack'], 'mod'],
    ['mod', ['paper', 'fabric'], 'mod'],
    ['mod', [], 'mod'],
    // P5 — unsupported types are skipped (null)
    ['shader', ['iris'], null],
    ['modpack', ['forge'], null],
    ['plugin', ['paper'], null],
  ] as const)('T-ADP-2 (%s, %j) → %j', (projectType, loaders, expected) => {
    expect(mapProjectType(projectType, [...loaders])).toBe(expected);
  });

  it.each([...PLUGIN_LOADERS])('T-ADP-2 (mod, [%s]) alone → plugin', (loader) => {
    expect(mapProjectType('mod', [loader])).toBe('plugin');
  });

  it('T-ADP-2 loader match is case-insensitive', () => {
    expect(mapProjectType('mod', ['Paper'])).toBe('plugin');
    expect(mapProjectType('mod', ['DATAPACK'])).toBe('datapack');
    expect(mapProjectType('mod', ['Fabric', 'PAPER'])).toBe('mod');
  });

  it('T-ADP-2 the 04 §5.2 named examples hold on the fixture projects', () => {
    const cases: [string, string][] = [
      ['heavy-spear', 'datapack'], // Heavy Spear datapack [datapack]
      ['legacy-manhunts-reworked', 'plugin'], // Legacy Manhunts Reworked [paper]
      ['pixel-chameleon', 'mod'], // Pixel Chameleon [fabric]
      ['metal-pipe-mace', 'resourcepack'], // Metal Pipe Mace resourcepack
    ];
    for (const [slug, expected] of cases) {
      const project = bySlug(slug);
      expect(mapProjectType(project.project_type, project.loaders ?? []), slug).toBe(expected);
    }
  });
});

describe('T-ADP-3 listUserProjects', () => {
  it("T-ADP-3 listUserProjects('OddSense') → 18 items via the real host URL", async () => {
    const fetchSpy = vi.fn(
      mockFetch({
        'https://api.modrinth.com/v2/user/OddSense/projects': () => Response.json(projects),
      }),
    );
    const modrinth = createModrinth({ fetch: fetchSpy, env: ENV });
    const items = await modrinth.listUserProjects('OddSense');
    expect(items).toHaveLength(18);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.modrinth.com/v2/user/OddSense/projects');
  });

  it('T-ADP-3 / T-ADP-20 missing UA env → createModrinth throws a zod error, no request', () => {
    const fetchSpy = vi.fn(mockFetch({}));
    let thrown: unknown;
    try {
      createModrinth({ fetch: fetchSpy, env: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZodError);
    expect((thrown as ZodError).issues.map((issue) => issue.path.join('.'))).toContain(
      'MODRINTH_USER_AGENT',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('T-ADP-4 mapProject (04 §3.1 step 2)', () => {
  it('T-ADP-4 maps every field of the metal-pipe-mace fixture (gallery sorted by ordering)', () => {
    expect(mapProject(bySlug('metal-pipe-mace'))).toEqual({
      external_id: 'sd000101',
      slug: 'metal-pipe-mace',
      project_type: 'resourcepack',
      title: 'Metal Pipe Mace',
      description: 'The mace, but it is a metal pipe. Sound included.',
      body_md:
        '## What it does\n\nSwaps the mace model and swing sound for a metal pipe. That is the whole pack.',
      icon_url: 'https://cdn.modrinth.com/data/sd000101/icon.png',
      gallery: [
        {
          url: 'https://cdn.modrinth.com/data/sd000101/images/gallery-1.png',
          title: 'In hand',
          description: null,
          ordering: 0,
          featured: true,
        },
        {
          url: 'https://cdn.modrinth.com/data/sd000101/images/gallery-2.png',
          title: 'Bonk',
          description: null,
          ordering: 1,
          featured: false,
        },
      ],
      categories: ['audio', 'themed'], // categories ∪ additional_categories
      loaders: ['minecraft'],
      game_versions: ['1.21', '1.21.1'],
      license: null,
      source_url: null,
      issues_url: null,
      discord_url: null,
      downloads_modrinth: 2531,
      followers: 12,
      published_at: new Date('2025-01-10T12:00:00Z'),
      external_updated_at: new Date('2026-06-01T12:00:00Z'),
    });
  });

  it('T-ADP-4 gallery ties on ordering break on created', () => {
    const row = mapProject(bySlug('heavy-spear-pack'));
    expect(row.gallery.map((item) => item.title)).toEqual(['Spear front', 'Spear side']);
  });

  it('T-ADP-4 license.id → license, source/issues urls kept', () => {
    const row = mapProject(bySlug('essential-dark-pack-fix'));
    expect(row.license).toBe('MIT');
    expect(row.source_url).toBe('https://github.com/odsens/essential-dark-pack-fix');
    expect(row.issues_url).toBe('https://github.com/odsens/essential-dark-pack-fix/issues');
  });

  it('T-ADP-4 categories are the union with additional_categories', () => {
    expect(mapProject(bySlug('legacy-manhunts-reworked')).categories).toEqual([
      'game-mechanics',
      'multiplayer',
    ]);
  });

  it('T-ADP-4 missing optional fields become NULL — never undefined or ""', () => {
    const row = mapProject({
      id: 'x1',
      slug: 'bare',
      project_type: 'mod',
      title: 'Bare',
      description: 'Bare mod.',
    });
    expect(row.body_md).toBeNull();
    expect(row.icon_url).toBeNull();
    expect(row.license).toBeNull();
    expect(row.source_url).toBeNull();
    expect(row.issues_url).toBeNull();
    expect(row.discord_url).toBeNull();
    expect(row.published_at).toBeNull();
    expect(row.external_updated_at).toBeNull();
    expect(row.gallery).toEqual([]);
    expect(row.categories).toEqual([]);
    expect(row.loaders).toEqual([]);
    expect(row.game_versions).toEqual([]);
    expect(row.downloads_modrinth).toBe(0);
    expect(row.followers).toBe(0);
    for (const [key, value] of Object.entries(row)) {
      expect(value, key).not.toBeUndefined();
      expect(value, key).not.toBe('');
    }
  });

  it('T-ADP-4 empty strings coerce to NULL too', () => {
    const row = mapProject({
      id: 'x2',
      slug: 'blank',
      project_type: 'mod',
      title: 'Blank',
      description: 'Blank mod.',
      body: '',
      icon_url: '',
      license: { id: '' },
    });
    expect(row.body_md).toBeNull();
    expect(row.icon_url).toBeNull();
    expect(row.license).toBeNull();
  });
});

describe('T-ADP-5 mapVersion / listVersions (04 §3.1 step 3; ADR-0002 #77)', () => {
  it('T-ADP-5 maps the beta version and keeps exactly the flagged primary file', () => {
    const { version, files } = mapVersion(versionByNumber('2.0.0-beta.1'));
    expect(version).toEqual({
      external_id: 'sdv00404',
      version_number: '2.0.0-beta.1',
      name: '2.0.0-beta.1',
      changelog_md: '## 2.0.0-beta.1\n\n- New blending engine\n- Fixed the invisible tail',
      game_versions: ['1.21.1'],
      loaders: ['fabric'],
      version_type: 'beta',
      date_published: new Date('2026-07-15T12:00:00Z'),
      downloads: 210,
    });
    expect(files).toEqual([
      {
        filename: 'pixel-chameleon-2.0.0-beta.1-sources.jar',
        size_bytes: 92160,
        sha512: null, // hashes.sha512 ?? null
        url: 'https://cdn.modrinth.com/data/sd000102/versions/sdv00404/pixel-chameleon-2.0.0-beta.1-sources.jar',
        primary: false,
        storage_path: null,
      },
      {
        filename: 'pixel-chameleon-2.0.0-beta.1.jar',
        size_bytes: 181248,
        sha512: versionByNumber('2.0.0-beta.1').files?.[1]?.hashes?.sha512 ?? null,
        url: 'https://cdn.modrinth.com/data/sd000102/versions/sdv00404/pixel-chameleon-2.0.0-beta.1.jar',
        primary: true,
        storage_path: null,
      },
    ]);
    expect(files.filter((file) => file.primary)).toHaveLength(1);
  });

  it('T-ADP-5 a version with no file flagged primary promotes the first', () => {
    const { files } = mapVersion(versionByNumber('1.2.0'));
    expect(files.map((file) => file.primary)).toEqual([true, false]);
  });

  it("T-ADP-5 unknown version_type → 'release' (ADR-0002 #77); release/beta/alpha pass through", () => {
    const beta = versionByNumber('2.0.0-beta.1');
    expect(mapVersion({ ...beta, version_type: 'weird' }).version.version_type).toBe('release');
    expect(mapVersion({ ...beta, version_type: undefined }).version.version_type).toBe('release');
    expect(mapVersion({ ...beta, version_type: 'alpha' }).version.version_type).toBe('alpha');
    expect(mapVersion(versionByNumber('1.0.0')).version.version_type).toBe('release');
  });

  it('T-ADP-5 empty changelog becomes NULL', () => {
    expect(mapVersion(versionByNumber('1.2.0')).version.changelog_md).toBeNull();
  });

  it('T-ADP-5 listVersions returns the raw list; versions-empty.json → []', async () => {
    const impl = mockFetch({
      [`${MODRINTH_API}/project/sd000102/version`]: async () =>
        new Response(await loadFixtureText('modrinth', 'versions.json'), { status: 200 }),
      [`${MODRINTH_API}/project/sd000110/version`]: async () =>
        new Response(await loadFixtureText('modrinth', 'versions-empty.json'), { status: 200 }),
    });
    const modrinth = createModrinth({ fetch: impl, env: ENV });
    const listed = await modrinth.listVersions('sd000102');
    expect(listed).toHaveLength(3);
    expect(listed[0]?.id).toBe('sdv00404');
    expect(await modrinth.listVersions('sd000110')).toEqual([]);
  });
});

describe('T-ADP-6 modrinth rate limiting (04 §4.1 quota)', () => {
  it('T-ADP-6 remaining < 5 → the next call sleeps until reset', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const t0 = Date.now();
    const impl = mockFetch({
      [`${MODRINTH_API}/project/sd000102/version`]: () => {
        times.push(Date.now() - t0);
        return new Response('[]', {
          status: 200,
          headers: { 'X-Ratelimit-Remaining': '4', 'X-Ratelimit-Reset': '5' },
        });
      },
    });
    const modrinth = createModrinth({ fetch: impl, env: ENV });
    await modrinth.listVersions('sd000102');
    const second = modrinth.listVersions('sd000102');
    await vi.advanceTimersByTimeAsync(4999);
    expect(times).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(times).toEqual([0, 5000]);
  });

  it('T-ADP-6 remaining ≥ 5 → no wait', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const t0 = Date.now();
    const impl = mockFetch({
      [`${MODRINTH_API}/project/sd000102/version`]: () => {
        times.push(Date.now() - t0);
        return new Response('[]', {
          status: 200,
          headers: { 'X-Ratelimit-Remaining': '5', 'X-Ratelimit-Reset': '5' },
        });
      },
    });
    const modrinth = createModrinth({ fetch: impl, env: ENV });
    await modrinth.listVersions('sd000102');
    await modrinth.listVersions('sd000102');
    expect(times).toEqual([0, 0]);
  });

  it('T-ADP-6 the error-429.json path retries with the reset header honoured', async () => {
    vi.useFakeTimers();
    const body429 = await loadFixtureText('modrinth', 'error-429.json');
    const times: number[] = [];
    const t0 = Date.now();
    const impl = mockFetch({
      [`${MODRINTH_API}/user/OddSense/projects`]: () => {
        times.push(Date.now() - t0);
        return times.length === 1
          ? new Response(body429, { status: 429, headers: { 'X-Ratelimit-Reset': '2' } })
          : Response.json([]);
      },
    });
    const modrinth = createModrinth({ fetch: impl, env: ENV });
    const promise = modrinth.listUserProjects('OddSense');
    await vi.runAllTimersAsync();
    expect(await promise).toEqual([]);
    expect(times).toEqual([0, 2000]); // reset 2 s > backoff 1 s
  });
});
