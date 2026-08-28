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
import { fixturePath } from '../../helpers/fixtures';
import { loginAs } from '../../helpers/loginAs';
import { shoot } from '../../helpers/screenshots';
import { listObjects, removeObjects } from '../../helpers/storage';
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
    await page.goto('/admin/projects/new');

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
