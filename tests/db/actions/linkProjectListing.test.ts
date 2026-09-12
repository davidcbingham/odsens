/**
 * tests/db/actions/linkProjectListing.test.ts — T-ACT-41 (the `curseforge` case) + T-ACT-79 (the
 * `modrinth` case) (05 §7.2; 04 §1.4 `linkProjectListing`; ADR-0037 D1; ADR-0002 C7; migrations
 * 20260827090200, 20260911120000 `project_links_platform_external_id_key`; fixtures
 * `curseforge/mod.json`, `search.json`, `error-404.json`, `modrinth/project/sd000199.json`).
 *
 * CurseForge ids: the seed already holds `900001` (`mod.json`) on pixel-chameleon (SEED-6), and the
 * D1 unique index `project_links_platform_external_id_key` makes a second link to it a `conflict`
 * — so the success paths link the UNSEEDED `search.json` entries `900008` (`seed-mod-addon`) and
 * `900009` (`seed-mod`), served as `getMod` answers derived in memory from that fixture (the
 * T-ACT-49 derivation precedent); `900001` is asserted as the seed's `conflict`.
 *
 * Harness per 05 §7.2: the action builds the adapters from `lib/env.ts`, so `spyFetch` routes the
 * fixture-server URLs (`CURSEFORGE_API_BASE` / `MODRINTH_API_BASE`, ADR-0002 #73) to
 * `tests/fixtures/*` and asserts the `x-api-key` header on the CurseForge side. Success calls run
 * as a FACTORY admin so the seed admin's `project_link` budget (30 / hour) stays untouched for
 * other files; factory projects' link rows fall to the FK cascade in `cleanupFactories`. The
 * rate-limit rows arrange 30 hits directly in `rate_limit_hits` (the only table `rate_limit_ok`
 * counts — ADR-0002 A4) on a burner admin, so the 31st call is the action's own.
 *
 * T-ACT-41 (numbers kept, ADR-0037 D11): digits ref → `getMod`; URL ref → `searchBySlug`; both
 * upsert `project_links` AND set `projects.downloads_curseforge` immediately; unknown slug / CF
 * 404 → `not_found`; `CURSEFORGE_API_KEY` unset → `upstream_error` "CurseForge key not
 * configured"; the S1.3 "exclusive → validation" refusal is GONE (an exclusive gains the link and
 * loses `is_exclusive`); a listing linked elsewhere → `conflict`; SC-24 audit line; revalidates
 * `projects` + `project:<slug>`. The `ref:null` clause moved to T-ACT-80 (`unlinkProjectListing`).
 * T-ACT-79: URL / slug / id refs → `getProject` fixture → link row `{external_id: raw.id, url:
 * modrinthListingUrl(id), downloads}` + `downloads_modrinth`; the same id is idempotent; a
 * different listing while linked → `conflict` "Remove the current Modrinth listing first."; a
 * listing linked to another project → `conflict` "…already linked to <title>."; a
 * `source='modrinth'` row → `validation`; unknown listing → `not_found`; Modrinth 5xx → `upstream_error`;
 * a 200 body without a well-formed id → `upstream_error` (nothing written); a competing link
 * raced between the holder check and the upsert → 23505 → `conflict` (the D1 unique index);
 * other hosts → `validation`; never calls `listVersions`. The fold path (link written BEFORE the
 * fold) is T-ACT-81 in `linkProjectListing.fold.test.ts` (H-4: the fold is this action's step (c)).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { linkProjectListing } from '@/lib/actions/projects';
import type { LinkProjectListingInput } from '@/lib/actions/projects.schema';
import { env } from '@/lib/env';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import {
  expectInternal,
  withDbFault,
  withDbHook,
  type DbCallTarget,
} from '@/tests/helpers/dbFault';
import { cleanupFactories, makeProject, makeUser } from '@/tests/helpers/factories';
import {
  spyFetch,
  spyLog,
  spyRevalidateTag,
  type FetchSpy,
  type LogSpy,
} from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const CF_BASE = process.env.CURSEFORGE_API_BASE ?? '';
const CF_KEY = process.env.CURSEFORGE_API_KEY ?? '';
const SEED_HELD_URL = `${CF_BASE}/mods/900001`;
const MOD_URL = `${CF_BASE}/mods/900008`;
const SEED_MOD_URL = `${CF_BASE}/mods/900009`;
const MISSING_URL = `${CF_BASE}/mods/31337`;
const SEARCH_URL = `${CF_BASE}/mods/search`;

const MR_BASE = process.env.MODRINTH_API_BASE ?? '';
/** `modrinth/project/sd000199.json` — id `sd000199`, slug `e2e-cross-post`, 4321 downloads. */
const LISTING_ID = 'sd000199';
const LISTING_SLUG = 'e2e-cross-post';
const LISTING_DOWNLOADS = 4321;
const LISTING_PAGE = 'https://modrinth.com/project/sd000199';
const LISTING_URL = `${MR_BASE}/project/${LISTING_ID}`;
const LISTING_SLUG_URL = `${MR_BASE}/project/${LISTING_SLUG}`;
const LISTING_VERSIONS_URL = `${MR_BASE}/project/${LISTING_ID}/version`;
const MISSING_LISTING_URL = `${MR_BASE}/project/no-such-listing`;
/** A second listing, derived in-memory (T-ACT-49 precedent) — never a `projects` row, so no fold. */
const OTHER_LISTING_ID = 't_other_listing';
const OTHER_LISTING_URL = `${MR_BASE}/project/${OTHER_LISTING_ID}`;
/** Modrinth answering 500 on every attempt (the SC-09 retries run out — ~7 s of backoff). */
const DOWN_LISTING_URL = `${MR_BASE}/project/t_down_listing`;
/** 200 bodies the action must refuse before any write: no `id`, and an id that is not one. */
const NO_ID_LISTING_URL = `${MR_BASE}/project/t_no_id_listing`;
const BAD_ID_LISTING_URL = `${MR_BASE}/project/t_bad_id_listing`;

