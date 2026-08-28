/**
 * tests/e2e/flows/download.spec.ts — T-E2E-31 (05 §7.3): the exclusive project's GET IT primary
 * (`TrackedLink` `data-variant="primary"` → `/api/download/<file id>`, 04 §2.3 D1–D7) really
 * downloads. Request-level chain: the route answers 302 with the D6 headers and a signed URL
 * (token + `download=seed-exclusive-pack-1.0.0.zip`, D5); following it answers 200
 * `content-disposition: attachment; filename="…"` from local Storage. One real click then proves
 * the button end-to-end (Playwright `download` event) and fires
 * `track('download', { project, source: 'direct', from: 'get-it' })` into the `window.va` stub
 * (04 §5.6; ADR-0002 C12 — same mechanism as T-E2E-16). `download_count` / `downloads_direct`
 * move by EXACTLY the two route hits this test makes (D4; the followed signed URL hits Storage,
 * never the route), read via the service client.
 *
 * DEFERRED — the 05 row's "the GET IT panel shows the count after revalidate" clause: the route
 * does no revalidation (04 §2.3 D7 — analytics/counters never revalidate the page); counts
 * surface at the next ISR pass, ≤600 s (02 §1.4 caching row). The e2e lane runs the prod server
 * (`pnpm start`), so that window cannot be waited out without flaking — recorded here, not
 * asserted.
 *
 * `mutatesSeed`: the two counted hits bump the SHARED seed counters (…0501 `download_count`,
 * …0103 `downloads_direct` — the db suite, tests/db/routes/download.test.ts, asserts exact 7→8
 * on the same rows), so beforeAll snapshots both and afterAll restores the snapshot and deletes
 * this run's `project_downloads` rows (matched on file_id + created_at ≥ test start — this
 * process cannot compute `ipHash`, lib/hash is app-side). beforeAll also re-uploads the seed
 * object bytes (SEED-13 `uploadFixture`, idempotent upsert — a freshly seeded stack has the DB
 * row but not the object).
 */
import { test, expect } from '../fixtures';
import { asRole } from '../../helpers/asRole';
import { loadEnvTest } from '../../helpers/envTest';
import { SEED_FILES, SEED_PROJECTS, SEED_VERSIONS } from '../../helpers/seedIds';
import { uploadFixture } from '../../helpers/storage';

const FILE_ID = SEED_FILES.exclusiveZip;
const SEED_FILENAME = 'seed-exclusive-pack-1.0.0.zip';
/** Object path inside `project-files` (DB `storage_path` minus the bucket prefix — SC-21). */
const SEED_OBJECT_PATH = `${SEED_PROJECTS.seedExclusivePack}/${SEED_VERSIONS.exclusive_1_0_0}/${SEED_FILENAME}`;
/** TEST-NET-3, distinct from the db suite's .43–.46 so the `download` rate-limit keys never collide. */
const DIRECT_IP = '203.0.113.77';

type VaCall = [kind: string, payload: unknown];
type Counts = { file: number; project: number };

let snapshot: Counts | undefined;
let testStart = '';

function requireSnapshot(): Counts {
  if (snapshot === undefined) throw new Error('beforeAll snapshot missing');
  return snapshot;
}

/** The shared seed counters, read via the service client (05 §1.3 "service = inspect state"). */
async function seedCounts(): Promise<Counts> {
  const service = asRole('service');
  const file = await service
    .from('project_files')
    .select('download_count')
    .eq('id', FILE_ID)
    .single();
  if (file.error) throw new Error(`seedCounts: project_files read failed: ${file.error.message}`);
  const project = await service
    .from('projects')
    .select('downloads_direct')
    .eq('id', SEED_PROJECTS.seedExclusivePack)
    .single();
  if (project.error) throw new Error(`seedCounts: projects read failed: ${project.error.message}`);
  return { file: file.data.download_count, project: project.data.downloads_direct };
}

/** `project_downloads` rows this run created (file id + created_at ≥ test start). */
async function downloadRowsSince(startIso: string): Promise<number> {
  const { count, error } = await asRole('service')
    .from('project_downloads')
    .select('id', { count: 'exact', head: true })
    .eq('file_id', FILE_ID)
    .gte('created_at', startIso);
  if (error) throw new Error(`downloadRowsSince: ${error.message}`);
  return count ?? 0;
}

/**
 * Resolves once React has hydrated the element `selector` points at (host instances carry a
 * `__reactFiber$…` key only then) — `TrackedLink` is a client island, and a click that lands
 * before hydration would download but never reach `trackEvent`.
 */
async function waitForHydrated(page: import('@playwright/test').Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el !== null && Object.keys(el).some((key) => key.startsWith('__reactFiber$'));
  }, selector);
}

test.beforeAll(async () => {
  loadEnvTest();
  // SEED-13 bytes: the DB globalSetup uploads them for the db lane; an e2e run against a freshly
  // seeded stack may not have them. Idempotent upsert; object path WITHOUT the bucket prefix.
  await uploadFixture('project-files', SEED_OBJECT_PATH, 'files/pack.zip');
  snapshot = await seedCounts();
  testStart = new Date().toISOString();
});

