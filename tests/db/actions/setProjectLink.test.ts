/**
 * tests/db/actions/setProjectLink.test.ts — T-ACT-41 (05 §7.2; 04 §1.4 `setProjectLink`;
 * ADR-0002 C7; migration 20260827090200; fixtures `curseforge/mod.json`, `search.json`,
 * `error-404.json`).
 *
 * Harness per 05 §7.2: the action builds the adapter from `lib/env.ts`, so `spyFetch` routes the
 * fixture-server URLs (`CURSEFORGE_API_BASE`, ADR-0002 #73) to `tests/fixtures/curseforge/*` and
 * asserts the `x-api-key` header. All success calls run as a FACTORY admin so the seed admin's
 * `project_link` budget (30 / hour) stays untouched for other files; the factory project's link
 * rows fall to its FK cascade in `cleanupFactories`. The rate-limit row arranges 30 hits directly
 * in `rate_limit_hits` (the only table `rate_limit_ok` counts — ADR-0002 A4) on a second factory
 * admin, so the 31st call is the action's own.
 *
 * Flows: digits ref → `getMod`; URL ref → `searchBySlug`; both upsert `project_links` AND set
 * `projects.downloads_curseforge` immediately; `ref:null` deletes the row and zeroes the count;
 * unknown slug / CF 404 → `not_found`; `CURSEFORGE_API_KEY` unset → `upstream_error`
 * "CurseForge key not configured"; SC-24 audit line; revalidates `projects` + `project:<slug>`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setProjectLink } from '@/lib/actions/projects';
import type { SetProjectLinkInput } from '@/lib/actions/projects.schema';
import { env } from '@/lib/env';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault, type DbCallTarget } from '@/tests/helpers/dbFault';
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
const MOD_URL = `${CF_BASE}/mods/900001`;
const MISSING_URL = `${CF_BASE}/mods/31337`;
const SEARCH_URL = `${CF_BASE}/mods/search`;

/** `curseforge/mod.json` (id 900001) and the `search.json` entry for slug `seed-mod` (id 900009). */
const MOD_DOWNLOADS = 120;
const MOD_SITE = 'https://www.curseforge.com/minecraft/mc-mods/pixel-chameleon';
const SEED_MOD_DOWNLOADS = 77;
const SEED_MOD_SITE = 'https://www.curseforge.com/minecraft/mc-mods/seed-mod';

let adminId = '';
let projectId = '';
let slug = '';
let activeFetch: FetchSpy | null = null;

function routes(): FetchSpy {
  activeFetch = spyFetch({
    [MOD_URL]: 'curseforge/mod.json',
    [MISSING_URL]: 'curseforge/error-404.json',
    [SEARCH_URL]: 'curseforge/search.json',
  });
  return activeFetch;
}

function input(ref: string | null, project = projectId): SetProjectLinkInput {
  return { project_id: project, platform: 'curseforge', ref };
}

type LinkRow = { external_id: string; url: string; downloads: number; synced_at: string };

