/**
 * tests/db/routes/download.test.ts — T-ACT-43 / T-ACT-44 for `/api/download/[fileId]`
 * (05 §7.2; 04 §2.3 D1–D7; 01 INV-55/INV-56; ADR-0002 C13 / C14 / C17). Handlers are imported from
 * the route file and invoked directly with `{ params: Promise.resolve({ fileId }) }` — the route
 * reads no cookies; identity is `x-forwarded-for` + `user-agent`, hashed via lib/hash.ts (the same
 * `HASH_SECRET` from `.env.test` computes the expected hashes here).
 *
 * `@/lib/files` is partially mocked (real module spread) so ONE test can flip `createDownloadUrl`
 * into throwing — the T-ACT-44 signed-URL-failure row; every other call passes through to the real
 * local-stack Storage (the seed object bytes exist — globalSetup SEED-13). Each block uses its own
 * TEST-NET-3 ip (`203.0.113.<n>`) so the `download` rate-limit key (daily `ipHash`) never collides
 * across suites.
 *
 * `mutatesSeed`: valid downloads bump the SHARED seed counters (`project_files` …0501
 * `download_count` 7, `projects` …0103 `downloads_direct` 7 — SEED-5), so the T-ACT-43 block
 * restores them before T-ACT-44 asserts 7→8, and afterAll restores both counters, deletes this
 * file's `project_downloads` rows (matched by our ip hashes) and clears our `rate_limit_hits`
 * (H-1). Factory rows for the draft / override-hidden 404 cells; seed rows otherwise read-only.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as route from '@/app/api/download/[fileId]/route';
import { ipHash, uaHash } from '@/lib/hash';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import { withDbFault } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeFile, makeProject, makeVersion } from '@/tests/helpers/factories';
import { SEED_FILES, SEED_PROJECTS, SEED_VERSIONS, seedId } from '@/tests/helpers/seedIds';
import { spyLog } from '@/tests/helpers/spies';

/** Flipped by the T-ACT-44 signed-URL-failure row only; read inside the hoisted mock factory. */
const signedUrlFailure = vi.hoisted(() => ({ active: false }));

vi.mock('@/lib/files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/files')>();
  const createDownloadUrl: typeof actual.createDownloadUrl = async (
    bucket,
    objectPath,
    filename,
  ) => {
    if (signedUrlFailure.active) {
      throw new actual.StorageError('storage_error', 'Signed URL failed.');
    }
    return actual.createDownloadUrl(bucket, objectPath, filename);
  };
  return { ...actual, createDownloadUrl };
});

setupActionMocks();

const service = asRole('service');

const ROUTE_BASE = 'http://localhost:3000/api/download';
const UA = 't_download_ua';

// One TEST-NET-3 ip per block/test so the daily-rotating `ipHash` rate-limit keys never collide.
const IP_43 = '203.0.113.43'; // T-ACT-43 valid 302
const IP_44 = '203.0.113.44'; // T-ACT-44 counters + concurrency
const IP_LIMIT = '203.0.113.45'; // T-ACT-44 31st request
const IP_500 = '203.0.113.46'; // T-ACT-44 signed-URL failure
const IP_REAL = '203.0.113.47'; // T-ACT-43 x-real-ip fallback
const IP_BLANK_HOP = '203.0.113.48'; // T-ACT-43 blank first x-forwarded-for hop
const IP_LOOPBACK = '127.0.0.1'; // T-ACT-43 no client-ip header at all (the loopback marker)
const IP_FAULT = '203.0.113.49'; // T-ACT-44 RPC faults
const TEST_IPS = [
  IP_43,
  IP_44,
  IP_LIMIT,
  IP_500,
  IP_REAL,
  IP_BLANK_HOP,
  IP_LOOPBACK,
  IP_FAULT,
] as const;

/** SEED-5: …0501 download_count 7 and …0103 downloads_direct 7 — the restore target (H-1). */
const SEED_DOWNLOAD_COUNT = 7;
/** …0502 — Modrinth-hosted seed file: `url` set, `storage_path` NULL (never proxied). */
const MODRINTH_HOSTED_FILE = seedId('files', 2);
const SEED_FILENAME = 'seed-exclusive-pack-1.0.0.zip';
/** Object path inside `project-files` (DB `storage_path` minus the bucket prefix). */
const SEED_OBJECT_PATH = `${SEED_PROJECTS.seedExclusivePack}/${SEED_VERSIONS.exclusive_1_0_0}/${SEED_FILENAME}`;

