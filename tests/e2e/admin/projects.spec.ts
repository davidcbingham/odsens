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
 *  - S1.4 (same file — the `admin` project is serial only within a file): T-E2E-42 gains the
 *    `/admin/comments` leg (axe + 1280 AND 390 screenshots — 05 §7.5: phone shots for
 *    `/admin/settings` and `/admin/comments` only) at the top, pristine seed first; T-E2E-36 (the
 *    moderation queue as `seed_mod`) is the last describe below.
 *  - S1.5 (same file, same reason): T-E2E-42 gains the `/admin/settings` leg (axe + 1280 AND
 *    390) right after `/admin/comments`, pristine seed first; T-E2E-37 (the whole settings page
 *    as `oddsense` — matrix, webhook against the :4010 fixture server, admin emails, moderators
 *    through `setUserRole`, Ko-fi) is the final describe; SEED-1 + SEED-2 restored in its
 *    `afterAll` through `restoreSeedSettings()`.
 *
 * Seed truths: SEED-4..6 (3 published projects; overrides featured 1 = pixel-chameleon,
 * 2 = seed-exclusive-pack; CF link 900001 on pixel-chameleon), SEED-12 (one ok run per source),
 * SEED-9 (the held `…0203` by seed_user2, the hidden + reported `…0204`).
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { freeHandle, readProfile } from '../../helpers/arrange';
import { asRole, loose } from '../../helpers/asRole';
import { expectNoSeriousA11y } from '../../helpers/axe';
import {
  deleteNonSeedComments,
  readCommentRow,
  restoreSeedHeldComment,
} from '../../helpers/commentsReset';
import {
  restoreContentTables,
  restoreSeedSettings,
  snapshotContentTables,
  type ContentSnapshot,
} from '../../helpers/contentReset';
import { loadEnvTest } from '../../helpers/envTest';
import {
  cleanupFactories,
  makeComment,
  makeUser,
  purgeNotificationEvents,
  restoreSeedCommentCounts,
} from '../../helpers/factories';
import { fixturePath } from '../../helpers/fixtures';
import { loginAs } from '../../helpers/loginAs';
import { shoot } from '../../helpers/screenshots';
import { listObjects, removeObjects } from '../../helpers/storage';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '../../helpers/seedIds';
import { repairThreadCache } from '../../helpers/threadCache';

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