/** `search.json` entries: `seed-mod-addon` (id 900008, 12 downloads) and `seed-mod` (id 900009, 77). */
const MOD_ID = '900008';
const MOD_DOWNLOADS = 12;
const MOD_SITE = 'https://www.curseforge.com/minecraft/mc-mods/seed-mod-addon';
const SEED_MOD_ID = '900009';
const SEED_MOD_DOWNLOADS = 77;
const SEED_MOD_SITE = 'https://www.curseforge.com/minecraft/mc-mods/seed-mod';

/** A `getMod` answer (`mod.json` shape) for one `search.json` entry, derived in memory. */
function modFromSearch(id: number): Response {
  const search = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'curseforge', 'search.json'), 'utf8'),
  ) as { data: Array<{ id: number }> };
  const entry = search.data.find((mod) => mod.id === id);
  if (entry === undefined) throw new Error(`search.json has no entry ${String(id)}`);
  return Response.json({ data: entry });
}

let adminId = '';
/** The T-ACT-41 target: a SYNCED factory row (the S1.2 shape). */
let syncedId = '';
let syncedSlug = '';
/** The T-ACT-79 target: an odsens factory row (the only source a Modrinth link may go on). */
let exclusiveId = '';
let exclusiveSlug = '';
let activeFetch: FetchSpy | null = null;

function routes(): FetchSpy {
  activeFetch = spyFetch({
    [SEED_HELD_URL]: 'curseforge/mod.json',
    [MOD_URL]: () => modFromSearch(900008),
    [SEED_MOD_URL]: () => modFromSearch(900009),
    [MISSING_URL]: 'curseforge/error-404.json',
    [SEARCH_URL]: 'curseforge/search.json',
    // The versions URL is listed FIRST so its prefix never matches the project URL (insertion order).
    [LISTING_VERSIONS_URL]: 'modrinth/versions-empty.json',
    [LISTING_URL]: 'modrinth/project/sd000199.json',
    [LISTING_SLUG_URL]: 'modrinth/project/sd000199.json',
    [MISSING_LISTING_URL]: 'status:404',
    [DOWN_LISTING_URL]: 'status:500',
    [NO_ID_LISTING_URL]: () => Response.json({ slug: 't-no-id', title: 'No id', downloads: 1 }),
    [BAD_ID_LISTING_URL]: () => Response.json({ id: '..', title: 'Bad id', downloads: 1 }),
    [OTHER_LISTING_URL]: () =>
      Response.json({
        id: OTHER_LISTING_ID,
        slug: 't-other-listing',
        project_type: 'mod',
        title: 'Other listing',
        description: 'A second listing.',
        downloads: 5,
      }),
  });
  return activeFetch;
}