function get(fileId: string, ip: string): ReturnType<typeof route.GET> {
  const request = new NextRequest(`${ROUTE_BASE}/${fileId}`, {
    headers: { 'x-forwarded-for': ip, 'user-agent': UA },
  });
  return route.GET(request, { params: Promise.resolve({ fileId }) });
}

async function seedCounts(): Promise<{ file: number; project: number }> {
  const file = await service
    .from('project_files')
    .select('download_count')
    .eq('id', SEED_FILES.exclusiveZip)
    .single();
  if (file.error) throw new Error(file.error.message);
  const project = await service
    .from('projects')
    .select('downloads_direct')
    .eq('id', SEED_PROJECTS.seedExclusivePack)
    .single();
  if (project.error) throw new Error(project.error.message);
  return { file: file.data.download_count, project: project.data.downloads_direct };
}

async function downloadRowCount(hash: string): Promise<number> {
  const { count, error } = await service
    .from('project_downloads')
    .select('id', { count: 'exact', head: true })
    .eq('file_id', SEED_FILES.exclusiveZip)
    .eq('ip_hash', hash);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Seed counters back to 7 + this file's `project_downloads` rows gone (matched by OUR ip hashes). */
async function resetSeedDownloadState(): Promise<void> {
  const del = await service
    .from('project_downloads')
    .delete()
    .eq('file_id', SEED_FILES.exclusiveZip)
    .in(
      'ip_hash',
      TEST_IPS.map((ip) => ipHash(ip)),
    );
  if (del.error) throw new Error(`reset: project_downloads delete failed: ${del.error.message}`);
  const file = await service
    .from('project_files')
    .update({ download_count: SEED_DOWNLOAD_COUNT })
    .eq('id', SEED_FILES.exclusiveZip);
  if (file.error) throw new Error(`reset: project_files restore failed: ${file.error.message}`);
  const project = await service
    .from('projects')
    .update({ downloads_direct: SEED_DOWNLOAD_COUNT })
    .eq('id', SEED_PROJECTS.seedExclusivePack);
  if (project.error) throw new Error(`reset: projects restore failed: ${project.error.message}`);
}

afterAll(async () => {
  await resetSeedDownloadState();
  for (const ip of TEST_IPS) await clearRateLimitHits('download', ipHash(ip));
  await cleanupFactories();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-43 — resolution 404s (D1/D2), method gate (C17), the valid 302 + headers (D5/D6)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-43 /api/download/[fileId] resolution + response shape', () => {
  // The valid 302 below bumps the shared seed counters — restore before T-ACT-44 asserts 7→8.
  afterAll(resetSeedDownloadState);

  it('T-ACT-43 non-uuid id → 404 not_found (D1, before any lookup)', async () => {
    const res = await get('not-a-uuid', IP_43);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Nothing here.' },
    });
  });

  it('T-ACT-43 unknown uuid → 404', async () => {
    const res = await get(randomUUID(), IP_43);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_found');
  });

  it('T-ACT-43 file on a draft factory project → 404 (never 403 — drafts are not revealed, D2)', async () => {
    const projectId = await makeProject({ source: 'odsens', status: 'draft' });
    const versionId = await makeVersion({ project_id: projectId });
    const fileId = await makeFile({
      version_id: versionId,
      filename: 'draft-pack-1.0.0.zip',
      // DB-stored paths are bucket-prefixed (SC-21); resolution 404s on status before Storage.
      storage_path: `project-files/${projectId}/${versionId}/draft-pack-1.0.0.zip`,
    });
    const res = await get(fileId, IP_43);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('T-ACT-43 file on an override-hidden factory project → 404 (D2)', async () => {
    const projectId = await makeProject({ source: 'odsens', status: 'published' });
    // No makeOverride factory (05 §1.3) — service-arranged; falls to the project FK cascade.
    const { error } = await service
      .from('project_overrides')
      .insert({ project_id: projectId, hidden: true });
    expect(error).toBeNull();
    const versionId = await makeVersion({ project_id: projectId });
    const fileId = await makeFile({
      version_id: versionId,
      filename: 'hidden-pack-1.0.0.zip',
      storage_path: `project-files/${projectId}/${versionId}/hidden-pack-1.0.0.zip`,
    });
    const res = await get(fileId, IP_43);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('T-ACT-43 Modrinth-hosted seed file (storage_path NULL) → 404 — synced files are never proxied', async () => {
    // Prove the row exists and really is url-only before asserting the route hides it.
    const { data, error } = await service
      .from('project_files')
      .select('url, storage_path')
      .eq('id', MODRINTH_HOSTED_FILE)
      .single();
    expect(error).toBeNull();
    expect(data?.url).not.toBeNull();
    expect(data?.storage_path).toBeNull();

    const res = await get(MODRINTH_HOSTED_FILE, IP_43);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('T-ACT-43 HEAD/POST/PUT/PATCH/DELETE → 405 with Allow: GET (C17 — HEAD would double-count)', () => {
    for (const handler of [route.HEAD, route.POST, route.PUT, route.PATCH, route.DELETE]) {
      const res = handler();
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
    }
  });

  it('T-ACT-43 client identity fallbacks (D3): x-real-ip when x-forwarded-for is absent, a blank first hop is skipped, no header → the loopback marker, no user-agent → the empty-string hash', async () => {
    const cases: Array<{ headers: Record<string, string>; ip: string; ua: string }> = [
      { headers: { 'x-real-ip': IP_REAL, 'user-agent': UA }, ip: IP_REAL, ua: UA },
      {
        headers: { 'x-forwarded-for': ' ', 'x-real-ip': IP_BLANK_HOP, 'user-agent': UA },
        ip: IP_BLANK_HOP,
        ua: UA,
      },
      { headers: {}, ip: IP_LOOPBACK, ua: '' },
    ];
    for (const { headers, ip, ua } of cases) {
      const request = new NextRequest(`${ROUTE_BASE}/${SEED_FILES.exclusiveZip}`, { headers });
      const res = await route.GET(request, {
        params: Promise.resolve({ fileId: SEED_FILES.exclusiveZip }),
      });
      expect(res.status).toBe(302);
      const { data, error } = await service
        .from('project_downloads')
        .select('ua_hash')
        .eq('file_id', SEED_FILES.exclusiveZip)
        .eq('ip_hash', ipHash(ip));
      expect(error).toBeNull();
      expect(data).toEqual([{ ua_hash: uaHash(ua) }]);
    }
  });

  it('T-ACT-43 valid seed file → 302 signed URL (object path + token + download=… + 60 s expiry) and D6 headers', async () => {
    const res = await get(SEED_FILES.exclusiveZip, IP_43);
    expect(res.status).toBe(302);

    // D6 — never cacheable, never sniffed, never a referrer.
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');

    // D5 — Location = signed URL on the local storage host for exactly the seed object.
    const location = res.headers.get('location') ?? '';
    const url = new URL(location);
    const storageHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').host;
    expect(url.host).toBe(storageHost);
    expect(url.pathname).toContain(`/storage/v1/object/sign/project-files/${SEED_OBJECT_PATH}`);
    expect(url.searchParams.get('download')).toBe(SEED_FILENAME);

    // The token is a storage JWT whose `exp` is ~60 s out (DOWNLOAD_URL_TTL_S).
    const token = url.searchParams.get('token') ?? '';
    expect(token).not.toBe('');
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
      exp?: number;
    };
    expect(typeof payload.exp).toBe('number');
    const ttlMs = (payload.exp ?? 0) * 1000 - Date.now();
    expect(ttlMs).toBeGreaterThan(30_000);
    expect(ttlMs).toBeLessThanOrEqual(70_000);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-44 — side effects (D4), concurrency, the 31st request (D3), signed-URL failure
// ---------------------------------------------------------------------------------------------
describe('T-ACT-44 /api/download/[fileId] side effects', () => {
  afterEach(() => {
    signedUrlFailure.active = false;
  });

  it('T-ACT-44 one valid request → download_count 7→8, downloads_direct 7→8, ONE hashed log row', async () => {
    // T-ACT-43's afterAll restored the seed state — exact 7→8 per 05 (single statement, D4).
    expect(await seedCounts()).toEqual({ file: 7, project: 7 });

    const res = await get(SEED_FILES.exclusiveZip, IP_44);
    expect(res.status).toBe(302);
    expect(await seedCounts()).toEqual({ file: 8, project: 8 });

    const { data, error } = await service
      .from('project_downloads')
      .select('project_id, ip_hash, ua_hash, created_at')
      .eq('file_id', SEED_FILES.exclusiveZip)
      .eq('ip_hash', ipHash(IP_44));
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const row = data?.[0];
    expect(row?.project_id).toBe(SEED_PROJECTS.seedExclusivePack);
    // SC-17 — 64-hex HMACs, never the raw ip/ua.
    expect(row?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.ua_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.ip_hash).not.toBe(IP_44);
    expect(row?.ua_hash).not.toBe(UA);
    expect(row?.ua_hash).toBe(uaHash(UA));
    expect(row?.created_at).toBeTruthy();
  });

  it('T-ACT-44 10 concurrent requests (same ip) → counters +10 exactly, 10 new rows', async () => {
    const before = await seedCounts();
    const rowsBefore = await downloadRowCount(ipHash(IP_44));

    const results = await Promise.all(
      Array.from({ length: 10 }, () => get(SEED_FILES.exclusiveZip, IP_44)),
    );
    for (const res of results) expect(res.status).toBe(302);

    expect(await seedCounts()).toEqual({
      file: before.file + 10,
      project: before.project + 10,
    });
    expect(await downloadRowCount(ipHash(IP_44))).toBe(rowsBefore + 10);
  });

  it(`T-ACT-44 31st request in a minute from one ip → 429, Retry-After 60, "${RATE_LIMITED_MESSAGE}"`, async () => {
    // 30 hits arranged directly in `rate_limit_hits` — the only table `rate_limit_ok` counts
    // (ADR-0002 A4); key = the daily `ipHash`, exactly what the route passes (D3).
    const key = ipHash(IP_LIMIT);
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 30 }, () => ({ scope: 'download', key })));
    expect(error).toBeNull();

    const before = await seedCounts();
    const res = await get(SEED_FILES.exclusiveZip, IP_LIMIT);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'rate_limited', message: RATE_LIMITED_MESSAGE },
    });

    // The limit fires BEFORE record_download — no counter moved, no log row; the rejected
    // call still recorded its own hit (ADR-0002 A4).
    expect(await seedCounts()).toEqual(before);
    expect(await downloadRowCount(key)).toBe(0);
    expect(await countRateLimitHits('download', key)).toBe(31);
  });

  it.each<{ name: string; rpc: string; throws?: unknown; metaName: string }>([
    { name: 'the rate limiter RPC fails (not a limit)', rpc: 'rate_limit_ok', metaName: 'Error' },
    { name: 'record_download fails', rpc: 'record_download', metaName: 'Error' },
    {
      name: 'record_download rejects with a non-Error',
      rpc: 'record_download',
      throws: 'boom',
      metaName: 'unknown',
    },
  ])(
    'T-ACT-44 $name → 500 internal, no counter moved, no log row, one route_unhandled line',
    async ({ rpc, throws, metaName }) => {
      const before = await seedCounts();
      const logs = spyLog();
      try {
        const res = await withDbFault({ rpc }, throws === undefined ? {} : { throws }, () =>
          get(SEED_FILES.exclusiveZip, IP_FAULT),
        );
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          ok: false,
          error: { code: 'internal', message: 'Something broke.' },
        });
      } finally {
        logs.restore();
      }
      expect(await seedCounts()).toEqual(before);
      expect(await downloadRowCount(ipHash(IP_FAULT))).toBe(0);
      const lines = logs.lines.filter(
        (entry) => (entry as { msg?: string }).msg === 'route_unhandled',
      ) as Array<{ action?: string; meta?: { name?: string } }>;
      expect(lines).toHaveLength(1);
      expect(lines[0]?.action).toBe('download');
      expect(lines[0]?.meta?.name).toBe(metaName);
    },
  );

  it('T-ACT-44 signed-URL failure after the counters → 500 internal (counters already moved — 04 §2.3 Errors row)', async () => {
    const before = await seedCounts();
    const logs = spyLog();
    signedUrlFailure.active = true;
    try {
      const res = await get(SEED_FILES.exclusiveZip, IP_500);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        ok: false,
        error: { code: 'internal', message: 'Something broke.' },
      });
    } finally {
      signedUrlFailure.active = false;
      logs.restore();
    }

    // record_download ran before the signing step — the increment stands (acceptable, logged).
    expect(await seedCounts()).toEqual({ file: before.file + 1, project: before.project + 1 });
    expect(await downloadRowCount(ipHash(IP_500))).toBe(1);
    const line = logs.lines.find(
      (entry) => (entry as { msg?: string }).msg === 'route_unhandled',
    ) as { action?: string } | undefined;
    expect(line?.action).toBe('download');
  });
});