test('T-E2E-42 admin routes: axe zero serious/critical + 1280 screenshots (/admin, /admin/projects, /admin/projects/[id]) + /admin/comments at 1280 and 390', async ({
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

  // S1.4: the moderation queue — desktop AND phone (05 T-E2E-42; 00 S1.4.AC14/AC17).
  await page.goto('/admin/comments');
  await expect(page).toHaveTitle('Comments · Admin');
  await expect(page.getByRole('heading', { name: 'MODERATION QUEUE' })).toBeVisible();
  await expect(page.getByText('HELD', { exact: true })).toBeVisible(); // seed …0203
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-comments');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'MODERATION QUEUE' })).toBeVisible();
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-comments');
  await page.setViewportSize({ width: 1280, height: 800 });

  // S1.5: the settings page — desktop AND phone (05 T-E2E-42; 00 S1.5.AC1/AC2), seed state.
  await page.goto('/admin/settings');
  await expect(page).toHaveTitle('Settings · Admin');
  await expect(page.getByRole('heading', { name: 'NOTIFICATIONS' })).toBeVisible();
  await expect(page.getByText('COMING LATER', { exact: true })).toHaveCount(3);
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-settings');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'NOTIFICATIONS' })).toBeVisible();
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-settings');
  await page.setViewportSize({ width: 1280, height: 800 });
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

/**
 * T-E2E-35 (05 §7.3): the S1.3 exclusive-project lifecycle. Lives in THIS file because the
 * `admin` project is serial only within a file — Playwright still runs separate spec files on
 * parallel workers, and these mutations must never race the T-E2E-34/41 flows above (05 §1.1
 * "one serial file"):
 *
 *  - Create: `/admin/projects/new` form → "Create draft" → `/admin/projects/<uuid>` with a DRAFT
 *    `StatusPill` (02 §1.3; the edit page carries the uploads — data-model §6 canonical flow).
 *  - `UploadWell` states (03 §2.10; DESIGN.md §11.1): idle copy + always-visible limits line,
 *    dragover "Let go." (a dispatched `dragenter` with a real `DataTransfer`), and the ERROR copy
 *    printed by the client pre-check with the server's exact words from `lib/validation/files.ts`
 *    (`sizeLimitMessage` / `typeMessage` — no POST leaves the page for either).
 *  - Publish preconditions (ADR-0002 #65; 05 T-ACT-37): publishing before the icon/file lands the
 *    `precondition_failed` message on the PUBLISH form's `role="alert"` line.
 *  - Uploads (04 §1.4.5 two-phase begin → signed PUT → commit; ADR-0026): icon `icon-256.png` and
 *    file `pack.zip` through the real wells against the LOCAL Supabase Storage. The transient
 *    `uploading` percent/progressbar is timing-fragile for a sub-KB file on localhost (the PUT
 *    settles in one tick), so the progressbar role is deliberately NOT raced here — the `done`
 *    state (✔ + name + size) is the binding assertion.
 *  - Publish → LIVE; the public `/projects/t-e2e-excl` page shows the `ExclusiveBadge`
 *    ("ONLY ON ODSENS" — 00 S1.3.AC1/AC8), the full 128-hex sha512 line (00 S1.3.AC3), DETAILS
 *    "Only on odsens", and a GET IT primary `href=/api/download/<file id>` that answers 302 with
 *    a signed `token` + `download=` Location (04 §2.3 D5/D6).
 *  - Moderator pass (ADR-0002 C7; 03 §2.10): create form + every editor control, toggle and well
 *    disabled under `title="Admin only"` — present, never hidden.
 *  - axe + screenshots on `/admin/projects/new` at 1280 AND 390 (00 S1.3.AC12's admin half —
 *    admin pages join the phone matrix in S1.3).
 *
 * Cleanup discipline (05 H-1): the project is unpublished THROUGH `publishProject` first so
 * `revalidateTag('projects')` repairs the public ISR caches (the sibling's revert-through-the-
 * same-action rule); `afterAll` then removes the uploaded Storage objects, deletes the project
 * row via the service client (cascade takes versions/files/overrides/downloads), forgets the
 * `rate_limit_hits` this test created (scopes `upload:*` from the begins, `download` from the
 * 302), and `restoreContentTables` is the byte-level safety net for a failed run.
 */
test.describe('exclusive lifecycle (T-E2E-35)', () => {
  const SLUG = 't-e2e-excl';
  const TITLE = 'E2E Exclusive';
  const UUID_TAIL =
    /\/admin\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // The exact client-pre-check copy (lib/validation/files.ts — the server's words, 03 §2.10).
  const OVERSIZE_MESSAGE = "That's 120 MB. The limit is 100.";
  const WRONG_TYPE_MESSAGE = "That's a .exe. Allowed: .jar .zip .mrpack";
  // publishProject preconditions, both missing, in code order (ADR-0002 #65; 05 T-ACT-37).
  const PRECONDITION_MESSAGE = 'The project needs an icon. Nothing to download yet.';

  let exclusiveSnapshot: ContentSnapshot;
  /** Set by the create test; serial mode means later tests only run when it succeeded. */
  let createdProjectId: string | undefined;

  test.beforeAll(async () => {
    loadEnvTest();
    exclusiveSnapshot = await snapshotContentTables();
  });

  test.afterAll(async () => {
    const service = loose(asRole('service'));
    if (createdProjectId !== undefined) {
      const id = createdProjectId;
      // Storage first, while the version rows still name the nested folders (list is per-level).
      const versions = await service.from('project_versions').select('id').eq('project_id', id);
      expect(versions.error).toBeNull();
      const filePaths: string[] = [];
      for (const row of (versions.data ?? []) as { id: string }[]) {
        filePaths.push(...(await listObjects('project-files', `${id}/${row.id}`)));
      }
      const mediaPaths = [
        ...(await listObjects('project-media', `${id}/icon`)),
        ...(await listObjects('project-media', `${id}/gallery`)),
      ];
      await removeObjects('project-files', filePaths);
      await removeObjects('project-media', mediaPaths);
      // One delete; FKs cascade versions/files/overrides/download rows.
      const deleted = await service.from('projects').delete().eq('id', id);
      expect(deleted.error).toBeNull();
    }
    // The begins hit `upload:project-media` / `upload:project-files`; the 302 hit `download`.
    await service.from('rate_limit_hits').delete().like('scope', 'upload:%');
    await service.from('rate_limit_hits').delete().eq('scope', 'download');
    // Safety net (05 H-1): repairs a failed run byte-for-byte (a clean run left seed untouched).
    await restoreContentTables(exclusiveSnapshot);
  });

  function projectId(): string {
    if (createdProjectId === undefined) throw new Error('create test did not run');
    return createdProjectId;
  }

  /** The page-scoped sections of the exclusive editor (each `UploadWell` root carries data-state). */
  function sections(page: Page) {
    const of = (name: string) =>
      page.locator('section', { has: page.getByRole('heading', { name, exact: true }) });
    return {
      publish: of('PUBLISH'),
      details: of('DETAILS'),
      icon: of('ICON'),
      gallery: of('GALLERY'),
      versions: of('VERSIONS & FILES'),
    };
  }

  /** Fills the ProjectFileWell's gating fields (client state — refilled per test, pages are fresh). */
  async function fillVersionFields(page: Page): Promise<void> {
    const versions = sections(page).versions;
    await versions.getByLabel('Version number').fill('1.0.0');
    await versions.getByLabel('Game versions').fill('1.21');
    await versions.getByLabel('Loaders').fill('datapack');
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
   * ISR entries are stale-while-revalidate after `revalidateTag(…, 'max')`: re-navigate until
   * `assert` holds (inner assertions use short timeouts so the whole block retries quickly).
   */
  async function expectAtUrl(page: Page, url: string, assert: () => Promise<void>): Promise<void> {
    await expect(async () => {
      await page.goto(url);
      await assert();
    }).toPass({ timeout: 20_000, intervals: [400, 800, 1_600] });
  }

  // ---------------------------------------------------------------------------------------------
  // T-E2E-35 — a11y + screenshots on the create form, pristine state first (00 S1.3.AC12)
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-35 /admin/projects/new: axe zero serious/critical + screenshots at 1280 and 390', async ({
    page,
  }) => {
    await loginAs(page, 'admin');

    await page.goto('/admin/projects/new');
    await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();
    await expectNoSeriousA11y(page);
    await shoot(page, 'admin-project-new');

    // 00 S1.3.AC12's admin half: the S1.3 admin page joins the phone matrix.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/projects/new');
    await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();
    await expectNoSeriousA11y(page);
    await shoot(page, 'admin-project-new');
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-35 — create draft → /admin/projects/<uuid> with a DRAFT pill
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-35 create draft: form → "Create draft" → /admin/projects/<uuid> with DRAFT pill', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    // Entry point per 02 §1.3: the list's heading-row "New exclusive project" link.
    await page.goto('/admin/projects');
    await page.getByRole('link', { name: 'New exclusive project', exact: true }).click();
    await page.waitForURL('**/admin/projects/new');
    await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();

    await page.getByLabel('Slug').fill(SLUG);
    await page.getByLabel('Title').fill(TITLE);
    await page.getByLabel('Description').fill('An exclusive datapack created by the e2e suite.');
    await page.getByLabel('Type').selectOption('datapack');
    await page.getByLabel('Loaders').fill('datapack');
    await page.getByLabel('Game versions').fill('1.21');

    await page.getByRole('button', { name: 'Create draft', exact: true }).click();
    // ok → redirect to the edit page — the uploads live there (data-model §6; page header).
    await page.waitForURL(UUID_TAIL);
    const id = page.url().split('/').pop();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    createdProjectId = id;

    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
    await expect(page.getByText('This project is a draft. Nobody sees it.')).toBeVisible();
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-35 — UploadWell states + the exact error copy (client pre-check, zero POSTs)
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-35 UploadWell: idle + limits, dragover "Let go.", oversize and wrong-type copy', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto(`/admin/projects/${projectId()}`);
    const { icon, versions } = sections(page);
    const iconWell = icon.locator('[data-state]');
    const fileWell = versions.locator('[data-state]');

    // Idle copy + the always-visible limits lines (03 §2.10; computed from UPLOAD_KINDS — 04 U4).
    await expect(iconWell).toHaveAttribute('data-state', 'idle');
    await expect(iconWell.getByText('Drop a file here')).toBeVisible();
    await expect(iconWell.getByText('or pick one')).toBeVisible();
    await expect(iconWell.getByText('png · jpg · webp · 5 MB per image')).toBeVisible();
    await expect(fileWell.getByText('.jar .zip .mrpack · 100 MB max')).toBeVisible();

    // Dragover: a dispatched dragenter with a real DataTransfer flips the copy to "Let go." (an
    // empty DataTransfer exposes no filename during dragover — the well omits it silently).
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    const dropLabel = iconWell.locator('label');
    await dropLabel.dispatchEvent('dragenter', { dataTransfer });
    await expect(iconWell).toHaveAttribute('data-state', 'dragover');
    await expect(iconWell.getByText('Let go.')).toBeVisible();
    await dropLabel.dispatchEvent('dragleave', { dataTransfer });
    await expect(iconWell).toHaveAttribute('data-state', 'idle');
    await expect(iconWell.getByText('Drop a file here')).toBeVisible();

    // The file well is gated on the version fields (ProjectFileWell — 04 §1.4 contract).
    await expect(versions.getByText('Fill the version fields first.')).toBeVisible();
    await fillVersionFields(page);
    await expect(versions.getByText('Fill the version fields first.')).toHaveCount(0);

    // Both error paths are the CLIENT pre-check (size/ext only): no POST may leave the page.
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });

    // Oversize: a 120 MB File assigned to the input in-page (a real 120 MB fixture would bloat the
    // repo; the pre-check reads only `file.size`). React's onChange rides the native change event.
    await fileWell.locator('input[type="file"]').evaluate((input: HTMLInputElement) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([new Uint8Array(120 * 1024 * 1024)], 'big.zip', { type: 'application/zip' }),
      );
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(fileWell).toHaveAttribute('data-state', 'error');
    await expect(fileWell.getByRole('alert')).toHaveText(OVERSIZE_MESSAGE);
    await fileWell.getByRole('button', { name: 'Try again' }).click();
    await expect(fileWell).toHaveAttribute('data-state', 'idle');

    // Wrong type: bad.exe through the picker (accept lists don't bind setInputFiles).
    await fileWell.locator('input[type="file"]').setInputFiles(fixturePath('files', 'bad.exe'));
    await expect(fileWell).toHaveAttribute('data-state', 'error');
    await expect(fileWell.getByRole('alert')).toHaveText(WRONG_TYPE_MESSAGE);
    await fileWell.getByRole('button', { name: 'Try again' }).click();
    await expect(fileWell).toHaveAttribute('data-state', 'idle');

    expect(posts, 'client pre-check errors issue no server-action POST').toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-35 — publish preconditions → real uploads → LIVE → the public page + counted 302
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-35 publish flow: precondition alert → icon + file upload → LIVE → public page, sha512, 302 download', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto(`/admin/projects/${projectId()}`);
    const { publish, icon, versions } = sections(page);

    // Publish before anything is uploaded: precondition_failed lists BOTH gaps (ADR-0002 #65).
    await submitAndWait(page, 'Publish');
    await expect(publish.getByRole('alert')).toHaveText(PRECONDITION_MESSAGE);

    // Icon upload (two-phase begin → signed PUT → commit against local Storage — 04 §1.4.5). The
    // transient `uploading` percent/progressbar is not raced here (see file header): `done` is the
    // contract — ✔ + name + size — then router.refresh() shows the committed icon server-side.
    const iconWell = icon.locator('[data-state]');
    await iconWell
      .locator('input[type="file"]')
      .setInputFiles(fixturePath('images', 'icon-256.png'));
    await expect(iconWell).toHaveAttribute('data-state', 'done', { timeout: 15_000 });
    await expect(iconWell.getByText('Uploaded')).toBeAttached(); // the ✔'s visually-hidden label
    await expect(iconWell.getByText('icon-256.png')).toBeVisible();
    await expect(iconWell.getByText('13 KB')).toBeVisible();
    await expect(icon.getByAltText(`${TITLE} icon`)).toBeVisible({ timeout: 15_000 });

    // File upload: version fields gate the well (client state — a fresh page, so refill), primary
    // checked; commit upserts version 1.0.0 + the file row (ADR-0026 partial unique).
    await fillVersionFields(page);
    await toggleFor(page, 'Primary file').label.click({ force: true });
    await expect(toggleFor(page, 'Primary file').input).toBeChecked();
    const fileWell = versions.locator('[data-state]');
    await fileWell.locator('input[type="file"]').setInputFiles(fixturePath('files', 'pack.zip'));
    await expect(fileWell).toHaveAttribute('data-state', 'done', { timeout: 15_000 });
    await expect(fileWell.getByText('pack.zip')).toBeVisible();
    await expect(fileWell.getByText('769 B')).toBeVisible(); // fixture size via formatFileSize
    await expect(versions.getByText('v1.0.0')).toBeVisible({ timeout: 15_000 }); // refreshed list
    await expect(versions.getByText('PRIMARY', { exact: true })).toBeVisible();

    // Publish for real → LIVE pill + the live sentence.
    await submitAndWait(page, 'Publish');
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`Live on /projects/${SLUG}.`)).toBeVisible();
    await shoot(page, 'admin-project-exclusive');

    // The public page (ISR — retry until the revalidated entry serves): badge, sha512, DETAILS.
    // The retry must ALSO prove the GET IT href answers 302 — `.next` persists across local
    // runs, and a stale copy from a previous run satisfies badge/title while carrying a file id
    // whose row is gone (404); only the revalidated render's href resolves.
    const getIt = page.locator(`aside[aria-labelledby="get-it-${SLUG}"]`);
    await expect(async () => {
      const response = await page.goto(`/projects/${SLUG}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE, { timeout: 1_000 });
      await expect(page.getByText('ONLY ON ODSENS').first()).toBeVisible({ timeout: 500 });
      const freshHref =
        (await getIt.locator('a[data-variant="primary"]').getAttribute('href')) ?? '';
      expect(freshHref).toMatch(/^\/api\/download\/[0-9a-f-]{36}$/);
      const probe = await page.request.get(freshHref, { maxRedirects: 0 });
      expect(probe.status()).toBe(302);
    }).toPass({ timeout: 20_000, intervals: [400, 800, 1_600] });
    // sha512 stored and displayed in the GET IT file meta, full 128-hex value (00 S1.3.AC3).
    await expect(getIt.locator('p').filter({ hasText: 'sha512' })).toHaveText(
      /^sha512 [0-9a-f]{128}$/,
    );
    // DetailsList Source for exclusives (02 §2.3).
    await expect(
      page.locator('section[aria-labelledby="details-title"]').getByText('Only on odsens'),
    ).toBeVisible();

    // GET IT primary → /api/download/<file id>; the route answers 302 with a 60 s signed URL
    // (`token`) and `download=<filename>` Content-Disposition rider (04 §2.3 D5/D6).
    const primary = getIt.locator('a[data-variant="primary"]');
    // Label case follows the shipped S1.2 GetItPanel convention ("Download", VersionsTable's
    // word — 03 §2.3; the uppercase DOWNLOAD belongs to the hero's gold button).
    await expect(primary).toContainText(/download/i);
    const href = (await primary.getAttribute('href')) ?? '';
    expect(href).toMatch(/^\/api\/download\/[0-9a-f-]{36}$/);
    const download = await page.request.get(href, { maxRedirects: 0 });
    expect(download.status()).toBe(302);
    const location = download.headers()['location'] ?? '';
    expect(location).toContain('token=');
    expect(location).toContain('download=pack.zip');
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-35 — moderator pass: everything present but disabled ("Admin only") — 03 §2.10
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-35 moderator: create form + exclusive editor controls disabled ("Admin only"), never hidden', async ({
    page,
  }) => {
    await loginAs(page, 'mod');

    // /admin/projects/new: the whole form renders disabled; the submit sits under the title wrap.
    await page.goto('/admin/projects/new');
    for (const label of ['Slug', 'Title', 'Description', 'Type', 'Loaders', 'Game versions']) {
      await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
    }
    const create = page.getByRole('button', { name: 'Create draft', exact: true });
    await expect(create).toBeDisabled();
    expect(await create.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(true);

    // The exclusive editor (readable: the project is LIVE — a draft would 404 for mod, T-RLS-18).
    await page.goto(`/admin/projects/${projectId()}`);
    const { details, versions } = sections(page);
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

    // PUBLISH: Hide + Back to draft disabled under the title wrap; comments Toggle disabled.
    for (const name of ['Hide', 'Back to draft']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeDisabled();
      expect(await button.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(true);
    }
    await expect(page.locator(`input[aria-label="Comments on ${TITLE}"]`)).toBeDisabled();

    // DETAILS: fields + Save disabled (scoped — 'Game versions'/'Loaders' repeat in the file well).
    for (const label of ['Slug', 'Title', 'Description', 'Loaders', 'Game versions']) {
      await expect(details.getByLabel(label, { exact: true })).toBeDisabled();
    }
    const save = details.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();
    expect(await save.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(true);

    // Wells (icon, gallery, file): inert but present — aria-disabled + title, inputs disabled.
    const wells = page.locator('[data-state][aria-disabled="true"][title="Admin only"]');
    await expect(wells).toHaveCount(3);
    const fileInputs = page.locator('input[type="file"]');
    await expect(fileInputs).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      await expect(fileInputs.nth(i)).toBeDisabled();
    }

    // ProjectFileWell version fields ride the same flag.
    for (const label of ['Version number', 'Game versions', 'Loaders', 'Changelog']) {
      await expect(versions.getByLabel(label, { exact: true })).toBeDisabled();
    }
    await expect(toggleFor(page, 'Primary file').input).toBeDisabled();
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-35 — back to draft THROUGH the action, so the public ISR caches repair (05 H-1 spirit)
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-35 back to draft: unpublish through publishProject — public list and detail repair', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto(`/admin/projects/${projectId()}`);

    await submitAndWait(page, 'Back to draft');
    await expect(page.getByText('DRAFT', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('This project is a draft. Nobody sees it.')).toBeVisible();

    // revalidateTag('projects') covered list + detail: seed truth restored for later suites/runs.
    await expectAtUrl(page, '/projects', async () => {
      await expect(page.locator('article')).toHaveCount(3, { timeout: 1_000 });
      await expect(page.getByText('3 things. Some useful, some not.')).toBeVisible({
        timeout: 500,
      });
    });
    // The detail URL streams the root 404 shell (status stays 200 — ADR-0025 interim tolerance,
    // see tests/e2e/smoke/shells.spec.ts; the body is the binding assertion).
    await expectAtUrl(page, `/projects/${SLUG}`, async () => {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        /that page doesn[’']t exist/i,
        {
          timeout: 1_000,
        },
      );
    });
  });
});

/**
 * T-E2E-36 (05 §7.5; 00 S1.4.AC14; 02 §1.3 `/admin/comments`; DESIGN.md §5 Admin table, §11.1 Mod
 * action row; ADR-0028 D6): the moderation queue as `seed_mod` — every action on this page is a
 * moderator action, so nothing here is "Admin only" (02 §1.3 auth rule; unlike `/admin/projects`).
 * Held `…0203` first (HELD gold-wash pill + FIRST COMMENT), the reported hidden `…0204` ("1 report");
 * Approve (the row's one filled accent, emerald) → LIVE + the sidebar held count 1 → 0 (the leaf's
 * `router.refresh()` re-renders the layout); Hide → HIDDEN, Unhide → LIVE, Ban user (danger text,
 * inline confirm in plain words) and Rename handle (`Field` + neutral confirm → `renameUserHandle`,
 * asserted via the service client) all on a FACTORY user's comment. `mutatesSeed`: `…0203` goes
 * back to held (+ `moderated_*` NULL, seed_user2 `comment_count` 0) in `afterAll`, the factory rows
 * leave, `notification_events` is emptied (SEED-12), and the `project:pixel-chameleon` ISR entry the
 * approve/hide/unhide regenerated is repaired last through one more revalidating action
 * (`repairThreadCache` — FLK-4).
 */
test.describe('moderation queue (T-E2E-36)', () => {
  const HELD_TEXT = 'first comment here, the tail is great';
  const REPORTED_TEXT = 'cheap diamonds at totally-legit.example';
  const EMERALD = 'rgb(23, 185, 79)'; // --emerald #17b94f
  const DANGER = 'rgb(240, 131, 107)'; // --danger #f0836b
  const RUN = Math.random().toString(36).slice(2, 8);
  const BODY = `t_${RUN} queue row from e2e`;

  let userId = '';
  let handle = '';
  let commentId = '';

  test.beforeAll(async () => {
    loadEnvTest();
    userId = await makeUser();
    handle = (await readProfile(userId))?.handle ?? '';
    expect(handle).toMatch(/^t_/);
    commentId = await makeComment({ author_id: userId, body: BODY });
  });

  test.afterAll(async ({ browser }) => {
    await restoreSeedHeldComment();
    await cleanupFactories();
    await deleteNonSeedComments();
    await restoreSeedCommentCounts();
    await purgeNotificationEvents();
    await repairThreadCache(browser, {
      path: '/projects/pixel-chameleon',
      rootText: 'The chameleon blends into my kitchen floor. Ten out of ten.',
      expectedTotal: 3,
    });
    await service().from('rate_limit_hits').delete().eq('key', SEED_USERS.seed_user);
  });

  function service() {
    return loose(asRole('service'));
  }

  /** Toast slabs inside the `ToastProvider` region. */
  function toast(page: Page, text: string) {
    return page
      .locator('[role="status"][aria-live="polite"] div[data-state]')
      .filter({ hasText: text });
  }

  test('T-E2E-36 /admin/comments as mod: HELD + FIRST COMMENT first, "1 report" on the reported row; Approve → LIVE + sidebar 1 → 0; Hide → HIDDEN; Unhide → LIVE; Ban user inline confirm; Rename handle', async ({
    page,
  }) => {
    await loginAs(page, 'mod');
    await page.goto('/admin/comments');
    await expect(page).toHaveTitle('Comments · Admin');
    const table = page.locator('table', { has: page.getByText('Moderation queue') });
    const rows = table.locator('tbody tr');
    const heldRow = rows.filter({ hasText: HELD_TEXT });
    const reportedRow = rows.filter({ hasText: REPORTED_TEXT });
    const row = rows.filter({ hasText: BODY });
    const sidebar = page.locator('nav[aria-label="Admin"] a[href="/admin/comments"]');

    // Order + pills: held first (HELD + FIRST COMMENT), then the reported hidden row ("1 report").
    await expect(rows.first()).toContainText(HELD_TEXT);
    await expect(heldRow.getByText('HELD', { exact: true })).toBeVisible();
    await expect(heldRow.getByText('FIRST COMMENT', { exact: true })).toBeVisible();
    await expect(rows.nth(1)).toContainText(REPORTED_TEXT);
    await expect(reportedRow.getByText('HIDDEN', { exact: true })).toBeVisible();
    await expect(reportedRow.getByText('1 report', { exact: true })).toBeVisible();
    await expect(reportedRow.getByRole('button', { name: 'Unhide', exact: true })).toBeVisible();
    await expect(row.getByText('LIVE', { exact: true })).toBeVisible();
    await expect(row).toContainText(`@${handle}`);
    await expect(row.getByRole('link', { name: 'Pixel Chameleon' })).toHaveAttribute(
      'href',
      '/projects/pixel-chameleon#comments',
    );
    await expect(page.getByText('Admin only')).toHaveCount(0);
    await expect(sidebar).toHaveText(/Comments\s*1\s*held/);

    // Approve (filled emerald — the one accent) → LIVE; the held count in the sidebar drops to 0.
    const approve = heldRow.getByRole('button', { name: 'Approve' });
    expect(await approve.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(EMERALD);
    await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0); // never on LIVE
    await approve.click();
    await expect(toast(page, 'Approved.')).toBeVisible();
    await expect(heldRow.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(heldRow.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(sidebar).toHaveText(/Comments\s*0\s*held/);
    expect(await readCommentRow(SEED_COMMENTS.held)).toMatchObject({
      status: 'published',
      moderated_by: SEED_USERS.seed_mod,
    });

    // Hide → HIDDEN; Unhide → LIVE (the factory row).
    await row.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(toast(page, 'Hidden.')).toBeVisible();
    await expect(row.getByText('HIDDEN', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(row.getByRole('button', { name: 'Hide', exact: true })).toHaveCount(0);
    expect((await readCommentRow(commentId))?.status).toBe('hidden');
    await row.getByRole('button', { name: 'Unhide', exact: true }).click();
    await expect(row.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(row.getByRole('button', { name: 'Unhide', exact: true })).toHaveCount(0);
    expect((await readCommentRow(commentId))?.status).toBe('published');

    // Ban user: danger text, asks once inline in plain words and says where to undo.
    const ban = row.getByRole('button', { name: 'Ban user' });
    await expect.poll(() => ban.evaluate((el) => getComputedStyle(el).color)).toBe(DANGER);
    await ban.click();
    const banStrip = row.getByRole('group', {
      name: `Ban @${handle}? They can't comment anywhere. Undo in Admin → Comments.`,
    });
    await expect(banStrip).toBeVisible();
    await expect(banStrip.getByRole('button', { name: 'Keep' })).toBeFocused();
    await expect(page.locator('dialog')).toHaveCount(0);
    await banStrip.getByRole('button', { name: 'Ban', exact: true }).click();
    await expect(toast(page, 'Banned.')).toBeVisible();
    await expect.poll(async () => (await readProfile(userId))?.is_banned).toBe(true);

    // Rename handle: Field + neutral confirm → renameUserHandle (00 S1.4.AC14; 05 T-ACT-67).
    const next = freeHandle();
    await row.getByRole('button', { name: 'Rename handle' }).click();
    await row.getByLabel('New handle').fill(next);
    await row.getByRole('button', { name: 'Rename', exact: true }).click();
    const renameStrip = row.getByRole('group', { name: `Rename @${handle} to @${next}?` });
    await expect(renameStrip).toBeVisible();
    await renameStrip.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(row).toContainText(`@${next}`, { timeout: 10_000 });
    await expect(row).not.toContainText(`@${handle}`);
    expect((await readProfile(userId))?.handle).toBe(next);
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
  });
});