async function linkRow(): Promise<LinkRow | null> {
  const { data, error } = await service
    .from('project_links')
    .select('external_id, url, downloads, synced_at')
    .eq('project_id', projectId)
    .eq('platform', 'curseforge')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function cfDownloads(): Promise<number> {
  const { data, error } = await service
    .from('projects')
    .select('downloads_curseforge')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data.downloads_curseforge;
}

beforeAll(async () => {
  adminId = await makeUser({ role: 'admin' });
  // The target must be SYNCED: since the S1.3 AC8 guard, `setProjectLink` refuses exclusives
  // (Q39 scopes manual CF ids to synced rows; a link would un-earn the badge).
  projectId = await makeProject({ source: 'modrinth', external_id: `t_${Date.now()}` });
  const { data, error } = await service
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  slug = data.slug;
});

afterEach(() => {
  activeFetch?.restore();
  activeFetch = null;
});

afterAll(async () => {
  await clearRateLimitHits('project_link', adminId);
  await cleanupFactories();
});

describe('T-ACT-41 setProjectLink', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: the CurseForge id field is admin-only; moderators get `forbidden`.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-41 $role → $code, no rate-limit hit recorded', async ({ role, code, message }) => {
    const error = expectFail(
      await callAction(setProjectLink, input('900001', randomUUID()), { role }),
      code,
    );
    expect(error.message).toBe(message);
    if (role !== 'anon') {
      // The limiter sits after `requireRole` — a forbidden caller burns no budget.
      expect(await countRateLimitHits('project_link', SEED_ROLE_IDS[role])).toBe(0);
    }
  });

  it("T-ACT-41 ref='900001' → getMod fixture → link upserted AND downloads_curseforge set immediately; x-api-key; SC-24", async () => {
    const fetchSpy = routes();
    const tags = spyRevalidateTag();
    const logs = spyLog();
    try {
      const data = expectOk(
        await callActionAs(setProjectLink, input('900001'), { profileId: adminId }),
      );
      expect(data.link).toMatchObject({
        project_id: projectId,
        platform: 'curseforge',
        external_id: '900001',
        url: MOD_SITE,
        downloads: MOD_DOWNLOADS,
      });
      expect(data.link?.synced_at).toBeTruthy();

      expect(await linkRow()).toMatchObject({
        external_id: '900001',
        url: MOD_SITE,
        downloads: MOD_DOWNLOADS,
      });
      expect(await cfDownloads()).toBe(MOD_DOWNLOADS);

      expect(fetchSpy.calls).toEqual([MOD_URL]);
      expect(fetchSpy.requests[0]?.headers['x-api-key']).toBe(CF_KEY);

      expect(tags.calls).toEqual(['projects', `project:${slug}`]);

      // SC-24: keys only — no values.
      const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.msg === 'admin',
      );
      expect(adminLines).toHaveLength(1);
      const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
      expect(line.action).toBe('setProjectLink');
      expect(Object.keys(line.meta).sort()).toEqual([
        'actor_profile_id',
        'fields',
        'target_id',
        'target_type',
      ]);
      expect(line.meta.actor_profile_id).toBe(adminId);
      expect(line.meta.target_id).toBe(projectId);
      expect(line.meta.fields).toEqual(['project_id', 'platform', 'ref']);
      expect(JSON.stringify(line.meta)).not.toContain('900001');
    } finally {
      logs.restore();
    }
  });

  it('T-ACT-41 URL ref → searchBySlug (curseforge/search.json) → same effects', async () => {
    routes();
    const tags = spyRevalidateTag();
    const data = expectOk(
      await callActionAs(setProjectLink, input(SEED_MOD_SITE), { profileId: adminId }),
    );
    expect(data.link).toMatchObject({ external_id: '900009', url: SEED_MOD_SITE });
    expect(await linkRow()).toMatchObject({
      external_id: '900009',
      url: SEED_MOD_SITE,
      downloads: SEED_MOD_DOWNLOADS,
    });
    expect(await cfDownloads()).toBe(SEED_MOD_DOWNLOADS);
    expect(tags.calls).toEqual(['projects', `project:${slug}`]);
  });

  it('T-ACT-41 unknown slug → not_found, existing link untouched', async () => {
    routes();
    const before = await linkRow();
    expectFail(
      await callActionAs(
        setProjectLink,
        input('https://www.curseforge.com/minecraft/mc-mods/no-such-mod'),
        { profileId: adminId },
      ),
      'not_found',
    );
    expect(await linkRow()).toEqual(before);
    expect(await cfDownloads()).toBe(SEED_MOD_DOWNLOADS);
  });

  it('T-ACT-41 CurseForge 404 on a digits ref → not_found, existing link untouched', async () => {
    routes();
    const before = await linkRow();
    expectFail(
      await callActionAs(setProjectLink, input('31337'), { profileId: adminId }),
      'not_found',
    );
    expect(await linkRow()).toEqual(before);
  });

  it('T-ACT-41 unknown project_id → not_found before any CurseForge call', async () => {
    const fetchSpy = routes();
    expectFail(
      await callActionAs(setProjectLink, input('900001', randomUUID()), { profileId: adminId }),
      'not_found',
    );
    expect(fetchSpy.calls).toEqual([]);
  });

  it('T-ACT-41 ref:null → row deleted, downloads_curseforge = 0, revalidates', async () => {
    const fetchSpy = routes();
    const tags = spyRevalidateTag();
    const data = expectOk(await callActionAs(setProjectLink, input(null), { profileId: adminId }));
    expect(data.link).toBeNull();
    expect(await linkRow()).toBeNull();
    expect(await cfDownloads()).toBe(0);
    // Removal needs no CurseForge call.
    expect(fetchSpy.calls).toEqual([]);
    expect(tags.calls).toEqual(['projects', `project:${slug}`]);
  });

  it("T-ACT-41 CURSEFORGE_API_KEY unset → upstream_error 'CurseForge key not configured', no call, no write", async () => {
    const saved = env.CURSEFORGE_API_KEY;
    const fetchSpy = routes();
    try {
      env.CURSEFORGE_API_KEY = undefined;
      const error = expectFail(
        await callActionAs(setProjectLink, input('900001'), { profileId: adminId }),
        'upstream_error',
      );
      expect(error.message).toBe('CurseForge key not configured');
      expect(fetchSpy.calls).toEqual([]);
      expect(await linkRow()).toBeNull();
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
  ])('T-ACT-41 ref $name → validation', async ({ ref }) => {
    const error = expectFail(
      await callActionAs(setProjectLink, input(ref), { profileId: adminId }),
      'validation',
    );
    expect(error.issues?.length ?? 0).toBeGreaterThan(0);
  });

  it('T-ACT-41 31st call in an hour → rate_limited (30 / hour / user)', async () => {
    const burner = await makeUser({ role: 'admin' });
    // 30 hits arranged directly in `rate_limit_hits` — the only table `rate_limit_ok` counts.
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 30 }, () => ({ scope: 'project_link', key: burner })));
    expect(error).toBeNull();

    routes();
    const limited = expectFail(
      await callActionAs(setProjectLink, input('900001'), { profileId: burner }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    // The rejected call still recorded its own hit (ADR-0002 A4).
    expect(await countRateLimitHits('project_link', burner)).toBe(31);
    await clearRateLimitHits('project_link', burner);
  });

  it('T-ACT-41 an exclusive target → validation, nothing written (S1.3 AC8 guard)', async () => {
    routes();
    const exclusiveId = await makeProject(); // factory default: source 'odsens'
    expectFail(
      await callActionAs(setProjectLink, input('900001', exclusiveId), { profileId: adminId }),
      'validation',
    );
    const { data, error } = await service
      .from('project_links')
      .select('project_id')
      .eq('project_id', exclusiveId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-41 — DB faults (T-ACT-0 (1)) on each write of the two paths (ref null / ref given); a
// fresh factory admin keeps this block clear of the file's project_link budget
// ---------------------------------------------------------------------------------------------
describe('T-ACT-41 setProjectLink DB faults', () => {
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

  it('T-ACT-41 the project read fails → internal + one log.error line, no CurseForge call', async () => {
    const fetchSpy = routes();
    const res = await withDbFault({ table: 'projects', op: 'select' }, {}, () =>
      callActionAs(setProjectLink, input('900001'), { profileId: faultAdmin }),
    );
    expectInternal(res, 'setProjectLink', logs);
    expect(fetchSpy.calls).toEqual([]);
  });

  it.each<{ name: string; ref: string | null; target: DbCallTarget }>([
    {
      name: 'ref:null — the link delete',
      ref: null,
      target: { table: 'project_links', op: 'delete' },
    },
    {
      name: 'ref:null — the count zeroing',
      ref: null,
      target: { table: 'projects', op: 'update' },
    },
    {
      name: "ref '900001' — the link upsert",
      ref: '900001',
      target: { table: 'project_links', op: 'upsert' },
    },
    {
      name: "ref '900001' — the count write",
      ref: '900001',
      target: { table: 'projects', op: 'update' },
    },
  ])(
    'T-ACT-41 $name fails → internal + one log.error line, no revalidate',
    async ({ ref, target }) => {
      routes();
      const tags = spyRevalidateTag();
      const res = await withDbFault(target, {}, () =>
        callActionAs(setProjectLink, input(ref), { profileId: faultAdmin }),
      );
      expectInternal(res, 'setProjectLink', logs);
      expect(tags.calls).toEqual([]);
    },
  );
});
