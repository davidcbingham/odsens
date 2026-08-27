/**
 * tests/e2e/admin/projects.spec.ts — the S1.2 admin flows, one serial file in the `admin`
 * project (05 §1.1: serial, 1280 only; playwright.config.ts runs `admin` after the read-only
 * projects so the seed-truth smoke assertions never race a mutation):
 *
 *  - T-E2E-42 (S1.2 scope: "first admin page `/admin/projects`; extends per admin slice"):
 *    `expectNoSeriousA11y` + 1280 screenshots for every S1.2 admin route — `/admin`,
 *    `/admin/projects`, `/admin/projects/[id]` (admin is desktop-first; phone screenshots start
 *    with `/admin/settings`/`/admin/comments` in their slices).
 *  - T-E2E-34 (S1.2 scope: "curate part; extra-gallery upload waits for S1.3" — ADR-0002 C10):
 *    the moderator read-only pass (controls present but DISABLED + "Admin only", no action call,
 *    no forbidden toast — 02 §1.3 / 03 §2.10; disabled = native `disabled` or
 *    `aria-disabled="true"`, both sanctioned by 03 §2.10, asserted via `toBeDisabled`) and the
 *    admin curate pass (feature/hide/reorder on the list — ADR-0002 A11 — notes + CF id on
 *    `[id]`). Every mutation is reverted THROUGH THE SAME ACTION so `revalidateTag` repairs the
 *    ISR caches too; `restoreContentTables` in afterAll is the byte-level safety net (05 H-1).
 *  - T-E2E-41: the SC-13 lock ("Already running." — arranged deterministically with an open
 *    `sync_runs` row, since a pending Sync now button is disabled and cannot be double-clicked)
 *    and a real `triggerSync` run against the :4010 fixture server (ADR-0002 #73). The fixture
 *    list ⊇ seed, so the sync inserts the extra fixture projects; "project count unchanged" is
 *    asserted as its fixtures-⊇-seed guarantee: every seed project survives, published and
 *    unhidden. The DB is snapshot-restored afterwards and one no-op `curateProject` save
 *    revalidates the `projects` tag (carried by every S1.2 cache entry) to repair the caches.
 *
 * Seed truths: SEED-4..6 (3 published projects; overrides featured 1 = pixel-chameleon,
 * 2 = seed-exclusive-pack; CF link 900001 on pixel-chameleon), SEED-12 (one ok run per source).
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { asRole, loose } from '../../helpers/asRole';
import { expectNoSeriousA11y } from '../../helpers/axe';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '../../helpers/contentReset';
import { loadEnvTest } from '../../helpers/envTest';
import { loginAs } from '../../helpers/loginAs';
import { shoot } from '../../helpers/screenshots';
import { SEED_PROJECTS } from '../../helpers/seedIds';

test.describe.configure({ mode: 'serial' });

const ADMIN_ONLY = 'Admin only';
const PIXEL = SEED_PROJECTS.pixelChameleon;
const MACE = SEED_PROJECTS.metalPipeMace;

let snapshot: ContentSnapshot;

test.beforeAll(async () => {
  loadEnvTest();
  snapshot = await snapshotContentTables();
});

test.afterAll(async () => {
  // Safety net (05 H-1): the flows revert through their own actions; this repairs a failed run.
  await restoreContentTables(snapshot);
});

/** The visible square of a Toggle (its input is visually hidden — 03 §2.2 `Toggle` markup). */
function toggleFor(page: Page, label: string) {
  return {
    input: page.locator(`input[aria-label="${label}"]`),
    label: page.locator(`label:has(input[aria-label="${label}"])`),
  };
}

/** Clicks `name` and waits for its server-action POST round trip (PRG — same-URL redirect). */
async function submitAndWait(page: Page, name: string): Promise<void> {
  const post = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/admin/projects/'),
  );
  await page.getByRole('button', { name, exact: true }).click();
  await post;
}

/**
 * ISR entries are stale-while-revalidate after `revalidateTag(…, 'max')`: the first request
 * after a curation can still serve the pre-action page while the entry regenerates in the
 * background. Re-navigate until `assert` holds (inner assertions use short timeouts so the
 * whole block retries quickly).
 */
async function expectAtUrl(page: Page, url: string, assert: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url);
    await assert();
  }).toPass({ timeout: 20_000, intervals: [400, 800, 1_600] });
}

// ---------------------------------------------------------------------------------------------
// T-E2E-42 — a11y + screenshots, pristine seed state first
// ---------------------------------------------------------------------------------------------