/**
 * T-E2E-37 (05 §7.5; 00 S1.5.AC1/AC2/AC3/AC4/AC11; 02 §2.8; DESIGN.md §11.1 Square toggle /
 * Toast, §11.3 #15, §12.1 Notification matrix, §12.7 #43; 03 §2.10 `NotificationMatrix`;
 * ADR-0030 D5 / D8): the whole `/admin/settings` page as `oddsense`. Lives in THIS file for the
 * T-E2E-35 reason (the `admin` project is serial only within a file; these writes must never race
 * the flows above). Legs:
 *  - Moderation: square radios (one filled, worded ON/OFF, consequence lines), `moderation_mode`
 *    round trip, the `comments_closed_default` switch (label + helper per DESIGN.md §12.7 #43).
 *  - Grid: rows New comment · Held for review · Reported · Sync failed / stale + the three greyed
 *    COMING LATER rows (`aria-disabled`, disabled toggles at their seeded values), columns EMAIL ·
 *    DISCORD; toggle `comment.new` × EMAIL OFF → SAVE SETTINGS → toast "Saved." → reload persists →
 *    restore; the shared sync row writes BOTH kinds (00 S1.5 "one row toggles both").
 *  - Webhook (00 S1.5.AC3): never pre-filled; Test with nothing stored → the validation line; Test
 *    with `…/webhooks/123/testtoken` → `✔ Sent a test.` (the :4010 fixture server's POST route,
 *    ADR-0030 D8; the adapter rewrites discord.com → `DISCORD_API_BASE`); SAVE → placeholder
 *    `…oken` (last 4) and the raw token is absent from EVERY response body captured from the save
 *    onwards (`page.on('response')`); Test with nothing typed uses the stored URL; unknown id
 *    `…/webhooks/0/nope` → `✕ Discord said no: 404`; Remove → SAVE → cleared.
 *  - Admin emails (00 S1.5.AC4): the add field is empty on a fresh page; add
 *    `seed-admin@localhost.test` (Enter) → chip; duplicate ignored; bad shape → inline line, no
 *    POST; SAVE → reload → chip present → remove → SAVE → gone; helper lines present.
 *  - Moderators (00 S1.5.AC11): `@oddsense` Admin with "That's you" and no Remove; `@seed_mod`
 *    Mod with Remove; unknown handle → inline "That account doesn't exist." on the field; add
 *    `seed_user` → a Mod row (`setUserRole` + PRG) → Remove → gone (role `user` again).
 *  - Ko-fi: `NOT SET` pill + "Arrives with Phase 2."; `Page name` round trip on `kofi_page`.
 * `mutatesSeed`: `afterAll` restores SEED-1 + SEED-2 through the service client
 * (`restoreSeedSettings()`), puts `seed_user` back to `user`, and forgets the `discord_test`
 * rate-limit hits (05 H-1).
 */