test.afterAll(async () => {
  if (snapshot === undefined || testStart === '') return; // beforeAll never got to the snapshot
  const service = asRole('service');
  const del = await service
    .from('project_downloads')
    .delete()
    .eq('file_id', FILE_ID)
    .gte('created_at', testStart);
  if (del.error) throw new Error(`restore: project_downloads delete failed: ${del.error.message}`);
  const file = await service
    .from('project_files')
    .update({ download_count: snapshot.file })
    .eq('id', FILE_ID);
  if (file.error) throw new Error(`restore: project_files failed: ${file.error.message}`);
  const project = await service
    .from('projects')
    .update({ downloads_direct: snapshot.project })
    .eq('id', SEED_PROJECTS.seedExclusivePack);
  if (project.error) throw new Error(`restore: projects failed: ${project.error.message}`);
});

test.describe('download route', () => {
  test('T-E2E-31 GET IT direct download → 302 signed URL → 200 attachment; va download; counters +2', async ({
    page,
  }) => {
    // `window.va` stub (04 §5.6): calls are forwarded to Node synchronously, as in T-E2E-16.
    const vaCalls: VaCall[] = [];
    await page.exposeFunction('__odsensVa', (kind: string, payload: unknown) => {
      vaCalls.push([kind, payload]);
    });
    await page.addInitScript(() => {
      type Stubbed = Window & {
        va?: (kind: string, payload: unknown) => void;
        __odsensVa?: (kind: string, payload: unknown) => Promise<void>;
      };
      const w = window as Stubbed;
      w.va = (kind, payload) => {
        void w.__odsensVa?.(kind, payload);
      };
    });

    await page.goto('/projects/seed-exclusive-pack');
    const panel = page.locator('aside[aria-labelledby="get-it-seed-exclusive-pack"]');
    const primary = panel.locator('a[data-variant="primary"]');
    await expect(primary).toBeVisible();
    await expect(primary).toHaveAttribute('href', `/api/download/${FILE_ID}`);

    // --- Request-level chain (page.request bypasses the browser routing; ONE counted hit) ---
    const redirect = await page.request.get(`/api/download/${FILE_ID}`, {
      maxRedirects: 0,
      headers: { 'x-forwarded-for': DIRECT_IP },
    });
    expect(redirect.status()).toBe(302);
    // D6 — never cacheable, never sniffed, never a referrer.
    expect(redirect.headers()['cache-control']).toBe('private, no-store');
    expect(redirect.headers()['x-content-type-options']).toBe('nosniff');
    expect(redirect.headers()['referrer-policy']).toBe('no-referrer');
    // D5 — Location = local-storage signed URL for exactly the seed object, token + download=….
    const location = redirect.headers()['location'] ?? '';
    const signed = new URL(location);
    expect(signed.pathname).toContain(`/storage/v1/object/sign/project-files/${SEED_OBJECT_PATH}`);
    expect(signed.searchParams.get('token')).toBeTruthy();
    expect(signed.searchParams.get('download')).toBe(SEED_FILENAME);

    // Following the signed URL hits Storage (never the route — not counted): 200 attachment.
    const followed = await page.request.get(location);
    expect(followed.status()).toBe(200);
    const disposition = followed.headers()['content-disposition'] ?? '';
    expect(disposition).toContain('attachment');
    // Supabase storage emits `filename=<name>; filename*=UTF-8''<name>` (unquoted) — assert the
    // attachment + filename tokens, not the 05 row's illustrative quoting.
    expect(disposition).toMatch(new RegExp(`filename="?${SEED_FILENAME.replace(/\./g, '\\.')}"?`));
    expect((await followed.body()).byteLength).toBeGreaterThan(0);

    // --- One real click proves the button end-to-end (the second counted hit) ---
    await waitForHydrated(page, 'a[data-variant="primary"]');
    const routeResponse = page.waitForResponse(
      (res) => new URL(res.url()).pathname === `/api/download/${FILE_ID}`,
    );
    const downloadEvent = page.waitForEvent('download');
    await primary.click();
    expect((await routeResponse).status()).toBe(302);
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(SEED_FILENAME);
    expect(await download.failure()).toBeNull();

    // D7 — analytics fire client-side on the button, never in the route: exactly one va call.
    await expect.poll(() => vaCalls.length).toBeGreaterThan(0);
    expect(vaCalls).toEqual([
      [
        'event',
        {
          name: 'download',
          data: { project: 'seed-exclusive-pack', source: 'direct', from: 'get-it' },
        },
      ],
    ]);

    // --- D4: counters moved by exactly our two route hits, one hashed log row each ---
    const before = requireSnapshot();
    await expect
      .poll(seedCounts, { message: 'record_download: counters +2 for the two route hits' })
      .toEqual({ file: before.file + 2, project: before.project + 2 });
    expect(await downloadRowsSince(testStart)).toBe(2);
  });
});