test('T-E2E-42 admin routes: axe zero serious/critical + 1280 screenshots (/admin, /admin/projects, /admin/projects/[id])', async ({
  page,
}) => {
  await loginAs(page, 'admin');

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'SYNC' })).toBeVisible();
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-dashboard');

  await page.goto('/admin/projects');
  await expect(page.getByRole('heading', { name: 'ALL PROJECTS' })).toBeVisible();
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-projects');

  await page.goto(`/admin/projects/${PIXEL}`);
  await expect(page.getByRole('heading', { name: 'OVERRIDES' })).toBeVisible();
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-project-detail');
});

// ---------------------------------------------------------------------------------------------
// T-E2E-34 — moderator pass: everything visible, mutation controls disabled, no action calls
// ---------------------------------------------------------------------------------------------

test('T-E2E-34 moderator: list + curate controls present but disabled ("Admin only"), clicking issues no action call', async ({
  page,
}) => {
  await loginAs(page, 'mod');
  await page.goto('/admin/projects');

  // The RLS-filtered read (05 T-RLS-16 mod = pub): all 3 seed projects are published & visible.
  const list = page.locator('section', {
    has: page.getByRole('heading', { name: 'ALL PROJECTS' }),
  });
  await expect(list.locator('tbody tr')).toHaveCount(3);
  await expect(list.getByText('LIVE', { exact: true })).toHaveCount(3);

  // Feature/Hide toggles: disabled + wrapped in title="Admin only" (03 §2.10), never hidden.
  for (const label of ['Feature Pixel Chameleon', 'Hide Metal Pipe Mace']) {
    const { input, label: wrapper } = toggleFor(page, label);
    await expect(input).toBeDisabled();
    expect(
      await wrapper.evaluate((el) => el.closest('[title="Admin only"]') !== null),
      `${label} sits under title="Admin only"`,
    ).toBe(true);
  }

  // Reorder handles (⠿): disabled + aria-disabled + title (03 §2.10 `ReorderableList`).
  const handle = page.getByRole('button', { name: 'Move Pixel Chameleon' });
  await expect(handle).toBeDisabled();
  await expect(handle).toHaveAttribute('title', ADMIN_ONLY);

  // SyncStatus "Sync now": disabled + title, never absent (03 §2.10 `SyncStatus`).
  const syncButtons = page.getByRole('button', { name: 'Sync now' });
  await expect(syncButtons).toHaveCount(2); // modrinth + curseforge rows
  for (let i = 0; i < 2; i += 1) {
    await expect(syncButtons.nth(i)).toBeDisabled();
    expect(
      await syncButtons.nth(i).evaluate((el) => el.closest('[title="Admin only"]') !== null),
    ).toBe(true);
  }

  // Clicking a disabled control issues no action call and no forbidden toast (02 §1.3).
  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') posts.push(req.url());
  });
  await toggleFor(page, 'Feature Pixel Chameleon').label.click({ force: true });
  await handle.click({ force: true });
  await page.waitForTimeout(500);
  expect(posts, 'no server-action POST left the page').toEqual([]);
  await expect(page.getByText('Not allowed.')).toHaveCount(0);
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);

  // `[id]` curate view: fields, comments toggle and both saves disabled the same way.
  await page.goto(`/admin/projects/${MACE}`);
  await expect(page.getByLabel('Title override')).toBeDisabled();
  await expect(page.getByLabel('Notes')).toBeDisabled();
  await expect(page.getByLabel('CurseForge id or URL')).toBeDisabled();
  await expect(toggleFor(page, 'Comments on Metal Pipe Mace').input).toBeDisabled();
  for (const name of ['Save', 'Save link']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeDisabled();
    expect(await button.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(true);
  }
});

// ---------------------------------------------------------------------------------------------
// T-E2E-34 — admin curate pass (each mutation reverted through the same action)
// ---------------------------------------------------------------------------------------------

