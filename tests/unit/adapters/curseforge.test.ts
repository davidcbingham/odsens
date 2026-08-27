/**
 * tests/unit/adapters/curseforge.test.ts — `lib/adapters/curseforge.ts` (05 T-ADP-7/8 + the
 * curseforge half of T-ADP-20; 04 §4.2 export list, §1.4 `ref` grammar).
 * Fixtures: `tests/fixtures/curseforge/{mod,search,error-403,error-404}.json` (F-5; `mod.json`
 * `data.id` 900001 backs SEED-6). Pure over `mockFetch` (05 H-5).
 */
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdapterError } from '@/lib/adapters/http';
import {
  CURSEFORGE_API,
  createCurseforge,
  parseRef,
  type CurseforgeMod,
} from '@/lib/adapters/curseforge';
import { loadFixture, loadFixtureText } from '../../helpers/fixtures';
import { mockFetch } from '../../helpers/mockFetch';

const UA = 'odsens.com/test (localhost)';
const KEY = 'test-cf-key';
const ENV = { CURSEFORGE_API_KEY: KEY, MODRINTH_USER_AGENT: UA };

const modFixture = await loadFixture<{ data: CurseforgeMod }>('curseforge', 'mod.json');
const searchFixture = await loadFixture('curseforge', 'search.json');

describe('T-ADP-7 curseforge (04 §4.2)', () => {
  it('T-ADP-7 getMod(900001) → {id, slug, downloadCount, links.websiteUrl} with x-api-key + Accept', async () => {
    const headers: Record<string, string | null> = {};
    const fetchSpy = vi.fn(
      mockFetch({
        'https://api.curseforge.com/v1/mods/900001': (request) => {
          headers['x-api-key'] = request.headers.get('x-api-key');
          headers.accept = request.headers.get('accept');
          headers['user-agent'] = request.headers.get('user-agent');
          return Response.json(modFixture);
        },
      }),
    );
    const curseforge = createCurseforge({ fetch: fetchSpy, env: ENV });
    const mod = await curseforge.getMod(900001);
    expect(mod).toMatchObject({
      id: 900001,
      slug: 'pixel-chameleon',
      downloadCount: 120,
      links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/pixel-chameleon' },
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.curseforge.com/v1/mods/900001');
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers.accept).toBe('application/json');
    expect(headers['user-agent']).toBe(UA); // SC-10: same UA to CurseForge
  });

  it('T-ADP-7 searchBySlug hits /mods/search?gameId=432&slug=…&pageSize=5 and equal-matches the slug', async () => {
    const fetchSpy = vi.fn(
      mockFetch({
        [`${CURSEFORGE_API}/mods/search?gameId=432&slug=seed-mod&pageSize=5`]: () =>
          Response.json(searchFixture),
      }),
    );
    const curseforge = createCurseforge({ fetch: fetchSpy, env: ENV });
    const match = await curseforge.searchBySlug('seed-mod');
    // Not the first result (`seed-mod-addon`) — the first whose slug EQUALS.
    expect(match?.id).toBe(900009);
    expect(match?.slug).toBe('seed-mod');
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://api.curseforge.com/v1/mods/search?gameId=432&slug=seed-mod&pageSize=5',
    );
  });

  it('T-ADP-7 searchBySlug with no equal slug → null', async () => {
    const impl = mockFetch({
      [`${CURSEFORGE_API}/mods/search?gameId=432&slug=golden-hotbar&pageSize=5`]: () =>
        Response.json(searchFixture),
    });
    const curseforge = createCurseforge({ fetch: impl, env: ENV });
    expect(await curseforge.searchBySlug('golden-hotbar')).toBeNull();
  });

  it.each([
    ['900001', { id: 900001 }],
    ['12345', { id: 12345 }],
    ['https://www.curseforge.com/minecraft/mc-mods/seed-mod', { slug: 'seed-mod' }],
    ['https://curseforge.com/minecraft/texture-packs/metal-pipe-mace', { slug: 'metal-pipe-mace' }],
    ['https://www.curseforge.com/minecraft/data-packs/heavy-spear', { slug: 'heavy-spear' }],
    ['12345678901', null], // 11 digits — over the §1.4 limit
    ['https://www.curseforge.com/minecraft/customization/thing', null], // section not in the grammar
    ['https://example.com/minecraft/mc-mods/seed-mod', null],
    ['seed-mod', null],
  ] as const)('T-ADP-7 parseRef(%j) → %j', (ref, expected) => {
    expect(parseRef(ref)).toEqual(expected);
  });

  it('T-ADP-7 / T-ADP-20 missing key → createCurseforge throws a zod error, no request', () => {
    const fetchSpy = vi.fn(mockFetch({}));
    let thrown: unknown;
    try {
      createCurseforge({ fetch: fetchSpy, env: { MODRINTH_USER_AGENT: UA } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZodError);
    expect((thrown as ZodError).issues.map((issue) => issue.path.join('.'))).toContain(
      'CURSEFORGE_API_KEY',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-ADP-20 missing UA → createCurseforge throws a zod error naming MODRINTH_USER_AGENT', () => {
    let thrown: unknown;
    try {
      createCurseforge({ env: { CURSEFORGE_API_KEY: KEY } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZodError);
    expect((thrown as ZodError).issues.map((issue) => issue.path.join('.'))).toContain(
      'MODRINTH_USER_AGENT',
    );
  });

  it('T-ADP-7 calls are strictly sequential (quota unknown → one at a time)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const fetchSpy = vi.fn(async () => {
      started += 1;
      if (started === 1) await gate;
      return Response.json(modFixture);
    }) as unknown as typeof fetch;
    const curseforge = createCurseforge({ fetch: fetchSpy, env: ENV });
    const first = curseforge.getMod(900001);
    const second = curseforge.getMod(900001);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toBe(1); // second call queued behind the gate
    release();
    await Promise.all([first, second]);
    expect(started).toBe(2);
  });
});

describe('T-ADP-8 curseforge errors', () => {
  it('T-ADP-8 error-403.json → AdapterError {status: 403}, not retried', async () => {
    const body = await loadFixtureText('curseforge', 'error-403.json');
    const fetchSpy = vi.fn(
      mockFetch({
        [`${CURSEFORGE_API}/mods/900001`]: () => new Response(body, { status: 403 }),
      }),
    );
    const curseforge = createCurseforge({ fetch: fetchSpy, env: ENV });
    const error = await curseforge.getMod(900001).then(
      () => null,
      (thrown: unknown) => thrown as AdapterError,
    );
    expect(error).toBeInstanceOf(AdapterError);
    expect(error?.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(error?.message ?? '').not.toContain(KEY); // the key never leaks into the error
  });

  it('T-ADP-8 error-404.json → AdapterError {status: 404}', async () => {
    const body = await loadFixtureText('curseforge', 'error-404.json');
    const impl = mockFetch({
      [`${CURSEFORGE_API}/mods/900404`]: () => new Response(body, { status: 404 }),
    });
    const curseforge = createCurseforge({ fetch: impl, env: ENV });
    await expect(curseforge.getMod(900404)).rejects.toMatchObject({ status: 404 });
  });

  it('T-ADP-8 malformed body ({}) → typed parse_error', async () => {
    const impl = mockFetch({
      [`${CURSEFORGE_API}/mods/900001`]: () => Response.json({}),
    });
    const curseforge = createCurseforge({ fetch: impl, env: ENV });
    await expect(curseforge.getMod(900001)).rejects.toMatchObject({ code: 'parse_error' });
  });
});