function cf(ref: string, project = syncedId): LinkProjectListingInput {
  return { project_id: project, platform: 'curseforge', ref };
}

function mr(ref: string, project = exclusiveId): LinkProjectListingInput {
  return { project_id: project, platform: 'modrinth', ref };
}

type LinkRow = { external_id: string; url: string; downloads: number; synced_at: string };

async function linkRow(
  projectId: string,
  platform: 'curseforge' | 'modrinth',
): Promise<LinkRow | null> {
  const { data, error } = await service
    .from('project_links')
    .select('external_id, url, downloads, synced_at')
    .eq('project_id', projectId)
    .eq('platform', platform)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function counts(
  projectId: string,
): Promise<{ downloads_curseforge: number; downloads_modrinth: number }> {
  const { data, error } = await service
    .from('projects')
    .select('downloads_curseforge, downloads_modrinth')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function slugOf(projectId: string): Promise<string> {
  const { data, error } = await service
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data.slug;
}

/** `projects_public.is_exclusive` (ADR-0037 D7) for a published row, as anon sees it. */
async function isExclusive(projectId: string): Promise<boolean | null> {
  const { data, error } = await asRole('anon')
    .from('projects_public')
    .select('is_exclusive')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.is_exclusive ?? null;
}

/** The SC-24 `msg:'admin'` line of one call — keys only, never the ref value. */
function expectAdminLine(logs: LogSpy, actorId: string, targetId: string, ref: string): void {
  const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
    (line) => line.msg === 'admin',
  );
  expect(adminLines).toHaveLength(1);
  const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
  expect(line.action).toBe('linkProjectListing');
  expect(Object.keys(line.meta).sort()).toEqual([
    'actor_profile_id',
    'fields',
    'target_id',
    'target_type',
  ]);
  expect(line.meta.actor_profile_id).toBe(actorId);
  expect(line.meta.target_type).toBe('project_link');
  expect(line.meta.target_id).toBe(targetId);
  expect(line.meta.fields).toEqual(['project_id', 'platform', 'ref']);
  expect(JSON.stringify(line.meta)).not.toContain(ref);
}

beforeAll(async () => {
  adminId = await makeUser({ role: 'admin' });
  syncedId = await makeProject({ source: 'modrinth', external_id: `t_${Date.now()}` });
  syncedSlug = await slugOf(syncedId);
  exclusiveId = await makeProject({ source: 'odsens', status: 'published' });
  exclusiveSlug = await slugOf(exclusiveId);
});

afterEach(() => {
  activeFetch?.restore();
  activeFetch = null;
});

afterAll(async () => {
  await clearRateLimitHits('project_link', adminId);
  await cleanupFactories();
});

// ---------------------------------------------------------------------------------------------
// Auth matrix + rate limit — one action, both platforms (ADR-0002 C7: admin-only)
// ---------------------------------------------------------------------------------------------
describe('linkProjectListing auth + rate limit (T-ACT-41 / T-ACT-79)', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: the listing fields are admin-only; moderators get `forbidden` (00 S1.5a.AC8).
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])(
    'T-ACT-41 / T-ACT-79 $role → $code on both platforms, no rate-limit hit',
    async ({ role, code, message }) => {
      for (const input of [cf('900001', randomUUID()), mr(LISTING_ID, randomUUID())]) {
        const error = expectFail(await callAction(linkProjectListing, input, { role }), code);
        expect(error.message).toBe(message);
      }
      if (role !== 'anon') {
        // The limiter sits after `requireRole` — a forbidden caller burns no budget.
        expect(await countRateLimitHits('project_link', SEED_ROLE_IDS[role])).toBe(0);
      }
    },
  );

  it.each([
    { name: 'T-ACT-41 curseforge', input: () => cf('900001') },
    { name: 'T-ACT-79 modrinth', input: () => mr(LISTING_ID) },
  ])(
    '$name 31st call in an hour → rate_limited (30 / hour / user, one scope)',
    async ({ input }) => {
      const burner = await makeUser({ role: 'admin' });
      // 30 hits arranged directly in `rate_limit_hits` — the only table `rate_limit_ok` counts.
      const { error } = await service
        .from('rate_limit_hits')
        .insert(Array.from({ length: 30 }, () => ({ scope: 'project_link', key: burner })));
      expect(error).toBeNull();

      const fetchSpy = routes();
      const limited = expectFail(
        await callActionAs(linkProjectListing, input(), { profileId: burner }),
        'rate_limited',
      );
      expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
      // The rejected call still recorded its own hit (ADR-0002 A4) and never went upstream.
      expect(await countRateLimitHits('project_link', burner)).toBe(31);
      expect(fetchSpy.calls).toEqual([]);
      await clearRateLimitHits('project_link', burner);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-41 — the `curseforge` case (every S1.2 `setProjectLink` rule minus the exclusive refusal)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-41 linkProjectListing — curseforge', () => {
  it("T-ACT-41 ref='900008' → getMod → link upserted AND downloads_curseforge set immediately; x-api-key; SC-24", async () => {
    const fetchSpy = routes();
    const tags = spyRevalidateTag();
    const logs = spyLog();
    try {
      const data = expectOk(
        await callActionAs(linkProjectListing, cf(MOD_ID), { profileId: adminId }),
      );
      expect(data.link).toMatchObject({
        project_id: syncedId,
        platform: 'curseforge',
        external_id: MOD_ID,
        url: MOD_SITE,
        downloads: MOD_DOWNLOADS,
      });
      expect(data.link.synced_at).toBeTruthy();

      expect(await linkRow(syncedId, 'curseforge')).toMatchObject({
        external_id: MOD_ID,
        url: MOD_SITE,
        downloads: MOD_DOWNLOADS,
      });
      expect((await counts(syncedId)).downloads_curseforge).toBe(MOD_DOWNLOADS);

      expect(fetchSpy.calls).toEqual([MOD_URL]);
      expect(fetchSpy.requests[0]?.headers['x-api-key']).toBe(CF_KEY);

      expect(tags.calls).toEqual(['projects', `project:${syncedSlug}`]);
      expectAdminLine(logs, adminId, syncedId, MOD_ID);
    } finally {
      logs.restore();
    }
  });

  it('T-ACT-41 URL ref → searchBySlug (curseforge/search.json) → same effects (the row is replaced)', async () => {
    routes();
    const tags = spyRevalidateTag();
    const data = expectOk(
      await callActionAs(linkProjectListing, cf(SEED_MOD_SITE), { profileId: adminId }),
    );
    expect(data.link).toMatchObject({ external_id: SEED_MOD_ID, url: SEED_MOD_SITE });
    expect(await linkRow(syncedId, 'curseforge')).toMatchObject({
      external_id: SEED_MOD_ID,
      url: SEED_MOD_SITE,
      downloads: SEED_MOD_DOWNLOADS,
    });
    expect((await counts(syncedId)).downloads_curseforge).toBe(SEED_MOD_DOWNLOADS);
    expect(tags.calls).toEqual(['projects', `project:${syncedSlug}`]);
  });

  it('T-ACT-41 unknown slug → not_found, existing link untouched', async () => {
    routes();
    const before = await linkRow(syncedId, 'curseforge');
    expectFail(
      await callActionAs(
        linkProjectListing,
        cf('https://www.curseforge.com/minecraft/mc-mods/no-such-mod'),
        { profileId: adminId },
      ),
      'not_found',
    );
    expect(await linkRow(syncedId, 'curseforge')).toEqual(before);
    expect((await counts(syncedId)).downloads_curseforge).toBe(SEED_MOD_DOWNLOADS);
  });

  it('T-ACT-41 CurseForge 404 on a digits ref → not_found, existing link untouched', async () => {
    routes();
    const before = await linkRow(syncedId, 'curseforge');
    expectFail(
      await callActionAs(linkProjectListing, cf('31337'), { profileId: adminId }),
      'not_found',
    );
    expect(await linkRow(syncedId, 'curseforge')).toEqual(before);
  });

  it('T-ACT-41 unknown project_id → not_found before any CurseForge call', async () => {
    const fetchSpy = routes();
    expectFail(
      await callActionAs(linkProjectListing, cf(MOD_ID, randomUUID()), { profileId: adminId }),
      'not_found',
    );
    expect(fetchSpy.calls).toEqual([]);
  });

  it("T-ACT-41 CURSEFORGE_API_KEY unset → upstream_error 'CurseForge key not configured', no call, no write", async () => {
    const saved = env.CURSEFORGE_API_KEY;
    const fetchSpy = routes();
    const fresh = await makeProject({ source: 'modrinth', external_id: `t_${randomUUID()}` });
    try {
      env.CURSEFORGE_API_KEY = undefined;
      const error = expectFail(
        await callActionAs(linkProjectListing, cf(MOD_ID, fresh), { profileId: adminId }),
        'upstream_error',
      );
      expect(error.message).toBe('CurseForge key not configured');
      expect(fetchSpy.calls).toEqual([]);
      expect(await linkRow(fresh, 'curseforge')).toBeNull();
    } finally {
      env.CURSEFORGE_API_KEY = saved;
    }
  });

  it.each<{ name: string; ref: string }>([
    { name: 'not digits, not a CurseForge URL', ref: 'not-a-ref' },
    { name: 'http (not https) URL', ref: 'http://www.curseforge.com/minecraft/mc-mods/x' },
    { name: 'unknown category path', ref: 'https://www.curseforge.com/minecraft/worlds/x' },
    { name: '11 digits', ref: '12345678901' },
    {
      name: '301 characters',
      ref: `https://www.curseforge.com/minecraft/mc-mods/${'a'.repeat(300)}`,
    },
    { name: 'empty', ref: '' },
  ])('T-ACT-41 ref $name → validation', async ({ ref }) => {
    const error = expectFail(
      await callActionAs(linkProjectListing, cf(ref), { profileId: adminId }),
      'validation',
    );
    expect(error.issues?.length ?? 0).toBeGreaterThan(0);
  });

  it('T-ACT-41 an exclusive target → ok (the S1.3 refusal is gone): link row written, is_exclusive false (ADR-0037 D1/D7)', async () => {
    routes();
    const target = await makeProject({ source: 'odsens', status: 'published' });
    expect(await isExclusive(target)).toBe(true);

    // `900008` is free again: the URL case above moved the synced row's link to `900009`.
    const data = expectOk(
      await callActionAs(linkProjectListing, cf(MOD_ID, target), { profileId: adminId }),
    );
    expect(data.link).toMatchObject({ project_id: target, platform: 'curseforge' });
    expect(await linkRow(target, 'curseforge')).toMatchObject({ external_id: MOD_ID });
    expect((await counts(target)).downloads_curseforge).toBe(MOD_DOWNLOADS);
    // The badge predicate flips the moment a link exists (00 S1.5a.AC5).
    expect(await isExclusive(target)).toBe(false);
  });

  it("T-ACT-41 a listing already linked to another project → conflict 'That listing is already linked to <title>.', nothing written", async () => {
    const fetchSpy = routes();
    // `900008` now belongs to the exclusive target of the previous case; a second project asks.
    const second = await makeProject({ source: 'modrinth', external_id: `t_${randomUUID()}` });
    const error = expectFail(
      await callActionAs(linkProjectListing, cf(MOD_ID, second), { profileId: adminId }),
      'conflict',
    );
    expect(error.message).toMatch(/^That listing is already linked to t_[0-9a-f]{8}\.$/);
    expect(await linkRow(second, 'curseforge')).toBeNull();
    expect((await counts(second)).downloads_curseforge).toBe(0);

    // The seed's own listing (`900001` on pixel-chameleon, SEED-6) answers the same way — the
    // unique index backstops the seed too (ADR-0037 D1).
    const seeded = expectFail(
      await callActionAs(linkProjectListing, cf('900001', second), { profileId: adminId }),
      'conflict',
    );
    expect(seeded.message).toBe('That listing is already linked to Pixel Chameleon.');
    expect(fetchSpy.calls).toEqual([MOD_URL, SEED_HELD_URL]);
    expect(await linkRow(second, 'curseforge')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-79 — the `modrinth` case (ADR-0037 D1)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-79 linkProjectListing — modrinth', () => {
  it('T-ACT-79 a Modrinth URL (www, typed segment, trailing path) → getProject fixture → link row + downloads_modrinth; no listVersions; SC-24', async () => {
    const fetchSpy = routes();
    const tags = spyRevalidateTag();
    const logs = spyLog();
    try {
      expect(await isExclusive(exclusiveId)).toBe(true);
      const ref = `https://www.modrinth.com/resourcepack/${LISTING_ID}/versions`;
      const data = expectOk(
        await callActionAs(linkProjectListing, mr(ref), { profileId: adminId }),
      );
      expect(data.link).toMatchObject({
        project_id: exclusiveId,
        platform: 'modrinth',
        external_id: LISTING_ID,
        // Built from the adapter's id (`modrinthListingUrl`), never from the pasted string.
        url: LISTING_PAGE,
        downloads: LISTING_DOWNLOADS,
      });
      expect(data.link.synced_at).toBeTruthy();

      expect(await linkRow(exclusiveId, 'modrinth')).toMatchObject({
        external_id: LISTING_ID,
        url: LISTING_PAGE,
        downloads: LISTING_DOWNLOADS,
      });
      expect((await counts(exclusiveId)).downloads_modrinth).toBe(LISTING_DOWNLOADS);

      // Exactly one upstream call — the project, never its versions (they arrive with the sync).
      expect(fetchSpy.calls).toEqual([LISTING_URL]);
      expect(fetchSpy.requests[0]?.headers['user-agent']).toBe(env.MODRINTH_USER_AGENT);

      expect(tags.calls).toEqual(['projects', `project:${exclusiveSlug}`]);
      expectAdminLine(logs, adminId, exclusiveId, LISTING_ID);
      // The badge is gone everywhere the view is read (00 S1.5a.AC5).
      expect(await isExclusive(exclusiveId)).toBe(false);
    } finally {
      logs.restore();
    }
  });

  it('T-ACT-79 re-linking the same listing by bare id → ok, idempotent (one row, count re-set)', async () => {
    const fetchSpy = routes();
    const tags = spyRevalidateTag();
    const data = expectOk(
      await callActionAs(linkProjectListing, mr(LISTING_ID), { profileId: adminId }),
    );
    expect(data.link).toMatchObject({ external_id: LISTING_ID, url: LISTING_PAGE });
    const { data: rows, error } = await service
      .from('project_links')
      .select('platform')
      .eq('project_id', exclusiveId);
    expect(error).toBeNull();
    expect(rows).toEqual([{ platform: 'modrinth' }]);
    expect(fetchSpy.calls).toEqual([LISTING_URL]);
    expect(tags.calls).toEqual(['projects', `project:${exclusiveSlug}`]);
  });

  it('T-ACT-79 a bare slug → GET /project/<slug> → the same listing (id from the response)', async () => {
    const fetchSpy = routes();
    const data = expectOk(
      await callActionAs(linkProjectListing, mr(LISTING_SLUG), { profileId: adminId }),
    );
    expect(data.link).toMatchObject({ external_id: LISTING_ID, url: LISTING_PAGE });
    expect(fetchSpy.calls).toEqual([LISTING_SLUG_URL]);
  });

  it("T-ACT-79 a different listing while one is linked → conflict 'Remove the current Modrinth listing first.', link unchanged", async () => {
    routes();
    const before = await linkRow(exclusiveId, 'modrinth');
    const error = expectFail(
      await callActionAs(linkProjectListing, mr(OTHER_LISTING_ID), { profileId: adminId }),
      'conflict',
    );
    expect(error.message).toBe('Remove the current Modrinth listing first.');
    expect(await linkRow(exclusiveId, 'modrinth')).toEqual(before);
    expect((await counts(exclusiveId)).downloads_modrinth).toBe(LISTING_DOWNLOADS);
  });

  it("T-ACT-79 a listing already linked to another project → conflict 'That listing is already linked to <title>.', nothing written", async () => {
    routes();
    const second = await makeProject({ source: 'odsens', title: 't_ Second home' });
    const error = expectFail(
      await callActionAs(linkProjectListing, mr(LISTING_ID, second), { profileId: adminId }),
      'conflict',
    );
    expect(error.message).toBe(
      `That listing is already linked to t_${exclusiveId.replace(/-/g, '').slice(0, 8)}.`,
    );
    expect(await linkRow(second, 'modrinth')).toBeNull();
    expect((await counts(second)).downloads_modrinth).toBe(0);
  });

  it("T-ACT-79 a source='modrinth' row → validation 'This project is synced from Modrinth already.', no Modrinth call", async () => {
    const fetchSpy = routes();
    const error = expectFail(
      await callActionAs(linkProjectListing, mr(LISTING_ID, syncedId), { profileId: adminId }),
      'validation',
    );
    expect(error.message).toBe('This project is synced from Modrinth already.');
    expect(fetchSpy.calls).toEqual([]);
    expect(await linkRow(syncedId, 'modrinth')).toBeNull();
  });

  it("T-ACT-79 unknown listing (Modrinth 404) → not_found 'Nothing on Modrinth matches that.', nothing written", async () => {
    routes();
    const target = await makeProject({ source: 'odsens' });
    const error = expectFail(
      await callActionAs(linkProjectListing, mr('no-such-listing', target), { profileId: adminId }),
      'not_found',
    );
    expect(error.message).toBe('Nothing on Modrinth matches that.');
    expect(await linkRow(target, 'modrinth')).toBeNull();
  });

  it('T-ACT-79 unknown project_id → not_found before any Modrinth call', async () => {
    const fetchSpy = routes();
    expectFail(
      await callActionAs(linkProjectListing, mr(LISTING_ID, randomUUID()), { profileId: adminId }),
      'not_found',
    );
    expect(fetchSpy.calls).toEqual([]);
  });

  it('T-ACT-79 Modrinth 5xx on every attempt → upstream_error, nothing written', async () => {
    const fetchSpy = routes();
    const target = await makeProject({ source: 'odsens' });
    const error = expectFail(
      await callActionAs(linkProjectListing, mr('t_down_listing', target), { profileId: adminId }),
      'upstream_error',
    );
    expect(error.message).toBe("Modrinth didn't answer. Try again.");
    // SC-09: the first attempt plus three retries, all on the project URL.
    expect(fetchSpy.calls).toEqual(Array<string>(4).fill(DOWN_LISTING_URL));
    expect(await linkRow(target, 'modrinth')).toBeNull();
    expect((await counts(target)).downloads_modrinth).toBe(0);
  }, 20_000);

  it.each([
    { name: 'no id at all', ref: 't_no_id_listing' },
    { name: 'an id that is not a Modrinth id', ref: 't_bad_id_listing' },
  ])(
    'T-ACT-79 a 200 body with $name → upstream_error, nothing written (the id becomes external_id + the URL)',
    async ({ ref }) => {
      routes();
      const target = await makeProject({ source: 'odsens' });
      const error = expectFail(
        await callActionAs(linkProjectListing, mr(ref, target), { profileId: adminId }),
        'upstream_error',
      );
      expect(error.message).toBe("Modrinth didn't answer. Try again.");
      expect(await linkRow(target, 'modrinth')).toBeNull();
    },
  );

  it("T-ACT-79 raced: a competing link lands between the holder check and the upsert → 23505 → conflict 'That listing is already linked to <title>.'", async () => {
    routes();
    const target = await makeProject({ source: 'odsens' });
    const holder = await makeProject({ source: 'odsens', title: 't_ Raced holder' });
    // The hook runs INSIDE the action, just before its `project_links` upsert (the holder
    // pre-check has already passed): the unique index is the atomic backstop (ADR-0037 D1).
    const res = await withDbHook(
      { table: 'project_links', op: 'upsert' },
      async () => {
        const raced = await service.from('project_links').insert({
          project_id: holder,
          platform: 'modrinth',
          external_id: OTHER_LISTING_ID,
          url: `https://modrinth.com/project/${OTHER_LISTING_ID}`,
          downloads: 5,
          synced_at: new Date().toISOString(),
        });
        if (raced.error)
          throw new Error(`hook: project_links insert failed: ${raced.error.message}`);
      },
      () => callActionAs(linkProjectListing, mr(OTHER_LISTING_ID, target), { profileId: adminId }),
    );
    const error = expectFail(res, 'conflict');
    expect(error.message).toBe('That listing is already linked to t_ Raced holder.');
    expect(await linkRow(target, 'modrinth')).toBeNull();
    expect((await counts(target)).downloads_modrinth).toBe(0);
    expect(await linkRow(holder, 'modrinth')).toMatchObject({ external_id: OTHER_LISTING_ID });
  });

  it.each<{ name: string; ref: string }>([
    { name: 'a CurseForge URL', ref: 'https://www.curseforge.com/minecraft/mc-mods/x' },
    { name: 'a look-alike host', ref: 'https://modrinth.com.example/mod/sd000199' },
    {
      name: 'a host that only contains modrinth.com',
      ref: 'https://example.com/modrinth.com/mod/x',
    },
    { name: 'http (not https)', ref: 'http://modrinth.com/mod/sd000199' },
    { name: 'a non-project Modrinth path', ref: 'https://modrinth.com/user/OddSense' },
    { name: 'a slug with spaces', ref: 'not a slug' },
    { name: '65 characters', ref: 'a'.repeat(65) },
    { name: 'empty', ref: '' },
  ])('T-ACT-79 ref $name → validation, no Modrinth call', async ({ ref }) => {
    const fetchSpy = routes();
    const error = expectFail(
      await callActionAs(linkProjectListing, mr(ref), { profileId: adminId }),
      'validation',
    );
    expect(error.issues?.length ?? 0).toBeGreaterThan(0);
    expect(fetchSpy.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// DB faults (T-ACT-0 (1)) on each write of both platforms; a fresh factory admin keeps this block
// clear of the file's project_link budget. The fold RPC fault is T-ACT-81 (the fold file).
// ---------------------------------------------------------------------------------------------
describe('T-ACT-41 / T-ACT-79 linkProjectListing DB faults', () => {
  let faultAdmin = '';
  let logs: LogSpy;

  beforeAll(async () => {
    faultAdmin = await makeUser({ role: 'admin' });
  });

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  afterAll(async () => {
    await clearRateLimitHits('project_link', faultAdmin);
  });

  it.each([
    { name: 'T-ACT-41 curseforge', input: () => cf('900001', randomUUID()) },
    { name: 'T-ACT-79 modrinth', input: () => mr(LISTING_ID, randomUUID()) },
  ])(
    '$name the project read fails → internal + one log.error line, no upstream call',
    async ({ input }) => {
      const fetchSpy = routes();
      const res = await withDbFault({ table: 'projects', op: 'select' }, {}, () =>
        callActionAs(linkProjectListing, input(), { profileId: faultAdmin }),
      );
      expectInternal(res, 'linkProjectListing', logs);
      expect(fetchSpy.calls).toEqual([]);
    },
  );

  it.each<{ name: string; input: () => LinkProjectListingInput; target: DbCallTarget }>([
    // `900009` is the synced row's own listing by now — the holder check passes, the upsert runs.
    {
      name: "T-ACT-41 curseforge '900009' — the link upsert",
      input: () => cf(SEED_MOD_ID),
      target: { table: 'project_links', op: 'upsert' },
    },
    {
      name: "T-ACT-41 curseforge '900009' — the count write",
      input: () => cf(SEED_MOD_ID),
      target: { table: 'projects', op: 'update' },
    },
    {
      name: 'T-ACT-79 modrinth — the link upsert',
      input: () => mr(LISTING_ID),
      target: { table: 'project_links', op: 'upsert' },
    },
    {
      name: 'T-ACT-79 modrinth — the count write',
      input: () => mr(LISTING_ID),
      target: { table: 'projects', op: 'update' },
    },
  ])('$name fails → internal + one log.error line, no revalidate', async ({ input, target }) => {
    routes();
    const tags = spyRevalidateTag();
    const res = await withDbFault(target, {}, () =>
      callActionAs(linkProjectListing, input(), { profileId: faultAdmin }),
    );
    expectInternal(res, 'linkProjectListing', logs);
    expect(tags.calls).toEqual([]);
  });
});