test('T-E2E-34 admin: feature/hide/reorder on the list, notes + CF id on [id] — with revalidated public pages', async ({
  page,
}) => {
  const service = loose(asRole('service'));
  await loginAs(page, 'admin');

  // The list: 3 projects with StatusPills (05 T-E2E-34 "table lists 3 projects").
  await page.goto('/admin/projects');
  const list = page.locator('section', {
    has: page.getByRole('heading', { name: 'ALL PROJECTS' }),
  });
  await expect(list.locator('tbody tr')).toHaveCount(3);
  await expect(list.getByText('LIVE', { exact: true })).toHaveCount(3);

  // -- Feature OFF pixel-chameleon → `/` hero becomes seed-exclusive-pack, 4-up empties -------
  const feature = toggleFor(page, 'Feature Pixel Chameleon');
  await expect(feature.input).toBeChecked();
  await feature.label.click();
  await expect(feature.input).not.toBeChecked({ timeout: 10_000 }); // action + PRG refresh

  await expectAtUrl(page, '/', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seed Exclusive Pack', {
      timeout: 1_000,
    });
    await expect(page.getByRole('heading', { name: 'FEATURED PROJECTS' })).toHaveCount(0, {
      timeout: 500,
    });
  });

  // Revert (same action): feature back ON; the hero returns (featured_order 1 was kept).
  await page.goto('/admin/projects');
  await feature.label.click();
  await expect(feature.input).toBeChecked({ timeout: 10_000 });
  await expectAtUrl(page, '/', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pixel Chameleon', {
      timeout: 1_000,
    });
  });

  // -- Reorder featured (⠿ keyboard — 03 §2.10): Home order follows featured_order ------------
  await page.goto('/admin/projects');
  const order = page.locator('ol[aria-label="Featured projects"] li');
  await expect(order).toHaveCount(2);
  await expect(order.nth(0)).toContainText('Pixel Chameleon');
  const commit = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/admin/projects'),
  );
  await page.getByRole('button', { name: 'Move Pixel Chameleon' }).press('ArrowDown');
  await commit; // arrow-without-grab commits ONE curateProject reorder call (ADR-0002 A11)
  const featured = page.locator('section', {
    has: page.getByRole('heading', { name: 'FEATURED PROJECTS' }),
  });
  await expectAtUrl(page, '/', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seed Exclusive Pack', {
      timeout: 1_000,
    });
    await expect(featured.getByRole('heading', { name: 'Pixel Chameleon' })).toBeVisible({
      timeout: 500,
    });
  });

  // Revert: move it back up; Home hero returns to pixel-chameleon.
  await page.goto('/admin/projects');
  const revertCommit = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/admin/projects'),
  );
  await page.getByRole('button', { name: 'Move Pixel Chameleon' }).press('ArrowUp');
  await revertCommit;
  await expectAtUrl(page, '/', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pixel Chameleon', {
      timeout: 1_000,
    });
  });

  // -- Hide metal-pipe-mace → /projects shows 2 cards, its detail page 404s -------------------
  await page.goto('/admin/projects');
  const hide = toggleFor(page, 'Hide Metal Pipe Mace');
  await expect(hide.input).not.toBeChecked();
  await hide.label.click();
  await expect(hide.input).toBeChecked({ timeout: 10_000 });

  await expectAtUrl(page, '/projects', async () => {
    await expect(page.locator('article')).toHaveCount(2, { timeout: 1_000 });
  });
  await expect(page.getByRole('heading', { name: 'Metal Pipe Mace' })).toHaveCount(0);
  // The detail URL now renders the root 404 shell. Status stays 200: Next 16 streams the
  // notFound() under RP-10's loading.tsx files (see tests/e2e/smoke/shells.spec.ts header —
  // ADR-0025 interim tolerance, T-E2E-34 as amended); the body is the binding assertion.
  await expectAtUrl(page, '/projects/metal-pipe-mace', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /that page doesn[’']t exist/i,
      { timeout: 1_000 },
    );
  });

  // Revert: unhide; the card and detail page come back.
  await page.goto('/admin/projects');
  await hide.label.click();
  await expect(hide.input).not.toBeChecked({ timeout: 10_000 });
  await expectAtUrl(page, '/projects', async () => {
    await expect(page.locator('article')).toHaveCount(3, { timeout: 1_000 });
  });

  // -- Notes on [id] → appended under About as a NoteCallout (02 §2.3 #3) ---------------------
  const NOTE = 'Bonk appreciation note.';
  await page.goto(`/admin/projects/${MACE}`);
  await page.getByLabel('Notes').fill(NOTE);
  await submitAndWait(page, 'Save');
  await expect(page.getByLabel('Notes')).toHaveValue(NOTE); // PRG re-render shows stored value
  await expectAtUrl(page, '/projects/metal-pipe-mace', async () => {
    await expect(page.getByText(NOTE)).toBeVisible({ timeout: 1_000 });
  });

  // Revert: empty notes → null (the [id] form's orNull) — the note leaves the page.
  await page.goto(`/admin/projects/${MACE}`);
  await page.getByLabel('Notes').fill('');
  await submitAndWait(page, 'Save');
  await expectAtUrl(page, '/projects/metal-pipe-mace', async () => {
    await expect(page.getByText(NOTE)).toHaveCount(0, { timeout: 1_000 });
  });

  // -- CF id entry (900001) → link row + downloads_curseforge set immediately (via service) ---
  await page.goto(`/admin/projects/${MACE}`);
  await page.getByLabel('CurseForge id or URL').fill('900001');
  await submitAndWait(page, 'Save link');
  await expect(page.getByText('Linked. 120 downloads counted.')).toBeVisible();

  const link = await service
    .from('project_links')
    .select('external_id, downloads')
    .eq('project_id', MACE)
    .eq('platform', 'curseforge')
    .maybeSingle();
  expect(link.error).toBeNull();
  expect(link.data).toMatchObject({ external_id: '900001', downloads: 120 });
  const project = await service
    .from('projects')
    .select('downloads_curseforge')
    .eq('id', MACE)
    .single();
  expect(project.data?.downloads_curseforge).toBe(120);

  // Revert: empty ref → the action deletes the link and zeroes the count (04 §1.4).
  await page.getByLabel('CurseForge id or URL').fill('');
  await submitAndWait(page, 'Save link');
  const removed = await service
    .from('project_links')
    .select('external_id')
    .eq('project_id', MACE)
    .eq('platform', 'curseforge')
    .maybeSingle();
  expect(removed.data).toBeNull();
  const zeroed = await service
    .from('projects')
    .select('downloads_curseforge')
    .eq('id', MACE)
    .single();
  expect(zeroed.data?.downloads_curseforge).toBe(0);
});