test.describe('admin settings (T-E2E-37)', () => {
  const WEBHOOK_OK = 'https://discord.com/api/webhooks/123/testtoken';
  const WEBHOOK_404 = 'https://discord.com/api/webhooks/0/nope';
  const TOKEN = 'testtoken';
  const WEBHOOK_PLACEHOLDER = 'https://discord.com/api/webhooks/…';
  const ADMIN_EMAIL = 'seed-admin@localhost.test';
  const TEST_OK = '✔ Sent a test.';

  test.beforeAll(async () => {
    loadEnvTest();
  });

  test.afterAll(async () => {
    const service = loose(asRole('service'));
    await restoreSeedSettings();
    await service.from('profiles').update({ role: 'user' }).eq('id', SEED_USERS.seed_user);
    await service.from('rate_limit_hits').delete().eq('scope', 'discord_test');
  });

  function service() {
    return loose(asRole('service'));
  }

  /** Toast slabs inside the `ToastProvider` region (the island's own status line is a <p>). */
  function toast(page: Page, text: string) {
    return page
      .locator('[role="status"][aria-live="polite"] div[data-state]')
      .filter({ hasText: text });
  }

  function saveButton(page: Page) {
    return page.getByRole('button', { name: 'SAVE SETTINGS', exact: true });
  }

  /**
   * SAVE SETTINGS → the server-action POST round trip (the binding wait — a previous save's toast
   * can still be on screen and a pending SAVE is disabled too, so neither alone proves the write
   * landed) → the "Saved." toast → SAVE disarms again (the snapshot caught up).
   */
  async function saveAndWait(page: Page): Promise<void> {
    const save = saveButton(page);
    await expect(save).toBeEnabled();
    const post = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/admin/settings'),
    );
    await save.click();
    await post;
    await expect(toast(page, 'Saved.')).toBeVisible({ timeout: 15_000 });
    await expect(save).toBeDisabled();
  }

  function grid(page: Page) {
    return page
      .locator('table')
      .filter({ has: page.locator('caption', { hasText: 'What it picks up' }) });
  }

  function notifications(page: Page) {
    return page.locator('section', {
      has: page.getByRole('heading', { name: 'NOTIFICATIONS', exact: true }),
    });
  }

  /** The island's inline Test result line (`role="status"`, never a toast). */
  function testLine(page: Page) {
    return notifications(page).locator('p[role="status"]');
  }

  async function readSettings() {
    const row = await service()
      .from('site_settings')
      .select(
        'moderation_mode, admin_notify_emails, discord_webhook_url, kofi_page, comments_closed_default',
      )
      .eq('id', 1)
      .single();
    expect(row.error).toBeNull();
    return row.data as {
      moderation_mode: string;
      admin_notify_emails: string[];
      discord_webhook_url: string | null;
      kofi_page: string | null;
      comments_closed_default: boolean;
    };
  }

  async function readCell(kind: string, channel: string): Promise<boolean> {
    const row = await service()
      .from('notification_matrix')
      .select('enabled')
      .eq('kind', kind)
      .eq('channel', channel)
      .single();
    expect(row.error).toBeNull();
    return (row.data as { enabled: boolean }).enabled;
  }

  // ---------------------------------------------------------------------------------------------
  // T-E2E-37 — moderation radios + comments_closed_default + the grid (toggle, save, persist)
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-37 moderation radios + consequence lines; grid rows + COMING LATER; comment.new email OFF → SAVE → Saved. → reload persists → restore; sync row writes both kinds', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/settings');
    await expect(page).toHaveTitle('Settings · Admin');
    const save = saveButton(page);
    await expect(save).toBeDisabled(); // nothing dirty yet (02 §2.8)

    // Moderation: two square radios, one filled (SEED-1 `auto`), worded ON/OFF + consequence lines.
    const hold = toggleFor(page, 'Hold first-time commenters');
    const auto = toggleFor(page, 'Auto-publish signed-in users');
    await expect(auto.input).toHaveAttribute('type', 'radio');
    await expect(auto.input).toBeChecked();
    await expect(hold.input).not.toBeChecked();
    await expect(auto.label).toContainText('ON');
    await expect(hold.label).toContainText('OFF');
    await expect(
      page.getByText('Their first comment waits for you. Everything after posts straight away.'),
    ).toBeVisible();
    await expect(page.getByText('Everything posts immediately. You clean up after.')).toBeVisible();
    const closed = toggleFor(page, 'Comments off by default on new projects');
    await expect(closed.input).not.toBeChecked();
    await expect(page.getByText('Existing projects keep their own setting.')).toBeVisible();

    // The grid: seven rows in DESIGN.md §12.1 order, EMAIL · DISCORD columns, seeded values.
    const table = grid(page);
    await expect(table.locator('thead th')).toHaveText(['Event', 'EMAIL', 'DISCORD']);
    await expect(table.locator('tbody tr')).toHaveCount(7);
    await expect(table.locator('tbody tr th')).toContainText([
      'New comment',
      'Held for review',
      'Reported',
      'Sync failed / stale',
      'Suggested mention',
      'New order',
      'New tip',
    ]);
    const later = table.locator('tbody tr[aria-disabled="true"]');
    await expect(later).toHaveCount(3);
    await expect(table.getByText('COMING LATER', { exact: true })).toHaveCount(3);
    const laterInputs = later.locator('input');
    await expect(laterInputs).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) await expect(laterInputs.nth(i)).toBeDisabled();
    const seeded: [string, boolean][] = [
      ['New comment by email', true],
      ['New comment by discord', true],
      ['Held for review by email', true],
      ['Held for review by discord', true],
      ['Reported by email', true],
      ['Reported by discord', true],
      ['Sync failed / stale by email', true],
      ['Sync failed / stale by discord', false],
      ['Suggested mention by email', false],
      ['Suggested mention by discord', true],
      ['New order by email', true],
      ['New order by discord', true],
      ['New tip by email', false],
      ['New tip by discord', true],
    ];
    for (const [label, on] of seeded) {
      const { input, label: wrapper } = toggleFor(page, label);
      if (on) await expect(input, label).toBeChecked();
      else await expect(input, label).not.toBeChecked();
      await expect(wrapper, label).toContainText(on ? 'ON' : 'OFF');
    }
    await expect(
      page.getByText(
        'The allay works for admins only — commenters never get mail. Deliveries arrive from allay@odsens.com.',
      ),
    ).toBeVisible();

    // comment.new × EMAIL OFF → SAVE → "Saved." → reload persists (00 S1.5.AC2/AC6).
    const cell = toggleFor(page, 'New comment by email');
    await cell.label.click();
    await expect(cell.input).not.toBeChecked();
    await expect(cell.label).toContainText('OFF');
    await saveAndWait(page);
    expect(await readCell('comment.new', 'email')).toBe(false);
    expect(await readCell('comment.new', 'discord')).toBe(true); // untouched cell untouched
    await page.reload();
    await expect(toggleFor(page, 'New comment by email').input).not.toBeChecked();

    // Restore through the same control.
    await toggleFor(page, 'New comment by email').label.click();
    await saveAndWait(page);
    expect(await readCell('comment.new', 'email')).toBe(true);
    await page.reload();
    await expect(toggleFor(page, 'New comment by email').input).toBeChecked();

    // The shared Sync failed / stale row writes BOTH kinds (00 S1.5; `expandSyncRow`).
    const sync = toggleFor(page, 'Sync failed / stale by discord');
    await sync.label.click();
    await expect(sync.input).toBeChecked();
    await saveAndWait(page);
    expect(await readCell('sync.failed', 'discord')).toBe(true);
    expect(await readCell('sync.stale', 'discord')).toBe(true);
    await toggleFor(page, 'Sync failed / stale by discord').label.click();
    await saveAndWait(page);
    expect(await readCell('sync.failed', 'discord')).toBe(false);
    expect(await readCell('sync.stale', 'discord')).toBe(false);

    // Moderation mode + comments_closed_default round trip (00 S1.5.AC11; DESIGN.md §12.7 #43).
    await hold.label.click();
    await expect(hold.input).toBeChecked();
    await expect(auto.input).not.toBeChecked();
    await closed.label.click();
    await expect(closed.input).toBeChecked();
    await saveAndWait(page);
    expect(await readSettings()).toMatchObject({
      moderation_mode: 'hold_first_time',
      comments_closed_default: true,
    });
    await page.reload();
    await expect(toggleFor(page, 'Hold first-time commenters').input).toBeChecked();
    await expect(toggleFor(page, 'Comments off by default on new projects').input).toBeChecked();
    await toggleFor(page, 'Auto-publish signed-in users').label.click();
    await toggleFor(page, 'Comments off by default on new projects').label.click();
    await saveAndWait(page);
    expect(await readSettings()).toMatchObject({
      moderation_mode: 'auto',
      comments_closed_default: false,
    });
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-37 — Discord webhook: Test against the fixture server, masked after save, never echoed
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-37 webhook: never pre-filled; Test → ✔ Sent a test.; SAVE → …oken placeholder, token absent from every response body; unknown id → ✕ Discord said no: 404; mistyped URL → plain words; Remove → SAVE', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/settings');
    const field = page.getByLabel('Discord webhook URL');
    const line = testLine(page);
    const test = page.getByRole('button', { name: 'Test', exact: true });
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', WEBHOOK_PLACEHOLDER);
    await expect(page.getByText('Masked after save.')).toBeVisible();

    // Nothing typed, nothing stored → the action's validation line, inline (never a toast).
    await test.click();
    await expect(line).toHaveText('✕ Add a webhook URL first.', { timeout: 15_000 });
    await expect(toast(page, 'Discord')).toHaveCount(0);

    // Typed → the fixture server's POST /discord/webhooks/123/<token> → 200 → ✔.
    await field.fill(WEBHOOK_OK);
    await test.click();
    await expect(line).toHaveText(TEST_OK, { timeout: 15_000 });

    // From here every response body is captured: the raw URL must never come back (00 S1.5.AC3).
    const bodies: string[] = [];
    page.on('response', (response) => {
      const type = response.headers()['content-type'] ?? '';
      if (/image|font|octet-stream|woff/.test(type)) return;
      response
        .text()
        .then((text) => {
          bodies.push(text);
        })
        .catch(() => {
          /* redirects / aborted bodies carry nothing */
        });
    });
    await saveAndWait(page);
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', '…oken');
    expect((await readSettings()).discord_webhook_url).toBe(WEBHOOK_OK);
    await page.reload();
    await expect(page.getByLabel('Discord webhook URL')).toHaveAttribute('placeholder', '…oken');
    await expect(page.getByLabel('Discord webhook URL')).toHaveValue('');
    await expect(notifications(page).getByRole('button', { name: 'Remove' })).toBeVisible();
    // The save POST, the `router.refresh()` RSC payload and the reload document are all settled
    // by the assertions above; give their `text()` promises a beat (no `networkidle` — the built
    // app keeps a request open, so that state never arrives deterministically).
    await expect.poll(() => bodies.length).toBeGreaterThan(2);
    await page.waitForTimeout(500);
    expect(
      bodies.some((body) => body.includes(TOKEN)),
      'the webhook token never appears in a response body',
    ).toBe(false);

    // Nothing typed now → Test uses the STORED URL (04 §1.3 "input ?? stored").
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(testLine(page)).toHaveText(TEST_OK, { timeout: 15_000 });

    // Unknown webhook id → the fixture server's 404 → the plain reason (ADR-0030 D8).
    await page.getByLabel('Discord webhook URL').fill(WEBHOOK_404);
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(testLine(page)).toHaveText('✕ Discord said no: 404', { timeout: 15_000 });

    // A URL outside the 04 §1.3 regex fails the action's schema → the line carries the schema's
    // plain words (first issue, 04 SC-03), never runAction's generic "Check the form." (03 C-30).
    await page.getByLabel('Discord webhook URL').fill('https://example.com/api/webhooks/1/nope');
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(testLine(page)).toHaveText("✕ That doesn't look like a Discord webhook URL.", {
      timeout: 15_000,
    });

    // Remove → sends '' (clear) on SAVE → placeholder back to the bare hint, row NULL.
    await notifications(page).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByLabel('Discord webhook URL')).toHaveAttribute(
      'placeholder',
      WEBHOOK_PLACEHOLDER,
    );
    await saveAndWait(page);
    expect((await readSettings()).discord_webhook_url).toBeNull();
    await page.reload();
    await expect(page.getByLabel('Discord webhook URL')).toHaveAttribute(
      'placeholder',
      WEBHOOK_PLACEHOLDER,
    );
    await expect(notifications(page).getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-37 — admin emails as chips: never pre-filled, add / remove, persisted
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-37 admin emails: field never pre-filled; add chip → SAVE → reload → present → remove → SAVE → gone; duplicate ignored; bad shape inline', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/settings');
    const add = page.getByLabel('Add an admin email');
    const chip = page.getByRole('button', { name: `Remove ${ADMIN_EMAIL}` });
    await expect(add).toHaveValue(''); // the signed-in Google email is never pre-filled (AC4)
    await expect(page.getByRole('button', { name: /^Remove .+@localhost\.test$/ })).toHaveCount(0); // SEED-1 []
    await expect(
      page.getByText('Only what’s typed here. Google emails are never reused silently.'),
    ).toBeVisible();

    // Enter adds a chip; the field clears; a duplicate is ignored; a bad shape stays inline.
    await add.fill(ADMIN_EMAIL);
    await add.press('Enter');
    await expect(chip).toBeVisible();
    await expect(add).toHaveValue('');
    await add.fill(ADMIN_EMAIL.toUpperCase());
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(chip).toHaveCount(1);
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });
    await add.fill('nope');
    await add.press('Enter');
    await expect(page.getByText('That doesn’t look like an email address.')).toBeVisible();
    expect(posts, 'the shape check issues no server-action POST').toEqual([]);
    await add.fill('');

    await saveAndWait(page);
    expect((await readSettings()).admin_notify_emails).toEqual([ADMIN_EMAIL]);
    await page.reload();
    await expect(page.getByRole('button', { name: `Remove ${ADMIN_EMAIL}` })).toBeVisible();
    await expect(page.getByLabel('Add an admin email')).toHaveValue('');

    // Remove → SAVE → gone.
    await page.getByRole('button', { name: `Remove ${ADMIN_EMAIL}` }).click();
    await expect(page.getByRole('button', { name: /^Remove .+@localhost\.test$/ })).toHaveCount(0);
    await saveAndWait(page);
    expect((await readSettings()).admin_notify_emails).toEqual([]);
    await page.reload();
    await expect(page.getByRole('button', { name: /^Remove .+@localhost\.test$/ })).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-37 — Moderators table (setUserRole + PRG) and the Ko-fi section
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-37 moderators: own row "That\'s you" without Remove; unknown handle inline; add seed_user → Mod → Remove → gone; Ko-fi NOT SET + page name round trip', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/settings');
    const table = page
      .locator('table')
      .filter({ has: page.locator('caption', { hasText: 'Moderators' }) });
    const rows = table.locator('tbody tr');
    const ownRow = rows.filter({ hasText: '@oddsense' });
    const modRow = rows.filter({ hasText: '@seed_mod' });
    await expect(rows.first()).toContainText('@oddsense'); // admins first
    await expect(ownRow).toContainText('Admin');
    await expect(ownRow).toContainText("That's you");
    await expect(ownRow.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(modRow).toContainText('Mod');
    await expect(modRow.getByRole('button', { name: 'Remove' })).toBeVisible();
    await expect(rows.filter({ hasText: '@seed_user' })).toHaveCount(0);

    // Unknown handle → PRG back with the message on the field (inline, aria-invalid — 03 C-30).
    const handle = page.getByLabel('Add by handle');
    await handle.fill('nobody_here_x');
    await page.getByRole('button', { name: 'Add mod', exact: true }).click();
    await page.waitForURL(/form=moderators/);
    const invalid = page.getByLabel('Add by handle');
    await expect(invalid).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('alert').filter({ hasText: "That account doesn't exist." }),
    ).toBeVisible();

    // Add seed_user (a typed `@` is stripped) → a Mod row appears; the profile row says so.
    await invalid.fill('@seed_user');
    await page.getByRole('button', { name: 'Add mod', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/admin/settings' && url.search === '');
    const userRow = rows.filter({ hasText: '@seed_user' });
    await expect(userRow).toContainText('Mod');
    expect((await readProfile(SEED_USERS.seed_user))?.role).toBe('moderator');

    // Remove → role user → the row leaves the table.
    await userRow.getByRole('button', { name: 'Remove' }).click();
    await expect(rows.filter({ hasText: '@seed_user' })).toHaveCount(0, { timeout: 15_000 });
    expect((await readProfile(SEED_USERS.seed_user))?.role).toBe('user');
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);

    // Ko-fi: NOT SET pill + the Phase 2 line; the page-name field round-trips `kofi_page`.
    await expect(page.getByText('NOT SET', { exact: true })).toBeVisible();
    await expect(page.getByText('Arrives with Phase 2.')).toBeVisible();
    const kofi = page.getByLabel('Page name');
    await expect(kofi).toHaveValue('oddsense'); // SEED-1
    await kofi.fill('oddsense-e2e');
    await saveAndWait(page);
    expect((await readSettings()).kofi_page).toBe('oddsense-e2e');
    await page.reload();
    await expect(page.getByLabel('Page name')).toHaveValue('oddsense-e2e');
    await page.getByLabel('Page name').fill('oddsense');
    await saveAndWait(page);
    expect((await readSettings()).kofi_page).toBe('oddsense');
  });
});