// ---------------------------------------------------------------------------------------------
// T-E2E-41 — sync trigger: lock first (deterministic), then a real fixture-server run
// ---------------------------------------------------------------------------------------------

test('T-E2E-41 Sync now (Modrinth): lock → "Already running."; real run → new ok row, seed projects survive', async ({
  page,
}) => {
  const service = loose(asRole('service'));
  await loginAs(page, 'admin');

  // SC-13 lock, arranged: an open run (finished_at NULL, 2 min old) holds the lock. A pending
  // "Sync now" button is disabled (`aria-busy`), so 05's "clicking twice quickly" cannot race
  // two POSTs from one button — the open-row arrangement asserts the same contract.
  const openRun = await service
    .from('sync_runs')
    .insert({ source: 'modrinth', started_at: new Date(Date.now() - 120_000).toISOString() })
    .select('id')
    .single();
  expect(openRun.error).toBeNull();
  const openRunId = (openRun.data as { id: string }).id;

  await page.goto('/admin/projects');
  const modrinthRow = page.locator('tr', { hasText: 'Modrinth' });
  await modrinthRow.getByRole('button', { name: 'Sync now' }).click();
  await expect(modrinthRow.getByText('Already running.')).toBeVisible({ timeout: 15_000 });

  const cleared = await service.from('sync_runs').delete().eq('id', openRunId);
  expect(cleared.error).toBeNull();

  // Real run against the fixture server (ADR-0002 #73): toast, then a fresh ok row in the table.
  await page.reload();
  await modrinthRow.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Sync started.')).toBeVisible({ timeout: 30_000 });
  await expect(modrinthRow.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(modrinthRow.getByText('just now')).toBeVisible();

  const latest = await service
    .from('sync_runs')
    .select('ok, finished_at, error')
    .eq('source', 'modrinth')
    .order('started_at', { ascending: false })
    .limit(1)
    .single();
  expect(latest.error).toBeNull();
  expect(latest.data?.ok).toBe(true);
  expect(latest.data?.finished_at).not.toBeNull();

  // Fixtures ⊇ seed: every seed project survives the run, published and unhidden.
  for (const slug of ['metal-pipe-mace', 'pixel-chameleon', 'seed-exclusive-pack']) {
    const row = await service.from('projects').select('status').eq('slug', slug).single();
    expect(row.data?.status, slug).toBe('published');
  }
  const seedRows = page.locator('section', {
    has: page.getByRole('heading', { name: 'ALL PROJECTS' }),
  });
  for (const title of ['Metal Pipe Mace', 'Pixel Chameleon', 'Seed Exclusive Pack']) {
    await expect(seedRows.getByText(title, { exact: true })).toBeVisible();
  }

  // Restore the seed byte-for-byte, then repair the ISR caches with one no-op curateProject
  // save (its `revalidateTag('projects')` covers every S1.2 cache entry — home, list, details,
  // sitemap all carry the `projects` tag).
  await restoreContentTables(snapshot);
  await page.goto(`/admin/projects/${PIXEL}`);
  await submitAndWait(page, 'Save');
  await expectAtUrl(page, '/projects', async () => {
    await expect(page.locator('article')).toHaveCount(3, { timeout: 1_000 });
    await expect(page.getByText('3 things. Some useful, some not.')).toBeVisible({
      timeout: 500,
    });
  });
});
