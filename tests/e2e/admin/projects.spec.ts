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
 *  - S1.5a (same file, same reason — ADR-0037 D11): T-E2E-34 amended for the LISTINGS recipe
 *    (the CurseForge field's Link / Remove buttons; the seed CF listing 900001 is freed from
 *    pixel-chameleon via the service client for the MACE leg because
 *    `project_links_platform_external_id_key` allows one project per listing, and restored
 *    after); the `cross-posted projects` describe right after T-E2E-41 holds T-E2E-51 (the
 *    editor field on the seed exclusive), T-E2E-52 (the fold on test-created rows) and T-E2E-53
 *    (uploads on a Modrinth-first test row). Never folds a seed row.
 *  - S1.5c (same file, same reason — ADR-0039 D6 / ADR-0040): the editor renders ONE section at
 *    a time under `?section=`, so T-E2E-34/35/42/51/52/53/54 name the section they open
 *    (`general` · `description` · `gallery` · `versions` · `listings` · `publish`); the
 *    `editor v2` describe after T-E2E-54 holds T-E2E-55 (sections + the unsaved guard, both
 *    branches), T-E2E-56 (the Markdown editor: toolbar, shortcuts, Preview parity with the
 *    public page, stored value plain Markdown) and T-E2E-57 (phone chip row + toolbar wrap,
 *    axe at 1280 + 390 on every section as admin and moderator, screenshots per section).
 *  - S1.6 (same file, same reason — ADR-0043 D9 / D11): T-E2E-42's `/admin` leg now waits for the
 *    VIDEOS list (`Table`, Hidden + Short toggles) before axe + the shot, pristine seed first; the
 *    final describe holds T-E2E-47 — the moderator's disabled toggles (no POST), then the admin
 *    hides every visible video THROUGH the `/admin` Hidden toggles (`updateVideo` →
 *    `revalidateTag('videos')`), polls `/videos` and `/` to the §11.7 empty state, un-hides exactly
 *    those rows and polls both pages back. No service-side delete; the service client only
 *    repairs a failed run in `afterAll`.
 *  - S1.8 (same file, same reason — ADR-0045): T-E2E-42 gains the `/admin/mentions` leg — the
 *    Mentions view AND the Suggested stub, axe + shots at 1280 AND 390 (00 S1.8.AC12; ADR-0045
 *    D27), pristine seed first; the final describe holds T-E2E-39 — the moderator's disabled
 *    controls (no POST), then the admin pastes `https://www.youtube.com/watch?v=seedvid0009`
 *    (answered by the :4010 fixture server — ADR-0002 #73; the SSRF guard's DNS lookup of
 *    `www.youtube.com` is REAL, so an offline machine fails here — tests/fixtures/README.md),
 *    publishes it onto metal-pipe-mace, features / reorders (handle keys AND the Move buttons) /
 *    hides it, publishes a second mention by hand after an unreadable link, and polls `/`,
 *    `/seen-on` and `/projects/metal-pipe-mace` after every step. Every public effect is reached
 *    through the page's own actions (`createMention` / `updateMention` → `revalidateTag`); the
 *    two test rows are hidden THROUGH THE UI, the pages polled back to seed truth, and only then
 *    deleted with the service client (there is no delete action — 01 INV-24).
 *
 * Seed truths: SEED-4..6 (3 published projects; overrides featured 1 = pixel-chameleon,
 * 2 = seed-exclusive-pack; CF link 900001 on pixel-chameleon), SEED-12 (one ok run per source),
 * SEED-9 (the held `…0203` by seed_user2, the hidden + reported `…0204`), SEED-11 (7 videos:
 * `seedvid0002` hidden, `seedvid0003` the one Short, no overrides), SEED-10 (2 published mentions:
 * `…0301` YouTube `seedvid0001` on metal-pipe-mace, 1,200,000 views, featured, sort_order 1;
 * `…0302` TikTok about OddSense generally, no count, not featured; no `mentions` sync run).
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
  makeFile,
  makeProject,
  makeUser,
  makeVersion,
  purgeNotificationEvents,
  restoreSeedCommentCounts,
} from '../../helpers/factories';
import { fixturePath, loadFixture } from '../../helpers/fixtures';
import { loginAs, logout } from '../../helpers/loginAs';
import { shoot } from '../../helpers/screenshots';
import { listObjects, removeObjects } from '../../helpers/storage';
import {
  SEED_COMMENTS,
  SEED_MENTIONS,
  SEED_PROJECTS,
  SEED_USERS,
  SEED_VIDEOS,
} from '../../helpers/seedIds';
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

type ServiceClient = ReturnType<typeof loose>;

/** SEED-6: the CurseForge listing 900001 on pixel-chameleon (url = the fixture's websiteUrl). */
const SEED_CF_LINK = {
  project_id: PIXEL,
  platform: 'curseforge',
  external_id: '900001',
  url: 'https://www.curseforge.com/minecraft/mc-mods/pixel-chameleon',
  downloads: 120,
} as const;

/**
 * S1.5a: `project_links_platform_external_id_key` (ADR-0037 D1/D9) lets one project hold a
 * listing, and `mods/900001` is the only CurseForge id the fixture server answers — so a test
 * that links 900001 elsewhere parks the seed row first and puts it back after (service client;
 * `restoreContentTables` remains the byte-level safety net).
 */
async function freeSeedCurseforgeListing(service: ServiceClient): Promise<void> {
  const deleted = await service
    .from('project_links')
    .delete()
    .eq('project_id', PIXEL)
    .eq('platform', 'curseforge');
  expect(deleted.error).toBeNull();
}

async function restoreSeedCurseforgeListing(service: ServiceClient): Promise<void> {
  const restored = await service.from('project_links').upsert(
    { ...SEED_CF_LINK, synced_at: new Date().toISOString() },
    {
      onConflict: 'project_id,platform',
    },
  );
  expect(restored.error).toBeNull();
}

// ---------------------------------------------------------------------------------------------
// T-E2E-42 — a11y + screenshots, pristine seed state first
// ---------------------------------------------------------------------------------------------

test('T-E2E-42 admin routes: axe zero serious/critical + 1280 screenshots (/admin, /admin/projects, /admin/projects/[id]) + /admin/comments, /admin/settings and /admin/mentions (both views) at 1280 and 390', async ({
  page,
}) => {
  await loginAs(page, 'admin');

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'SYNC' })).toBeVisible();
  // S1.6 (05 T-E2E-42; ADR-0043 D11): checked and shot WITH the videos list — all 7 seed rows
  // (the admin reads the hidden one too), a Hidden and a Short toggle on each.
  const videoList = page.locator('section', {
    has: page.getByRole('heading', { level: 2, name: /^VIDEOS/ }),
  });
  await expect(videoList.locator('tbody tr')).toHaveCount(7);
  await expect(videoList.getByRole('switch')).toHaveCount(14);
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-dashboard');

  await page.goto('/admin/projects');
  await expect(page.getByRole('heading', { name: 'ALL PROJECTS' })).toBeVisible();
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-projects');

  // S1.5c (ADR-0039 D2): the editor opens on `?section=general`; every section is shot in T-E2E-57.
  await page.goto(`/admin/projects/${PIXEL}?section=general`);
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

  // S1.8: the mentions page — desktop AND phone (00 S1.8.AC12; ADR-0045 D27), seed state: the
  // empty "Add a mention" island, one featured row in FEATURED ORDER, two table rows.
  await page.goto('/admin/mentions');
  await expect(page).toHaveTitle('Mentions · Admin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mentions');
  await expect(page.getByRole('region', { name: 'Add a mention' })).toHaveAttribute(
    'data-state',
    'empty',
  );
  const mentionList = page.locator('section', {
    has: page.getByRole('heading', { level: 2, name: /^ALL MENTIONS/ }),
  });
  await expect(mentionList.locator('tbody tr')).toHaveCount(2);
  await expect(mentionList.getByText('FEATURED', { exact: true })).toHaveCount(1);
  await expect(mentionList.getByText('LIVE', { exact: true })).toHaveCount(1);
  await expect(page.locator('ol[aria-label="Featured mentions"] li')).toHaveCount(1);
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-mentions');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 2, name: /^ALL MENTIONS/ })).toBeVisible();
  // The table scrolls inside its own wrapper — the page itself never scrolls sideways at 390.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-mentions');
  await page.setViewportSize({ width: 1280, height: 800 });

  // The Suggested view — the v1.5 stub (00 S1.8.AC10), both widths.
  await page.goto('/admin/mentions?tab=suggested');
  await expect(page.getByRole('heading', { name: 'NOTHING SUGGESTED' })).toBeVisible();
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-mentions-suggested');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'NOTHING SUGGESTED' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expectNoSeriousA11y(page);
  await shoot(page, 'admin-mentions-suggested');
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

  // `[id]` curate view: fields, comments toggle, Save and the LISTINGS Link disabled the same way.
  // On a synced row the Modrinth field is read-only and has no buttons (ADR-0037 D8) — present,
  // disabled for a moderator like every other field, never hidden. S1.5c (ADR-0039 D2): the
  // editor renders one section at a time — the overrides + comments toggle + Save on
  // `?section=general`, the Notes editor on `?section=description`, the fields on
  // `?section=listings`.
  await page.goto(`/admin/projects/${MACE}?section=general`);
  await expect(page.getByLabel('Title override')).toBeDisabled();
  await expect(toggleFor(page, 'Comments on Metal Pipe Mace').input).toBeDisabled();
  const generalSave = page.getByRole('button', { name: 'Save', exact: true });
  await expect(generalSave).toBeDisabled();
  expect(await generalSave.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(
    true,
  );
  await page.goto(`/admin/projects/${MACE}?section=description`);
  await expect(page.getByLabel('Notes', { exact: true })).toBeDisabled();
  await page.goto(`/admin/projects/${MACE}?section=listings`);
  await expect(page.getByLabel('CurseForge id or URL')).toBeDisabled();
  const homeListing = page.getByLabel('Modrinth listing (URL, slug or id)');
  await expect(homeListing).toBeDisabled();
  await expect(homeListing).toHaveAttribute('readonly', '');
  await expect(homeListing).toHaveValue('https://modrinth.com/project/sd000101');
  await expect(
    page.getByText("Synced from Modrinth — this is the project's home listing."),
  ).toBeVisible();
  const link = page.getByRole('button', { name: 'Link', exact: true });
  await expect(link).toBeDisabled();
  expect(await link.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(true);
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// T-E2E-34 — admin curate pass (each mutation reverted through the same action)
// ---------------------------------------------------------------------------------------------

test('T-E2E-34 admin: feature/hide/reorder on the list, notes + CF id on [id] — with revalidated public pages', async ({
  page,
}) => {
  // Fourteen navigations with ISR re-checks (`expectAtUrl`): ~28 s on a green CI runner, so the
  // 30 s FLK-4 default has no headroom and a slower runner times out inside `submitAndWait`
  // (2026-09-11). Same per-test budget as T-E2E-24 in flows/comments.spec.ts.
  test.setTimeout(90_000);
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
  // S1.5c: the Notes live on `?section=description` as the `MarkdownEditor` (its textarea is the
  // labelled control); the PRG lands back on the same section (00 S1.5c.AC1).
  const NOTE = 'Bonk appreciation note.';
  await page.goto(`/admin/projects/${MACE}?section=description`);
  await page.getByLabel('Notes', { exact: true }).fill(NOTE);
  await submitAndWait(page, 'Save');
  await expect(page).toHaveURL(/section=description/);
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(NOTE); // PRG re-render shows stored value
  await expectAtUrl(page, '/projects/metal-pipe-mace', async () => {
    await expect(page.getByText(NOTE)).toBeVisible({ timeout: 1_000 });
  });

  // Revert: empty notes → null (the [id] form's orNull) — the note leaves the page.
  await page.goto(`/admin/projects/${MACE}?section=description`);
  await page.getByLabel('Notes', { exact: true }).fill('');
  await submitAndWait(page, 'Save');
  await expectAtUrl(page, '/projects/metal-pipe-mace', async () => {
    await expect(page.getByText(NOTE)).toHaveCount(0, { timeout: 1_000 });
  });

  // -- CF id entry (900001) → link row + downloads_curseforge set immediately (via service) ---
  // S1.5a: the CurseForge field is the LISTINGS recipe (ADR-0037 D8) — a Link button, then the
  // link's URL + count + a Remove button. The fixture server answers `mods/900001` only, and the
  // seed holds 900001 on pixel-chameleon (SEED-6) while `project_links_platform_external_id_key`
  // allows one project per listing — so the seed row is parked via the service client for this
  // leg and put back after (byte-level: `restoreContentTables` in afterAll is the safety net).
  await freeSeedCurseforgeListing(service);
  await page.goto(`/admin/projects/${MACE}?section=listings`);
  await expect(page.getByText('Empty removes the link')).toHaveCount(0);
  await expect(page.getByText('Digits or the project URL.')).toBeVisible();
  await page.getByLabel('CurseForge id or URL').fill('900001');
  await submitAndWait(page, 'Link');
  const cfLinked = page.locator(
    'a[href="https://www.curseforge.com/minecraft/mc-mods/pixel-chameleon"]',
  );
  await expect(cfLinked).toBeVisible();
  await expect(page.getByText('120 downloads', { exact: true })).toBeVisible();

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

  // Revert: Remove → `unlinkProjectListing` deletes the link and zeroes the count (ADR-0037 D1).
  await submitAndWait(page, 'Remove');
  await expect(cfLinked).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
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
  await restoreSeedCurseforgeListing(service);
  // The service write revalidates nothing: one no-op `curateProject` save repairs the ISR
  // entries that carry the `projects` tag (the T-E2E-41 precedent).
  await page.goto(`/admin/projects/${PIXEL}?section=general`);
  await submitAndWait(page, 'Save');
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
  await page.goto(`/admin/projects/${PIXEL}?section=general`);
  await submitAndWait(page, 'Save');
  await expectAtUrl(page, '/projects', async () => {
    await expect(page.locator('article')).toHaveCount(3, { timeout: 1_000 });
    await expect(page.getByText('3 things. Some useful, some not.')).toBeVisible({
      timeout: 500,
    });
  });
});

/**
 * S1.5a — cross-posted projects (ADR-0037 D11; 00 S1.5a.AC1/AC3/AC4/AC5/AC6/AC7/AC8). Lives in
 * THIS file for the same reason as T-E2E-35: the `admin` project is serial only within a file.
 * Never folds a seed row — T-E2E-52/53 fold and upload on FACTORY rows only.
 *
 *  - T-E2E-51: the LISTINGS field on the seed exclusive (…0103). The fixture listing `sd000199`
 *    (`tests/fixtures/modrinth/project/sd000199.json` — absent from the 18-project user list, so
 *    no sync run imports it) is linked through the field → link row + `formatCount(downloads)`
 *    shown; the ONLY ON ODSENS badge leaves the detail page, the `/projects` card and the `/`
 *    Featured card (the seed hero is pixel-chameleon — not touched); GET IT gains "Also on
 *    Modrinth <count>"; a CurseForge link (900001 — the seed row parked as in T-E2E-34) adds
 *    "Also on CurseForge 120" and the combined total = direct + modrinth + curseforge; "Sync now"
 *    writes no `projects` row for the listing (the link row survives, still on …0103); the
 *    `/admin/projects` match note (a draft synced twin created via the factory) opens the editor
 *    with the field prefilled and creates no link row; Remove → badge back everywhere;
 *    moderator: field, buttons and wells disabled "Admin only"; axe on the editor at 1280 + 390.
 *  - T-E2E-52: the fold. A factory `source='modrinth'` row for `sd000199` (two CDN versions +
 *    files, one comment) folded into a factory published exclusive by linking: the versions and
 *    the comment now hang on the canonical row, the duplicate row is gone, a `project_redirects`
 *    row maps the old slug, and the old URL lands on the canonical page (status ∈ {308, 200} —
 *    ADR-0025: the streamed ISR route may answer 200 + a client redirect; its `<title>`, both
 *    versions listed once each); `/admin/projects` and the sitemap no longer carry the duplicate.
 *  - T-E2E-53: uploads on a Modrinth-first factory row (published, visible): the Modrinth field
 *    is read-only (home helper, no Link / Remove of its own); icon + file through the real wells
 *    (two-phase, the T-E2E-35 pattern) — the file lands on the SYNCED `1.0.0` (D5(b): hosted
 *    first, CDN after) → `/projects/<slug>` GET IT primary hits `/api/download/<id>` with a 302
 *    and "Also on Modrinth" stays a row.
 *
 * Cleanup (05 H-1): every link is removed THROUGH `unlinkProjectListing` where the row survives;
 * factory rows leave via `cleanupFactories` (FK cascade takes versions/files/links/redirects/
 * overrides); Storage objects of T-E2E-53 are removed; the `project_link` / `upload:*` /
 * `download` rate-limit hits this block created are forgotten so local reruns within the hour
 * stay green; `restoreContentTables(snapshot)` is the byte-level safety net; one no-op
 * `curateProject` save repairs the ISR entries last (the T-E2E-41 precedent).
 */
test.describe('cross-posted projects (T-E2E-51/52/53)', () => {
  const EXCL = SEED_PROJECTS.seedExclusivePack;
  const EXCL_SLUG = 'seed-exclusive-pack';
  const EXCL_TITLE = 'Seed Exclusive Pack';
  const LISTING_ID = 'sd000199';
  const LISTING_URL = `https://modrinth.com/project/${LISTING_ID}`; // modrinthListingUrl(id)
  const LISTING_FIELD = 'Modrinth listing (URL, slug or id)';
  const CF_FIELD = 'CurseForge id or URL';
  const CF_URL = 'https://www.curseforge.com/minecraft/mc-mods/pixel-chameleon';
  /** The badge's full text — `getByText` is a case-insensitive substring match, and the seed
   *  exclusive's description says "lives only on odsens.com" (the T-E2E-4 locator shape). */
  const BADGE = 'Exclusive: ★ ONLY ON ODSENS';

  type Listing = { id: string; slug: string; title: string; downloads: number };
  let listing: Listing;

  test.beforeAll(async () => {
    loadEnvTest();
    listing = await loadFixture<Listing>('modrinth', `project/${LISTING_ID}.json`);
    expect(listing.id).toBe(LISTING_ID);
  });

  test.afterAll(async ({ browser }) => {
    const service = loose(asRole('service'));
    await cleanupFactories();
    await restoreSeedCommentCounts();
    await service.from('rate_limit_hits').delete().eq('scope', 'project_link');
    await service.from('rate_limit_hits').delete().like('scope', 'upload:%');
    await service.from('rate_limit_hits').delete().eq('scope', 'download');
    await restoreContentTables(snapshot);
    // Repair the public ISR entries after the service-side restore: one no-op `curateProject`
    // save revalidates the `projects` tag every S1.2 cache entry carries (the T-E2E-41
    // precedent), in a fresh admin context since afterAll has no page.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginAs(page, 'admin');
      await page.goto(`/admin/projects/${PIXEL}?section=general`);
      await submitAndWait(page, 'Save');
      await expectAtUrl(page, '/projects', async () => {
        await expect(page.locator('article')).toHaveCount(3, { timeout: 1_000 });
      });
    } finally {
      await context.close();
    }
  });

  function service() {
    return loose(asRole('service'));
  }

  /** `formatCount` for the 1K..1M range (the fixture's count) — `4300` → `4.3K`, `4000` → `4K`. */
  function compact(n: number): string {
    return `${String(Math.round(n / 100) / 10)}K`;
  }

  /** `formatCountFull` — the detail header's "12,431 DOWNLOADS" grouping (no `Intl` — 01 INV-68). */
  function grouped(n: number): string {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** The form that owns a LISTINGS field (each field is its own form — two Link buttons per page). */
  function listingForm(page: Page, label: string) {
    return page.locator('form', { has: page.getByLabel(label, { exact: true }) });
  }

  /** The linked row under a field: `<a href=url>` · `<n> downloads` · Remove — the form's sibling. */
  function linkedRow(page: Page, label: string) {
    return listingForm(page, label)
      .locator('..')
      .locator(':scope > div', { has: page.getByRole('button', { name: 'Remove', exact: true }) });
  }

  /** Clicks a button INSIDE `scope` and waits for the server-action POST round trip (PRG). */
  async function submitIn(page: Page, scope: ReturnType<Page['locator']>, name: string) {
    const post = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/admin/projects/'),
    );
    await scope.getByRole('button', { name, exact: true }).click();
    await post;
  }

  /** The `ProjectCard` for a slug on a list page (the badge sits inside the `<article>`). */
  function cardFor(page: Page, slug: string) {
    return page.locator('article', { has: page.locator(`a[href="/projects/${slug}"]`) });
  }

  async function linkRow(projectId: string, platform: 'modrinth' | 'curseforge') {
    const row = await service()
      .from('project_links')
      .select('project_id, external_id, url, downloads')
      .eq('project_id', projectId)
      .eq('platform', platform)
      .maybeSingle();
    expect(row.error).toBeNull();
    return row.data as {
      project_id: string;
      external_id: string;
      url: string;
      downloads: number;
    } | null;
  }

  async function downloads(projectId: string) {
    const row = await service()
      .from('projects')
      .select('downloads_modrinth, downloads_curseforge, downloads_direct')
      .eq('id', projectId)
      .single();
    expect(row.error).toBeNull();
    return row.data as {
      downloads_modrinth: number;
      downloads_curseforge: number;
      downloads_direct: number;
    };
  }

  // ---------------------------------------------------------------------------------------------
  // T-E2E-51 — the LISTINGS field on the seed exclusive: link, badge, GET IT rows, sync, match
  // note, remove
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-51 admin: link sd000199 on the seed exclusive → link row + count, badge gone (detail/card/featured), GET IT "Also on" rows + combined total, Sync now adds no row, match note prefills, Remove → badge back; axe 1280 + 390', async ({
    page,
  }) => {
    // ~20 navigations with ISR re-checks plus one real sync run (the T-E2E-34 budget rationale).
    test.setTimeout(150_000);
    const db = service();
    await loginAs(page, 'admin');

    // -- Pristine editor first: axe at 1280 and 390 (00 S1.5a.AC9's admin half) ---------------
    // S1.5c (ADR-0039 D2): the LISTINGS section is `?section=listings`; every editor navigation
    // in this describe names it (the PRG lands back on the same section — 00 S1.5c.AC1).
    const LISTINGS = `/admin/projects/${EXCL}?section=listings`;
    await page.goto(LISTINGS);
    await expect(page.getByRole('heading', { name: 'LISTINGS' })).toBeVisible();
    const modrinthForm = listingForm(page, LISTING_FIELD);
    const curseforgeForm = listingForm(page, CF_FIELD);
    await expect(modrinthForm.getByText('Versions arrive on the next sync.')).toBeVisible();
    await expect(curseforgeForm.getByText('Digits or the project URL.')).toBeVisible();
    await expect(page.getByText('Empty removes the link')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Link', exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    await expectNoSeriousA11y(page);
    await shoot(page, 'admin-project-listings');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(LISTINGS);
    await expect(page.getByRole('heading', { name: 'LISTINGS' })).toBeVisible();
    await expectNoSeriousA11y(page);
    await shoot(page, 'admin-project-listings');
    await page.setViewportSize({ width: 1280, height: 800 });

    // The seed truth: badge on the detail page, the /projects card and the / Featured card.
    await expectAtUrl(page, `/projects/${EXCL_SLUG}`, async () => {
      await expect(page.getByText(BADGE).first()).toBeVisible({ timeout: 1_000 });
    });

    // -- Match note (00 S1.5a.AC7): a DRAFT synced twin (never public, never folded) -----------
    const twinId = await makeProject({
      source: 'modrinth',
      external_id: LISTING_ID,
      slug: listing.slug,
      title: EXCL_TITLE, // the title leg of `projectMatchKey` (the slugs differ)
      project_type: 'datapack',
      status: 'draft',
    });
    await page.goto('/admin/projects');
    const twinRow = page.locator('tbody tr', { hasText: listing.slug });
    await expect(twinRow.getByText(`Looks like the same project as ${EXCL_TITLE}`)).toBeVisible();
    await twinRow.getByRole('link', { name: 'Link it', exact: true }).click();
    // The ghost link names the section that renders the field (ADR-0040 D8).
    await page.waitForURL(`**/admin/projects/${EXCL}?section=listings&listing=${LISTING_ID}`);
    await expect(page.getByLabel(LISTING_FIELD, { exact: true })).toHaveValue(LISTING_ID);
    expect(await linkRow(EXCL, 'modrinth'), 'nothing links automatically').toBeNull();
    // The twin leaves BEFORE the real link so the seed exclusive is never a fold target.
    const twinGone = await db.from('projects').delete().eq('id', twinId);
    expect(twinGone.error).toBeNull();

    // -- Link through the field (a Modrinth URL — 00 S1.5a.AC1) -------------------------------
    await page
      .getByLabel(LISTING_FIELD, { exact: true })
      .fill(`https://modrinth.com/datapack/${LISTING_ID}`);
    await submitIn(page, modrinthForm, 'Link');
    await expect(page).toHaveURL(LISTINGS); // PRG on the same section, no ?form= error
    const modrinthLinked = linkedRow(page, LISTING_FIELD);
    await expect(modrinthLinked.locator(`a[href="${LISTING_URL}"]`)).toHaveText(LISTING_URL);
    await expect(modrinthLinked.getByText(`${compact(listing.downloads)} downloads`)).toBeVisible();
    await expect(modrinthLinked.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    expect(await linkRow(EXCL, 'modrinth')).toMatchObject({
      external_id: LISTING_ID,
      url: LISTING_URL,
      downloads: listing.downloads,
    });
    expect((await downloads(EXCL)).downloads_modrinth).toBe(listing.downloads);

    // -- Badge gone (00 S1.5a.AC5) + GET IT "Also on Modrinth <count>" (AC6) ------------------
    const getIt = page.locator(`aside[aria-labelledby="get-it-${EXCL_SLUG}"]`);
    await expectAtUrl(page, `/projects/${EXCL_SLUG}`, async () => {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(EXCL_TITLE, {
        timeout: 1_000,
      });
      await expect(page.getByText(BADGE)).toHaveCount(0, { timeout: 500 });
      await expect(getIt.locator('a', { hasText: 'Also on Modrinth' })).toContainText(
        compact(listing.downloads),
        { timeout: 500 },
      );
    });
    // The primary stays the hosted file (ADR-0037 D6 — the hosted file is always the primary).
    expect(await getIt.locator('a[data-variant="primary"]').getAttribute('href')).toMatch(
      /^\/api\/download\/[0-9a-f-]{36}$/,
    );
    await expectAtUrl(page, '/projects', async () => {
      await expect(cardFor(page, EXCL_SLUG)).toHaveCount(1, { timeout: 1_000 });
      await expect(cardFor(page, EXCL_SLUG).getByText(BADGE)).toHaveCount(0, {
        timeout: 500,
      });
    });
    await expectAtUrl(page, '/', async () => {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pixel Chameleon', {
        timeout: 1_000,
      });
      await expect(cardFor(page, EXCL_SLUG)).toHaveCount(1, { timeout: 500 });
      await expect(cardFor(page, EXCL_SLUG).getByText(BADGE)).toHaveCount(0, {
        timeout: 500,
      });
    });

    // -- CurseForge too: "Also on CurseForge 120" + combined = direct + modrinth + curseforge --
    await freeSeedCurseforgeListing(db);
    await page.goto(LISTINGS);
    await page.getByLabel(CF_FIELD, { exact: true }).fill('900001');
    await submitIn(page, curseforgeForm, 'Link');
    await expect(page).toHaveURL(LISTINGS);
    const curseforgeLinked = linkedRow(page, CF_FIELD);
    await expect(curseforgeLinked.locator(`a[href="${CF_URL}"]`)).toBeVisible();
    await expect(curseforgeLinked.getByText('120 downloads', { exact: true })).toBeVisible();
    const counts = await downloads(EXCL);
    expect(counts).toMatchObject({
      downloads_modrinth: listing.downloads,
      downloads_curseforge: 120,
    });
    const total = counts.downloads_direct + counts.downloads_modrinth + counts.downloads_curseforge;
    await expectAtUrl(page, `/projects/${EXCL_SLUG}`, async () => {
      await expect(getIt.locator('a', { hasText: 'Also on CurseForge' })).toContainText('120', {
        timeout: 1_000,
      });
      await expect(getIt.locator('a', { hasText: 'Also on Modrinth' })).toContainText(
        compact(listing.downloads),
        { timeout: 500 },
      );
      // The combined line: compact total (05 T-E2E-3's shape) + the header's full count.
      await expect(getIt).toContainText(compact(total), { timeout: 500 });
      await expect(page.getByText(`${grouped(total)} DOWNLOADS`, { exact: true })).toBeVisible({
        timeout: 500,
      });
    });
    await page.goto(LISTINGS);
    await submitIn(page, curseforgeLinked, 'Remove');
    expect(await linkRow(EXCL, 'curseforge')).toBeNull();
    expect((await downloads(EXCL)).downloads_curseforge).toBe(0);
    await restoreSeedCurseforgeListing(db);

    // -- "Sync now" → no `projects` row for the listing; the link stays on the canonical ------
    // The run imports the other fixture projects (fixtures ⊇ seed, T-E2E-41); a snapshot taken
    // here — with the Modrinth link in place — is restored right after so the rest of the test
    // runs against seed + link only.
    const linkedSnapshot = await snapshotContentTables();
    await page.goto('/admin/projects');
    const modrinthRow = page.locator('tr', { hasText: 'Modrinth' });
    await modrinthRow.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText('Sync started.')).toBeVisible({ timeout: 30_000 });
    await expect(modrinthRow.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 15_000 });
    const latest = await db
      .from('sync_runs')
      .select('ok')
      .eq('source', 'modrinth')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();
    expect(latest.data?.ok).toBe(true);
    const imported = await db
      .from('projects')
      .select('id')
      .eq('source', 'modrinth')
      .eq('external_id', LISTING_ID);
    expect(imported.error).toBeNull();
    expect(imported.data, 'the sync never imports a linked listing as its own row').toEqual([]);
    expect(await linkRow(EXCL, 'modrinth')).toMatchObject({
      project_id: EXCL,
      external_id: LISTING_ID,
    });
    await restoreContentTables(linkedSnapshot);

    // -- Remove → link gone, count zeroed, badge back on detail + card (00 S1.5a.AC5) ----------
    await page.goto(LISTINGS);
    await submitIn(page, linkedRow(page, LISTING_FIELD), 'Remove');
    await expect(page).toHaveURL(LISTINGS);
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    expect(await linkRow(EXCL, 'modrinth')).toBeNull();
    expect((await downloads(EXCL)).downloads_modrinth).toBe(0);
    await expectAtUrl(page, `/projects/${EXCL_SLUG}`, async () => {
      await expect(page.getByText(BADGE).first()).toBeVisible({ timeout: 1_000 });
      await expect(getIt.locator('a', { hasText: 'Also on Modrinth' })).toHaveCount(0, {
        timeout: 500,
      });
    });
    await expectAtUrl(page, '/projects', async () => {
      await expect(cardFor(page, EXCL_SLUG).getByText(BADGE)).toBeVisible({
        timeout: 1_000,
      });
    });
    // … and on its `/` card (cards, hero and detail read the same `is_exclusive` column).
    await expectAtUrl(page, '/', async () => {
      await expect(cardFor(page, EXCL_SLUG).getByText(BADGE)).toBeVisible({
        timeout: 1_000,
      });
    });
  });

  test('T-E2E-51 moderator: the listing fields, Link buttons and upload wells on the seed exclusive are disabled ("Admin only"), never hidden', async ({
    page,
  }) => {
    await logout(page);
    await loginAs(page, 'mod');
    await page.goto(`/admin/projects/${EXCL}?section=listings`);
    await expect(page.getByRole('heading', { name: 'LISTINGS' })).toBeVisible();
    // The fields follow the buttons' recipe (ADR-0037 D8): `disabled` + `title="Admin only"`.
    for (const label of [LISTING_FIELD, CF_FIELD]) {
      const field = page.getByLabel(label, { exact: true });
      await expect(field).toBeDisabled();
      await expect(field).toHaveAttribute('title', 'Admin only');
    }
    const links = page.getByRole('button', { name: 'Link', exact: true });
    await expect(links).toHaveCount(2);
    for (let i = 0; i < 2; i += 1) {
      await expect(links.nth(i)).toBeDisabled();
      expect(await links.nth(i).evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(
        true,
      );
    }
    // Clicking a disabled Link issues no action call and no forbidden alert (02 §1.3).
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });
    await links.first().click({ force: true });
    await page.waitForTimeout(500);
    expect(posts).toEqual([]);
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
    // Wells: inert but present — the T-E2E-35 assertion shape. S1.5c (ADR-0039 D2): the icon +
    // gallery wells live on `?section=gallery`, the file well on `?section=versions`.
    const wells = page.locator('[data-state][aria-disabled="true"][title="Admin only"]');
    const fileInputs = page.locator('input[type="file"]');
    for (const [section, count] of [
      ['gallery', 2],
      ['versions', 1],
    ] as const) {
      await page.goto(`/admin/projects/${EXCL}?section=${section}`);
      await expect(wells).toHaveCount(count);
      await expect(fileInputs).toHaveCount(count);
      for (let i = 0; i < count; i += 1) {
        await expect(fileInputs.nth(i)).toBeDisabled();
      }
    }
    await logout(page);
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-52 — the fold: a synced duplicate of the listing folds into a factory exclusive
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-52 fold: linking a listing the sync already imported moves its versions + comment onto the exclusive, deletes the duplicate, the old URL lands on the canonical page (title, both versions once), /admin/projects + sitemap drop the duplicate', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const db = service();
    const CANON_SLUG = 't-e2e-fold-canon';
    const CANON_TITLE = 'E2E Fold Canonical';
    const OLD_SLUG = 't-e2e-fold-dup';

    // The canonical is PUBLISHED: `project_redirects` reads are visible-or-admin (ADR-0037 D4),
    // and the public route resolves the redirect on the anon client, so a draft target 404s.
    const canonId = await makeProject({
      source: 'odsens',
      slug: CANON_SLUG,
      title: CANON_TITLE,
      project_type: 'datapack',
      status: 'published',
    });
    const dupId = await makeProject({
      source: 'modrinth',
      external_id: LISTING_ID,
      slug: OLD_SLUG,
      title: listing.title,
      project_type: 'datapack',
      status: 'published',
    });
    const versionId = await makeVersion({
      project_id: dupId,
      external_id: 't-e2e-fold-ver',
      version_number: '1.0.0',
      game_versions: ['1.21'],
      loaders: ['datapack'],
    });
    const fileId = await makeFile({
      version_id: versionId,
      filename: 'e2e-cross-post-1.0.0.zip',
      url: `https://cdn.modrinth.com/data/${LISTING_ID}/versions/t-e2e-fold-ver/e2e-cross-post-1.0.0.zip`,
      storage_path: null,
      primary: true,
    });
    // A second synced version — the public page must list each once after the fold (05 T-E2E-52).
    const version2Id = await makeVersion({
      project_id: dupId,
      external_id: 't-e2e-fold-ver-2',
      version_number: '1.1.0',
      game_versions: ['1.21'],
      loaders: ['datapack'],
      date_published: '2026-02-01T12:00:00Z',
    });
    await makeFile({
      version_id: version2Id,
      filename: 'e2e-cross-post-1.1.0.zip',
      url: `https://cdn.modrinth.com/data/${LISTING_ID}/versions/t-e2e-fold-ver-2/e2e-cross-post-1.1.0.zip`,
      storage_path: null,
      primary: true,
    });
    const commentId = await makeComment({
      target_id: dupId,
      body: 't_ fold me onto the canonical project',
    });

    await loginAs(page, 'admin');
    await page.goto(`/admin/projects/${canonId}?section=listings`);
    await page.getByLabel(LISTING_FIELD, { exact: true }).fill(LISTING_ID);
    await submitIn(page, listingForm(page, LISTING_FIELD), 'Link');
    await expect(page).toHaveURL(`/admin/projects/${canonId}?section=listings`);
    await expect(linkedRow(page, LISTING_FIELD).locator(`a[href="${LISTING_URL}"]`)).toBeVisible();
    // The editor's VERSIONS & FILES section now shows the moved versions and their CDN files.
    await page.goto(`/admin/projects/${canonId}?section=versions`);
    await expect(page.getByText('v1.0.0', { exact: true })).toBeVisible();
    await expect(page.getByText('v1.1.0', { exact: true })).toBeVisible();
    await expect(page.getByText('e2e-cross-post-1.0.0.zip')).toBeVisible();
    await expect(page.getByText('e2e-cross-post-1.1.0.zip')).toBeVisible();

    // Moved: versions + files follow the canonical; the comment re-targets; the duplicate is gone.
    const version = await db
      .from('project_versions')
      .select('project_id, external_id')
      .eq('id', versionId)
      .single();
    expect(version.data).toMatchObject({ project_id: canonId, external_id: 't-e2e-fold-ver' });
    const version2 = await db
      .from('project_versions')
      .select('project_id')
      .eq('id', version2Id)
      .single();
    expect(version2.data?.project_id).toBe(canonId);
    const file = await db.from('project_files').select('version_id').eq('id', fileId).single();
    expect(file.data?.version_id).toBe(versionId);
    const comment = await db.from('comments').select('target_id').eq('id', commentId).single();
    expect(comment.data?.target_id).toBe(canonId);
    const duplicate = await db.from('projects').select('id').eq('id', dupId).maybeSingle();
    expect(duplicate.data, 'the duplicate row is folded away').toBeNull();
    const redirect = await db
      .from('project_redirects')
      .select('project_id')
      .eq('old_slug', OLD_SLUG)
      .maybeSingle();
    expect(redirect.data?.project_id).toBe(canonId);
    expect(await linkRow(canonId, 'modrinth')).toMatchObject({ external_id: LISTING_ID });

    // The old URL lands on the canonical page (ADR-0025: 308, or 200 + a client redirect).
    await expect(async () => {
      const probe = await page.request.get(`/projects/${OLD_SLUG}`, { maxRedirects: 0 });
      expect([308, 200]).toContain(probe.status());
      await page.goto(`/projects/${OLD_SLUG}`);
      await page.waitForURL(`**/projects/${CANON_SLUG}`, { timeout: 5_000 });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(CANON_TITLE, {
        timeout: 1_000,
      });
    }).toPass({ timeout: 20_000, intervals: [400, 800, 1_600] });
    // The landing page is the canonical one (its `<title>`), lists both synced versions once each
    // (a CDN Download link per file — the project has a Modrinth home, so CDN rows render), and
    // the moved comment renders on the canonical thread.
    await expect(page).toHaveTitle(new RegExp(CANON_TITLE));
    await expect(
      page.getByRole('link', { name: 'Download e2e-cross-post-1.0.0.zip', exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('link', { name: 'Download e2e-cross-post-1.1.0.zip', exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText('t_ fold me onto the canonical project')).toBeVisible();

    // `/admin/projects` no longer lists the duplicate; the sitemap carries the canonical slug and
    // not the folded one (the link's `revalidateTag('projects')` refreshes it — RP-07).
    await page.goto('/admin/projects');
    await expect(page.locator('tbody tr', { hasText: CANON_SLUG })).toHaveCount(1);
    await expect(page.locator('tbody tr', { hasText: OLD_SLUG })).toHaveCount(0);
    await expect(async () => {
      const sitemap = await page.request.get('/sitemap.xml');
      expect(sitemap.status()).toBe(200);
      const xml = await sitemap.text();
      expect(xml).toContain(`/projects/${CANON_SLUG}<`);
      expect(xml).not.toContain(`/projects/${OLD_SLUG}<`);
    }).toPass({ timeout: 20_000, intervals: [400, 800, 1_600] });

    // Cleanup is `cleanupFactories` in afterAll: the canonical's delete cascades the moved
    // versions/files, the link and the redirect row; the tracked duplicate id deletes 0 rows.
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-53 — uploads on a Modrinth-first row → hosted primary (302) + "Also on Modrinth"
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-53 Modrinth-first row: read-only home listing; icon + file upload onto the synced 1.0.0 → hosted file first, GET IT primary 302 via /api/download, "Also on Modrinth" row stays', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const db = service();
    const SLUG = 't-e2e-first-on-modrinth';
    const TITLE = 'E2E First On Modrinth';
    const projectId = await makeProject({
      source: 'modrinth',
      external_id: LISTING_ID,
      slug: SLUG,
      title: TITLE,
      project_type: 'datapack',
      status: 'published',
      loaders: ['datapack'],
      game_versions: ['1.21'],
      downloads_modrinth: listing.downloads,
    });
    // One synced release with a CDN file — the Modrinth-first shape (ADR-0037 D5/D6).
    const cdnVersionId = await makeVersion({
      project_id: projectId,
      external_id: 't-e2e-first-ver',
      version_number: '1.0.0',
      game_versions: ['1.21'],
      loaders: ['datapack'],
      date_published: '2026-01-10T12:00:00Z',
    });
    await makeFile({
      version_id: cdnVersionId,
      filename: 'first-on-modrinth-1.0.0.zip',
      url: `https://cdn.modrinth.com/data/${LISTING_ID}/versions/t-e2e-first-ver/first-on-modrinth-1.0.0.zip`,
      storage_path: null,
      primary: true,
    });

    try {
      await loginAs(page, 'admin');
      // S1.5c (ADR-0039 D2): OVERRIDES on `?section=general`, the listing field on
      // `?section=listings`, the icon well on `?section=gallery`, the file well on
      // `?section=versions`; a synced row lists no Publish section at all.
      await page.goto(`/admin/projects/${projectId}?section=general`);
      const of = (name: string) =>
        page.locator('section', { has: page.getByRole('heading', { name, exact: true }) });
      const icon = of('ICON');
      const versions = of('VERSIONS & FILES');
      // The synced branch keeps its curate panel and shows no publish controls (ADR-0037 D5c).
      await expect(page.getByRole('heading', { name: 'OVERRIDES' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
      await expect(
        page.locator('nav[aria-label="Sections"]').getByRole('link', { name: 'Publish' }),
      ).toHaveCount(0);
      // A synced row IS its listing (ADR-0037 D8): the Modrinth field is read-only with the home
      // helper and no Link / Remove of its own; the CurseForge field keeps its Link button.
      await page.goto(`/admin/projects/${projectId}?section=listings`);
      const homeListing = page.getByLabel(LISTING_FIELD, { exact: true });
      await expect(homeListing).toHaveValue(LISTING_URL);
      await expect(homeListing).toHaveAttribute('readonly', '');
      await expect(
        page.getByText("Synced from Modrinth — this is the project's home listing."),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Link', exact: true })).toHaveCount(1);
      await expect(listingForm(page, CF_FIELD).getByRole('button', { name: 'Link' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);

      // Icon upload (two-phase — the T-E2E-35 pattern; `done` is the contract).
      await page.goto(`/admin/projects/${projectId}?section=gallery`);
      const iconWell = icon.locator('[data-state]');
      await iconWell
        .locator('input[type="file"]')
        .setInputFiles(fixturePath('images', 'icon-256.png'));
      await expect(iconWell).toHaveAttribute('data-state', 'done', { timeout: 15_000 });
      await expect(icon.getByAltText(`${TITLE} icon`)).toBeVisible({ timeout: 15_000 });
      const iconRow = await db.from('projects').select('icon_url').eq('id', projectId).single();
      expect(iconRow.data?.icon_url).toMatch(new RegExp(`^project-media/${projectId}/icon/`));

      // File upload onto the SYNCED 1.0.0 (same number = a hosted file on that release — ADR-0037
      // D5(b); the form's version metadata is ignored, the row follows Modrinth), primary.
      await page.goto(`/admin/projects/${projectId}?section=versions`);
      await versions.getByLabel('Version number').fill('1.0.0');
      await versions.getByLabel('Game versions').fill('1.21');
      const loaders = versions.getByRole('group', { name: 'Loaders' });
      await loaders.getByText('Datapack', { exact: true }).click();
      await expect(loaders.getByLabel('Datapack')).toBeChecked();
      await toggleFor(page, 'Primary file').label.click({ force: true });
      await expect(toggleFor(page, 'Primary file').input).toBeChecked();
      const fileWell = versions.locator('[data-state]');
      await fileWell.locator('input[type="file"]').setInputFiles(fixturePath('files', 'pack.zip'));
      await expect(fileWell).toHaveAttribute('data-state', 'done', { timeout: 15_000 });
      // One version, two homes: the hosted file first, the CDN file after it (`hostedFirst`).
      await expect(versions.getByText('v1.0.0', { exact: true })).toHaveCount(1, {
        timeout: 15_000,
      });
      const editorFiles = versions.locator('li[class*="admin-project-file"]');
      await expect(editorFiles).toHaveCount(2);
      await expect(editorFiles.nth(0)).toContainText('pack.zip');
      await expect(editorFiles.nth(0)).toContainText('odsens');
      await expect(editorFiles.nth(1)).toContainText('first-on-modrinth-1.0.0.zip');
      await expect(editorFiles.nth(1)).toContainText('Modrinth');
      const hostedRows = await db
        .from('project_versions')
        .select('id, external_id')
        .eq('project_id', projectId);
      expect(hostedRows.data).toEqual([{ id: cdnVersionId, external_id: 't-e2e-first-ver' }]);

      // Public page: hosted primary (302 through the route), Modrinth stays an "Also on" row,
      // no badge (the row has a platform home), DETAILS Source = Modrinth.
      const getIt = page.locator(`aside[aria-labelledby="get-it-${SLUG}"]`);
      await expect(async () => {
        const response = await page.goto(`/projects/${SLUG}`);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE, { timeout: 1_000 });
        const href = (await getIt.locator('a[data-variant="primary"]').getAttribute('href')) ?? '';
        expect(href).toMatch(/^\/api\/download\/[0-9a-f-]{36}$/);
        const probe = await page.request.get(href, { maxRedirects: 0 });
        expect(probe.status()).toBe(302);
        expect(probe.headers()['location'] ?? '').toContain('download=pack.zip');
      }).toPass({ timeout: 20_000, intervals: [400, 800, 1_600] });
      await expect(getIt.locator('a', { hasText: 'Also on Modrinth' })).toContainText(
        compact(listing.downloads),
      );
      // VERSIONS & FILES: the one 1.0.0 row lists the hosted file first, the CDN file after it.
      const downloadLinks = page.getByRole('link', { name: /^Download / });
      await expect(downloadLinks).toHaveCount(2);
      await expect(downloadLinks.nth(0)).toHaveAccessibleName('Download pack.zip');
      await expect(downloadLinks.nth(1)).toHaveAccessibleName(
        'Download first-on-modrinth-1.0.0.zip',
      );
      await expect(page.getByText(BADGE)).toHaveCount(0);
      await expect(
        page
          .locator('section[aria-labelledby="details-title"]')
          .getByText('Modrinth', { exact: true }),
      ).toBeVisible();
      const counted = await db
        .from('projects')
        .select('downloads_direct')
        .eq('id', projectId)
        .single();
      expect(counted.data?.downloads_direct).toBeGreaterThanOrEqual(1);
    } finally {
      // Storage first, while the version rows still name the nested folders (T-E2E-35 pattern).
      const rows = await db.from('project_versions').select('id').eq('project_id', projectId);
      const filePaths: string[] = [];
      for (const row of (rows.data ?? []) as { id: string }[]) {
        filePaths.push(...(await listObjects('project-files', `${projectId}/${row.id}`)));
      }
      await removeObjects('project-files', filePaths);
      await removeObjects('project-media', await listObjects('project-media', `${projectId}/icon`));
      // The factory row (and its cascade) leaves in `cleanupFactories`.
    }
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
/** A public-gallery image by name: the large image (`alt`) or a thumb button (`aria-label`). */
function galleryImage(page: Page, name: string) {
  return page.locator(
    `img[alt="${name}"], button[aria-label="Show image 1: ${name}"], button[aria-label="Show image 2: ${name}"]`,
  );
}

test.describe('editor feedback + gallery curation (T-E2E-54)', () => {
  // ADR-0038 D1/D3 on the synced seed pixel-chameleon (SEED-4: two Modrinth gallery images "In
  // hand" (featured) + "Bonk"). Every write here lands on `project_overrides.gallery_overrides`,
  // reset to `[]` in `afterAll` (the SEED-6 override row keeps its other columns —
  // `restoreContentTables` stays the byte-level safety net).
  /** SEED-4's two Modrinth gallery entries, as `supabase/seed.sql` stores them. */
  const SEED_PIXEL_GALLERY = [
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
  ];

  // Arrange from the seed truth rather than from whatever the earlier tests left (a local db lane
  // run before the e2e lane can leave the synced gallery empty; CI resets the database first).
  test.beforeAll(async () => {
    const service = loose(asRole('service'));
    const gallery = await service
      .from('projects')
      .update({ gallery: SEED_PIXEL_GALLERY })
      .eq('id', PIXEL);
    if (gallery.error) throw new Error(`arrange gallery failed: ${gallery.error.message}`);
    const overrides = await service
      .from('project_overrides')
      .update({ gallery_overrides: [] })
      .eq('project_id', PIXEL);
    if (overrides.error) throw new Error(`arrange overrides failed: ${overrides.error.message}`);
  });

  test.afterAll(async () => {
    const service = loose(asRole('service'));
    const { error } = await service
      .from('project_overrides')
      .update({ gallery_overrides: [] })
      .eq('project_id', PIXEL);
    if (error) throw new Error(`restore gallery_overrides failed: ${error.message}`);
  });

  test('T-E2E-54 Save → "Saved." toast; rename + hide a Modrinth image → public gallery follows; Show restores', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginAs(page, 'admin');
    await page.goto(`/admin/projects/${PIXEL}?section=gallery`);

    // The GALLERY rows: a thumbnail, a Name field and a Hide button each (thumbnails are pictures).
    const rows = page.getByTestId('admin-gallery-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('img')).toBeVisible();
    await expect(rows.first().getByText('From Modrinth', { exact: true })).toBeVisible();

    // Rename "Bonk" → "Bonk!" and Save names → the toast says Saved. (ADR-0038 D1) and the query
    // is stripped so a reload does not repeat it.
    const bonk = rows.filter({ has: page.getByLabel('Name').and(page.locator('[value="Bonk"]')) });
    await expect(bonk).toHaveCount(1);
    await bonk.getByLabel('Name').fill('Bonk!');
    await submitAndWait(page, 'Save names');
    await expect(page.getByRole('status')).toContainText('Saved.');
    await expect(page).not.toHaveURL(/saved=/);
    await expect(page.getByLabel('Name').nth(1)).toHaveValue('Bonk!');
    await expectAtUrl(page, '/projects/pixel-chameleon', async () => {
      // The public `Gallery` shows the featured image large (`alt`) and the rest as thumbs
      // (`aria-label="Show image N: <alt>"`) — either form proves the name landed.
      await expect(galleryImage(page, 'Bonk!').first()).toBeAttached({ timeout: 1_000 });
    });

    // Enter in a Name field means "Save names" — never the first row's Hide/Delete (the hidden
    // default submit button; frontend gate, ADR-0038 D3): both rows survive, the name lands.
    await page.goto(`/admin/projects/${PIXEL}?section=gallery`);
    await page.getByLabel('Name').nth(1).fill('Bonk!!');
    const enterPost = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/admin/projects/'),
    );
    await page.getByLabel('Name').nth(1).press('Enter');
    await enterPost;
    await expect(page.getByRole('status')).toContainText('Saved.');
    await expect(rows).toHaveCount(2);
    await expect(page.getByLabel('Name').nth(1)).toHaveValue('Bonk!!');
    await page.getByLabel('Name').nth(1).fill('Bonk!');
    await submitAndWait(page, 'Save names');

    // Hide the featured "In hand" → the row says so, the public gallery shows one image.
    await page.goto(`/admin/projects/${PIXEL}?section=gallery`);
    await rows.first().getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Saved.');
    await expect(rows.first().getByText('From Modrinth — hidden on odsens')).toBeVisible();
    await expectAtUrl(page, '/projects/pixel-chameleon', async () => {
      await expect(galleryImage(page, 'In hand')).toHaveCount(0, { timeout: 1_000 });
      await expect(galleryImage(page, 'Bonk!').first()).toBeAttached({ timeout: 1_000 });
    });

    // Show brings it back.
    await page.goto(`/admin/projects/${PIXEL}?section=gallery`);
    await rows.first().getByRole('button', { name: 'Show', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Saved.');
    await expectAtUrl(page, '/projects/pixel-chameleon', async () => {
      await expect(galleryImage(page, 'In hand').first()).toBeAttached({ timeout: 1_000 });
    });

    // Moderator: the Name fields and row buttons are disabled, never hidden (03 §2.10).
    await logout(page);
    await loginAs(page, 'mod');
    await page.goto(`/admin/projects/${PIXEL}?section=gallery`);
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByLabel('Name')).toBeDisabled();
    await expect(rows.first().getByRole('button', { name: 'Hide', exact: true })).toBeDisabled();
    await expectNoSeriousA11y(page);
  });
});

/**
 * S1.5c — editor v2 (ADR-0039 D2–D5; ADR-0040 D3/D5/D6/D7; 00 S1.5c.AC1–AC7). Lives in THIS file
 * for the T-E2E-35 reason (the `admin` project is serial only within a file). Every write here
 * lands on the seed exclusive `…0103` and is put back THROUGH the same form (so the public ISR
 * entry revalidates); `afterAll` restores `projects.body_md` via the service client as the safety
 * net (05 H-1 — `restoreContentTables` at the top of the file is the byte-level one).
 *
 *  - T-E2E-55: sections + the unsaved guard, both branches — the sidebar lists six sections on
 *    the exclusive and five (no Publish) on the synced `…0102`; only the active section's
 *    headings are in the DOM; `?section=gallery` survives a reload; `?section=nope` renders
 *    General without touching the URL; `?listing=<id>` alone opens Listings with the field
 *    prefilled and `?section=general&listing=` still renders General (ADR-0040 D8); Save lands on `?section=general&saved=saved` (captured
 *    from `history.replaceState` — `SavedToast` strips `saved` at once) then the "Saved." toast;
 *    picking another Type in the themed `Select` (no other edit) sets `data-dirty="true"` and
 *    picking the seed value back clears it (ADR-0040 D9); typing sets `data-dirty="true"` + the
 *    sr "Unsaved changes" on the active link and the `beforeunload` handler cancels a dispatched
 *    event; a section click opens the `Dialog`
 *    (Stay focused, Enter on Stay submits nothing, Esc keeps the edit, Leave anyway navigates and
 *    clears the dirty state); the admin shell's Projects link is guarded too (ADR-0040 D3); a
 *    Ctrl/Cmd-click passes through; a submit clears the dot; the Preview switch and the file
 *    well's fields never set it; a validation error keeps the section.
 *  - T-E2E-56: the Markdown editor on the exclusive's Body — the 13 toolbar buttons in order with
 *    one roving tab stop (←/→ Home/End); a toolbar-only edit (selected word + Bold, nothing
 *    typed) sets `data-dirty="true"` and Ctrl+B toggling it off reads clean (ADR-0040 D9), while
 *    Ctrl+Shift+B leaves the value alone; caret + selection insertions for Bold / Ctrl+I / H2 /
 *    Bullet list / Link / YouTube, Ctrl+B parity (toggle off); Preview ON hides the textarea
 *    (still attached — it posts), disables the toolbar and renders the same sanitised tree the
 *    public page shows (a raw `<script>` yields no element, a disallowed-host image renders as a
 *    link, "Nothing to preview yet." when empty); Preview parity = the pane's markdown root
 *    `innerHTML` equals the public About root's after whitespace normalisation; the stored
 *    `projects.body_md` is the typed Markdown; an emptied Body saves as '' (ADR-0040 D7);
 *    restored by typing the seed body back and saving.
 *  - T-E2E-57: at 390 the section nav is a one-row chip strip that scrolls (`scrollWidth >
 *    clientWidth`, no page overflow) and the toolbar wraps inside the well; at 1280 the nav is
 *    the 220px sidebar column and every toolbar button answers `elementFromPoint` 2px outside
 *    its 36px box (the 44px `::after` target, 03 C-24); `expectNoSeriousA11y` at 1280 AND 390 on every section of both
 *    rows as admin (with `admin-project-<section>` / `admin-project-synced-<section>` screenshots
 *    and the open dialog once per width) and again as moderator, whose textarea, toolbar and Save
 *    are disabled "Admin only" while the Preview switch still flips and the section links still
 *    navigate (ADR-0040 D5; 00 S1.5c.AC6).
 */
test.describe('editor v2 — sections, guard, Markdown editor (T-E2E-55/56/57)', () => {
  const EXCL = SEED_PROJECTS.seedExclusivePack;
  const EXCL_SLUG = 'seed-exclusive-pack';
  const SECTION_LABELS = ['General', 'Description', 'Gallery', 'Versions', 'Listings', 'Publish'];
  const EXCL_SECTIONS = ['general', 'description', 'gallery', 'versions', 'listings', 'publish'];
  const SYNCED_SECTIONS = EXCL_SECTIONS.slice(0, 5);
  /** The section headings each branch renders — only the active section's are in the DOM. */
  const HEADINGS: Record<'odsens' | 'modrinth', Record<string, string[]>> = {
    odsens: {
      general: ['DETAILS'],
      description: ['DESCRIPTION'],
      gallery: ['ICON', 'GALLERY'],
      versions: ['VERSIONS & FILES'],
      listings: ['LISTINGS'],
      publish: ['PUBLISH'],
    },
    modrinth: {
      general: ['OVERRIDES'],
      description: ['NOTES'],
      gallery: ['ICON', 'GALLERY'],
      versions: ['VERSIONS & FILES'],
      listings: ['LISTINGS'],
    },
  };
  const TOOLBAR_LABELS = [
    'Heading 1',
    'Heading 2',
    'Heading 3',
    'Bold',
    'Italic',
    'Strikethrough',
    'Code',
    'Bullet list',
    'Numbered list',
    'Quote',
    'Link',
    'Image',
    'YouTube',
  ];
  const DIALOG_BODY = "You changed something here and didn't save.";
  /** The `/admin/projects` match note's `?listing=` value — a Modrinth id, nothing links. */
  const LISTING_PREFILL = 'sd000199';
  const LISTING_FIELD = 'Modrinth listing (URL, slug or id)';
  /** A Title edit the action trims away — the form is dirty, the stored row stays the seed. */
  const TITLE_EDIT = 'Seed Exclusive Pack ';

  let seedBody = '';

  test.beforeAll(async () => {
    loadEnvTest();
    const row = await loose(asRole('service'))
      .from('projects')
      .select('body_md')
      .eq('id', EXCL)
      .single();
    expect(row.error).toBeNull();
    seedBody = (row.data as { body_md: string }).body_md;
    expect(seedBody).toContain('## About the pack');
  });

  test.afterAll(async () => {
    const { error } = await loose(asRole('service'))
      .from('projects')
      .update({ body_md: seedBody })
      .eq('id', EXCL);
    if (error) throw new Error(`restore body_md failed: ${error.message}`);
  });

  function editor(id: string, section?: string): string {
    return `/admin/projects/${id}${section === undefined ? '' : `?section=${section}`}`;
  }

  function sectionNav(page: Page) {
    return page.locator('nav[aria-label="Sections"]');
  }

  /**
   * `goto` + wait for the section nav to be VISIBLE: the admin route streams under its
   * `loading.tsx` shell, so right after `load` the page can still sit inside React's hidden
   * streaming segment (`<div hidden id="S:0">`) — a locator resolves there with no box.
   */
  async function open(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await expect(sectionNav(page)).toBeVisible();
  }

  function activeLink(page: Page) {
    return sectionNav(page).locator('a[aria-current="page"]');
  }

  function dirtyRoot(page: Page) {
    return page.locator('[data-dirty="true"]');
  }

  /**
   * Per toolbar button: does `elementFromPoint` just outside its 36px box resolve as ADR-0040 D12
   * says? `touch` = a full 44×44 on every side; `mouse` = 44 tall, a group's outer sides 4px, the
   * in-group gap split evenly (1px outside → this button, 3px outside → the neighbour).
   */
  function hitTargets(page: Page, spacing: 'touch' | 'mouse') {
    return toolbar(page)
      .getByRole('button')
      .evaluateAll(
        (buttons, mode) =>
          buttons.map((button) => {
            const box = button.getBoundingClientRect();
            const midX = box.left + box.width / 2;
            const midY = box.top + box.height / 2;
            const at = (x: number, y: number) => document.elementFromPoint(x, y);
            const prev = button.previousElementSibling;
            const next = button.nextElementSibling;
            const own = [at(midX, box.top - 3), at(midX, box.bottom + 3)];
            if (mode === 'touch' || prev === null) own.push(at(box.left - 3, midY));
            else own.push(at(box.left - 1, midY));
            if (mode === 'touch' || next === null) own.push(at(box.right + 3, midY));
            else own.push(at(box.right + 1, midY));
            const split =
              mode === 'touch' ||
              ((prev === null || at(box.left - 3, midY) === prev) &&
                (next === null || at(box.right + 3, midY) === next));
            return own.every((hit) => hit === button) && split;
          }),
        spacing,
      );
  }

  function leaveDialog(page: Page) {
    return page.getByRole('dialog', { name: 'Unsaved changes' });
  }

  function bodyField(page: Page) {
    return page.locator('#field-body_md');
  }

  function toolbar(page: Page) {
    return page.getByRole('toolbar', { name: 'Formatting' });
  }

  /** `true` when the island's `beforeunload` listener cancelled a dispatched event (dirty). */
  function beforeUnloadPrevented(page: Page): Promise<boolean> {
    return page.evaluate(
      () => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    );
  }

  /**
   * Playwright auto-DISMISSES native dialogs, and dismissing a `beforeunload` prompt cancels the
   * navigation — so a `page.goto` away from a dirty section would hang. Accept them instead.
   */
  function acceptNativeDialogs(page: Page): void {
    page.on('dialog', (dialog) => {
      void dialog.accept().catch(() => undefined);
    });
  }

  /** Only the active section's headings are rendered; every other section's are absent. */
  async function expectOnlySection(
    page: Page,
    branch: 'odsens' | 'modrinth',
    active: string,
  ): Promise<void> {
    for (const [section, names] of Object.entries(HEADINGS[branch])) {
      for (const name of names) {
        await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(
          section === active ? 1 : 0,
        );
      }
    }
  }

  async function selectIn(page: Page, start: number, end: number): Promise<void> {
    await bodyField(page).evaluate(
      (el, range) => {
        const textarea = el as HTMLTextAreaElement;
        textarea.focus();
        textarea.setSelectionRange(range[0], range[1]);
      },
      [start, end] as const,
    );
  }

  async function selectionOf(page: Page): Promise<[number, number]> {
    return bodyField(page).evaluate((el) => {
      const textarea = el as HTMLTextAreaElement;
      return [textarea.selectionStart, textarea.selectionEnd] as [number, number];
    });
  }

  async function selectedText(page: Page): Promise<string> {
    const [start, end] = await selectionOf(page);
    return (await bodyField(page).inputValue()).slice(start, end);
  }

  /** CRLF → LF (see the stored-value assertion in T-E2E-56); the loose client types the column as unknown. */
  function unixLines(text: unknown): string {
    return String(text ?? '').replace(/\r\n/g, '\n');
  }

  /**
   * The two renders differ only in what React's server renderer adds around text: whitespace
   * between tags and the `<!-- -->` separator it emits between adjacent text nodes (the public
   * About root is server-rendered HTML; the Preview pane is client-rendered). Both are stripped;
   * every element, attribute and text is compared verbatim.
   */
  function normaliseHtml(html: string): string {
    return html
      .replace(/<!--.*?-->/g, '')
      .replace(/>\s+</g, '><')
      .trim();
  }

  // ---------------------------------------------------------------------------------------------
  // T-E2E-55 — sections + the unsaved guard (00 S1.5c.AC1/AC2/AC3/AC7)
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-55 sections + unsaved guard: 6 / 5 sections, one section rendered, deep link + unknown, Save keeps the section, Type pick + dirty dot + beforeunload, dialog Stay / Esc / Enter / Leave anyway, shell nav guarded, Ctrl-click passes, submit / Preview / file well, validation error keeps the section', async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    acceptNativeDialogs(page);
    await loginAs(page, 'admin');
    const nav = sectionNav(page);
    const dialog = leaveDialog(page);
    const stay = dialog.getByRole('button', { name: 'Stay', exact: true });
    const leave = dialog.getByRole('button', { name: 'Leave anyway', exact: true });
    const title = page.getByLabel('Title', { exact: true });

    // -- The exclusive lists all six sections; no `?section=` renders General, URL untouched ---
    await open(page, editor(EXCL));
    await expect(nav.getByRole('link')).toHaveText(SECTION_LABELS);
    await expect(activeLink(page)).toHaveText('General');
    await expect(page).toHaveURL(editor(EXCL));
    await expectOnlySection(page, 'odsens', 'general');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(1);
    await expect(toggleFor(page, 'Comments on Seed Exclusive Pack').input).toBeVisible();

    // -- The synced row lists five (no Publish) and renders OVERRIDES on General (AC7) ---------
    await open(page, editor(PIXEL, 'general'));
    await expect(nav.getByRole('link')).toHaveText(SECTION_LABELS.slice(0, 5));
    await expect(nav.getByRole('link', { name: 'Publish' })).toHaveCount(0);
    await expectOnlySection(page, 'modrinth', 'general');

    // -- `?section=gallery` deep link survives a reload (AC1) ---------------------------------
    await open(page, editor(EXCL, 'gallery'));
    await expect(activeLink(page)).toHaveText('Gallery');
    await expectOnlySection(page, 'odsens', 'gallery');
    await page.reload();
    await expect(sectionNav(page)).toBeVisible();
    await expect(page).toHaveURL(editor(EXCL, 'gallery'));
    await expect(activeLink(page)).toHaveText('Gallery');
    await expectOnlySection(page, 'odsens', 'gallery');

    // -- Unknown `?section=nope` → General rendered, no redirect ------------------------------
    await open(page, editor(EXCL, 'nope'));
    await expect(activeLink(page)).toHaveText('General');
    await expectOnlySection(page, 'odsens', 'general');
    await expect(page).toHaveURL(editor(EXCL, 'nope'));

    // -- `?listing=` with no `?section=` opens Listings with the prefill (ADR-0040 D8); an
    // explicit `?section=` wins over it -------------------------------------------------------
    await open(page, `${editor(EXCL)}?listing=${LISTING_PREFILL}`);
    await expect(activeLink(page)).toHaveText('Listings');
    await expectOnlySection(page, 'odsens', 'listings');
    await expect(page.getByLabel(LISTING_FIELD, { exact: true })).toHaveValue(LISTING_PREFILL);
    await open(page, `${editor(EXCL, 'general')}&listing=${LISTING_PREFILL}`);
    await expect(activeLink(page)).toHaveText('General');
    await expectOnlySection(page, 'odsens', 'general');

    // -- Clean: no dot, no `data-dirty`, `beforeunload` passes ---------------------------------
    await open(page, editor(EXCL, 'general'));
    await expect(dirtyRoot(page)).toHaveCount(0);
    await expect(activeLink(page)).not.toContainText('Unsaved changes');
    expect(await beforeUnloadPrevented(page)).toBe(false);

    // -- A Type pick alone marks the section unsaved (AC2 — the themed `Select` writes a hidden
    // input and announces the pick as a native `change`, ADR-0040 D9); the seed value back → clean
    const type = page.getByLabel('Type', { exact: true });
    await expect(type).toHaveText('Datapack'); // the seed exclusive's project_type
    await type.click();
    await page.getByRole('option', { name: 'Mod', exact: true }).click();
    await expect(type).toHaveText('Mod');
    await expect(dirtyRoot(page)).toHaveCount(1);
    await expect(activeLink(page)).toContainText('Unsaved changes');
    await type.click();
    await page.getByRole('option', { name: 'Datapack', exact: true }).click();
    await expect(type).toHaveText('Datapack');
    await expect(dirtyRoot(page)).toHaveCount(0);
    await expect(activeLink(page)).not.toContainText('Unsaved changes');

    // -- Typing marks the section unsaved (AC2) + the `beforeunload` handler cancels (AC3) -----
    await title.fill(TITLE_EDIT);
    await expect(dirtyRoot(page)).toHaveCount(1);
    await expect(activeLink(page)).toContainText('Unsaved changes');
    expect(await beforeUnloadPrevented(page)).toBe(true);

    // -- A section click opens the dialog: name, body, buttons in order, Stay focused ----------
    await nav.getByRole('link', { name: 'Gallery' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(DIALOG_BODY);
    await expect(dialog.getByRole('button')).toHaveText(['Leave anyway', 'Stay']);
    await expect(stay).toBeFocused();
    await stay.click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(editor(EXCL, 'general'));
    await expect(title).toHaveValue(TITLE_EDIT);
    await expect(dirtyRoot(page)).toHaveCount(1);

    // Esc keeps the edit.
    await nav.getByRole('link', { name: 'Gallery' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(editor(EXCL, 'general'));
    await expect(title).toHaveValue(TITLE_EDIT);

    // Enter on the focused Stay closes the dialog and submits nothing (the buttons are
    // `type="button"` outside the editor's forms).
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });
    await nav.getByRole('link', { name: 'Gallery' }).click();
    await expect(stay).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(400);
    expect(posts, 'Enter on Stay posts nothing').toEqual([]);
    await expect(page).toHaveURL(editor(EXCL, 'general'));
    await expect(title).toHaveValue(TITLE_EDIT);

    // Leave anyway → the other section, clean again; the next click needs no dialog.
    await nav.getByRole('link', { name: 'Gallery' }).click();
    await leave.click();
    await expect(page).toHaveURL(editor(EXCL, 'gallery'));
    await expectOnlySection(page, 'odsens', 'gallery');
    await expect(dirtyRoot(page)).toHaveCount(0);
    expect(await beforeUnloadPrevented(page)).toBe(false);
    await nav.getByRole('link', { name: 'Versions' }).click();
    await expect(page).toHaveURL(editor(EXCL, 'versions'));
    await expect(dialog).toBeHidden();
    await expectOnlySection(page, 'odsens', 'versions');

    // -- The admin shell's own Projects link is guarded too (ADR-0040 D3) ---------------------
    await open(page, editor(EXCL, 'general'));
    await title.fill(TITLE_EDIT);
    await expect(dirtyRoot(page)).toHaveCount(1);
    await page.locator('nav[aria-label="Admin"] a[href="/admin/projects"]').click();
    await expect(dialog).toBeVisible();
    await stay.click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(editor(EXCL, 'general'));
    await expect(title).toHaveValue(TITLE_EDIT);

    // -- A Ctrl/Cmd-click passes through: a new tab (or a plain navigation), never the dialog --
    const popup = context.waitForEvent('page', { timeout: 3_000 }).catch(() => null);
    await nav.getByRole('link', { name: 'Gallery' }).click({ modifiers: ['ControlOrMeta'] });
    const opened = await popup;
    await expect(dialog).toBeHidden();
    if (opened !== null) await opened.close();

    // -- Submitting a form clears the dot; the PRG lands on `?section=general&saved=saved`, the
    // toast says Saved. and `saved` is stripped (AC1/AC2; ADR-0038 D1) -----------------------
    await open(page, editor(EXCL, 'general'));
    await title.fill(TITLE_EDIT);
    await expect(dirtyRoot(page)).toHaveCount(1);
    // `SavedToast` strips `saved` through `history.replaceState` at mount: record the URL as it
    // stood at every replaceState call, so the landing URL is captured before it is rewritten.
    await page.evaluate(() => {
      const landed: string[] = [];
      const original = window.history.replaceState.bind(window.history);
      window.history.replaceState = (...args) => {
        landed.push(window.location.href);
        original(...args);
      };
      (window as unknown as { __landed: string[] }).__landed = landed;
    });
    const savePost = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/admin/projects/'),
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dirtyRoot(page)).toHaveCount(0);
    await savePost;
    await expect(page.getByRole('status')).toContainText('Saved.');
    await expect(page).toHaveURL(editor(EXCL, 'general'));
    const landed = await page.evaluate(
      () => (window as unknown as { __landed?: string[] }).__landed ?? [],
    );
    expect(
      landed.some((url) => url.includes(`${editor(EXCL, 'general')}&saved=saved`)),
      `the PRG landed on ?section=general&saved=saved (saw: ${landed.join(' | ')})`,
    ).toBe(true);
    await expect(title).toHaveValue('Seed Exclusive Pack'); // trimmed by the action — seed value
    await expect(activeLink(page)).not.toContainText('Unsaved changes');
    expect(await beforeUnloadPrevented(page)).toBe(false);

    // -- Flipping Preview never sets the dot (a view control, not an edit) ---------------------
    await open(page, editor(EXCL, 'description'));
    const preview = toggleFor(page, 'Preview');
    await preview.label.click({ force: true });
    await expect(preview.input).toBeChecked();
    await expect(page.getByTestId('markdown-preview')).toBeVisible();
    await expect(dirtyRoot(page)).toHaveCount(0);
    await preview.label.click({ force: true });
    await expect(preview.input).not.toBeChecked();
    await expect(dirtyRoot(page)).toHaveCount(0);

    // -- The file well's version fields never set it (uploads never count as unsaved — AC2) ---
    await open(page, editor(EXCL, 'versions'));
    await page.getByLabel('Version number', { exact: true }).fill('9.9.9');
    await page.getByLabel('Game versions', { exact: true }).fill('1.21');
    await page.waitForTimeout(300);
    await expect(dirtyRoot(page)).toHaveCount(0);
    expect(await beforeUnloadPrevented(page)).toBe(false);

    // -- A validation error keeps the section: the PRG carries `?section=general&form=details…`
    // and the message lands inline on the field (03 C-30) --------------------------------------
    await open(page, editor(EXCL, 'general'));
    await page.getByLabel('Source link', { exact: true }).fill('http://example.com/source');
    await submitAndWait(page, 'Save');
    await expect(page).toHaveURL(/\?section=general&form=details&/);
    await expect(page).toHaveURL(/field=source_url/);
    await expect(activeLink(page)).toHaveText('General');
    await expectOnlySection(page, 'odsens', 'general');
    await expect(page.getByLabel('Source link', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // The message rides the field's own `role="alert"` line (03 §2.2 Field a11y; the words are
    // the action's — `runAction` reports a schema failure as its generic line + the field).
    const sourceError = page.locator('#field-source_url-error');
    await expect(sourceError).toHaveAttribute('role', 'alert');
    await expect(sourceError).not.toBeEmpty();
    await expect(sourceError).toBeVisible();
    await expect(dirtyRoot(page)).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-56 — the Markdown editor on the exclusive's Body (00 S1.5c.AC4)
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-56 Markdown editor: 13 toolbar buttons + roving tabindex; a toolbar-only edit sets the dot, Ctrl+B back clears it, Ctrl+Shift+B passes; caret / selection insertions (Bold, Ctrl+I, Ctrl+B toggle, H2, bullet list, Link, YouTube); Preview hides the textarea, disables the toolbar, renders sanitised (no script, disallowed image → link, empty copy); Preview = public About; stored body is plain Markdown; emptied Body clears', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    acceptNativeDialogs(page);
    const db = loose(asRole('service'));
    await loginAs(page, 'admin');
    await open(page, editor(EXCL, 'description'));
    const textarea = bodyField(page);
    const bar = toolbar(page);
    const buttons = bar.getByRole('button');
    const button = (name: string) => bar.getByRole('button', { name, exact: true });
    await expect(textarea).toHaveValue(seedBody);

    // -- The toolbar: 13 buttons in order, titles with the shortcuts, ONE tab stop --------------
    await expect(buttons).toHaveCount(13);
    expect(
      await buttons.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))),
    ).toEqual(TOOLBAR_LABELS);
    await expect(bar.locator('button[tabindex="0"]')).toHaveCount(1);
    await expect(button('Bold')).toHaveAttribute('title', 'Bold (Ctrl+B)');
    await expect(button('Italic')).toHaveAttribute('title', 'Italic (Ctrl+I)');
    await expect(button('Heading 1')).toHaveAttribute('title', 'Heading 1');

    // Roving tabindex (APG toolbar): ←/→ move between buttons, Home/End jump; still one tab stop.
    await button('Heading 1').focus();
    await page.keyboard.press('ArrowRight');
    await expect(button('Heading 2')).toBeFocused();
    await expect(button('Heading 2')).toHaveAttribute('tabindex', '0');
    await expect(bar.locator('button[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await expect(button('Heading 1')).toBeFocused();
    await page.keyboard.press('End');
    await expect(button('YouTube')).toBeFocused();
    await page.keyboard.press('ArrowRight'); // wraps
    await expect(button('Heading 1')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(button('Heading 1')).toBeFocused();

    // -- A toolbar-only edit marks the section unsaved (AC2 — React commits the value, so the
    // editor dispatches a native `input`, ADR-0040 D9); Ctrl/Cmd+B toggling it back off reads
    // clean again; a Shift chord is the browser's and leaves the value untouched -------------
    await expect(dirtyRoot(page)).toHaveCount(0);
    await selectIn(page, 3, 8); // `## About the pack` → "About"
    expect(await selectedText(page)).toBe('About');
    await button('Bold').click();
    await expect(textarea).toHaveValue(`## **About**${seedBody.slice(8)}`);
    await expect(dirtyRoot(page)).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+b');
    await expect(textarea).toHaveValue(seedBody);
    await expect(dirtyRoot(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+b');
    await page.keyboard.press('ControlOrMeta+Shift+i');
    await expect(textarea).toHaveValue(seedBody);
    await expect(dirtyRoot(page)).toHaveCount(0);

    // -- Caret + Bold → `****` with the caret between; focus returns to the textarea ------------
    // (`setSelectionRange` — `press('End')` only ends the LINE.)
    await textarea.fill('hello world');
    await selectIn(page, 11, 11);
    await button('Bold').click();
    await expect(textarea).toHaveValue('hello world****');
    expect(await selectionOf(page)).toEqual([13, 13]);
    await expect(textarea).toBeFocused();

    // Ctrl/Cmd+I at the caret → `__` with the caret between (browser default prevented).
    await textarea.fill('hello world');
    await selectIn(page, 11, 11);
    await page.keyboard.press('ControlOrMeta+i');
    await expect(textarea).toHaveValue('hello world__');
    expect(await selectionOf(page)).toEqual([12, 12]);

    // A selected word → Bold wraps it, the inner text stays selected; Ctrl/Cmd+B toggles it off.
    await textarea.fill('hello world');
    await selectIn(page, 0, 5);
    await button('Bold').click();
    await expect(textarea).toHaveValue('**hello** world');
    expect(await selectedText(page)).toBe('hello');
    await page.keyboard.press('ControlOrMeta+b');
    await expect(textarea).toHaveValue('hello world');
    expect(await selectedText(page)).toBe('hello');

    // H2 on a line (caret anywhere in it) → the `## ` prefix; the other line untouched.
    await textarea.fill('Title line\nbody');
    await selectIn(page, 3, 3);
    await button('Heading 2').click();
    await expect(textarea).toHaveValue('## Title line\nbody');

    // Bullet list on a two-line selection → both lines prefixed.
    await textarea.fill('one\ntwo');
    await selectIn(page, 0, 7);
    await button('Bullet list').click();
    await expect(textarea).toHaveValue('- one\n- two');

    // Link with a selection → `[sel](url)` with `url` selected.
    await textarea.fill('odsens');
    await selectIn(page, 0, 6);
    await button('Link').click();
    await expect(textarea).toHaveValue('[odsens](url)');
    expect(await selectedText(page)).toBe('url');

    // YouTube on a non-empty line → a newline + the watch URL with VIDEO_ID selected.
    await textarea.fill('watch this');
    await selectIn(page, 10, 10);
    await button('YouTube').click();
    await expect(textarea).toHaveValue('watch this\nhttps://www.youtube.com/watch?v=VIDEO_ID');
    expect(await selectedText(page)).toBe('VIDEO_ID');

    // -- Preview: the textarea is `hidden` (still attached — it posts), the toolbar disabled, the
    // pane renders the sanitised tree with the public Markdown look ---------------------------
    const SAMPLE = [
      '## Parity heading',
      '',
      'Some **bold** text with a [link](https://example.com/page).',
      '',
      '- alpha',
      '- beta',
      '- gamma',
      '',
      '> NOTE: A note line.',
      '',
      '<script>alert(1)</script>',
      '',
      '![pic](https://example.com/pic.png)',
    ].join('\n');
    await textarea.fill(SAMPLE);
    const preview = toggleFor(page, 'Preview');
    await preview.label.click({ force: true });
    await expect(preview.input).toBeChecked();
    await expect(textarea).toBeAttached();
    await expect(textarea).toBeHidden();
    await expect(textarea).toHaveAttribute('hidden', '');
    for (let i = 0; i < 13; i += 1) await expect(buttons.nth(i)).toBeDisabled();
    const pane = page.getByTestId('markdown-preview');
    await expect(pane.getByText('PREVIEW', { exact: true })).toBeVisible();
    const previewRoot = pane.locator('[data-variant="about"]');
    await expect(previewRoot.locator('h2')).toHaveText('Parity heading');
    await expect(previewRoot.locator('li')).toHaveCount(3);
    await expect(previewRoot.locator('strong')).toHaveText('bold');
    await expect(previewRoot.locator('script')).toHaveCount(0); // raw HTML skipped (INV-65)
    await expect(previewRoot).not.toContainText('<script>');
    await expect(previewRoot.locator('img')).toHaveCount(0); // example.com is not an INV-54 host
    await expect(previewRoot.locator('a[href="https://example.com/pic.png"]')).toContainText('pic');
    await expect(previewRoot.locator('a[href="https://example.com/page"]')).toHaveAttribute(
      'target',
      '_blank',
    );
    await expect(previewRoot.locator('aside[aria-label="Note"]')).toContainText('A note line.');
    const previewHtml = await previewRoot.innerHTML();

    // Preview OFF → the pane unmounts and the textarea is back; an empty body previews the line.
    await preview.label.click({ force: true });
    await expect(preview.input).not.toBeChecked();
    await expect(pane).toHaveCount(0);
    await expect(textarea).toBeVisible();
    await expect(buttons.first()).toBeEnabled();
    await textarea.fill('');
    await preview.label.click({ force: true });
    await expect(pane.getByText('Nothing to preview yet.')).toBeVisible();
    await expect(pane.locator('[data-variant="about"]')).toHaveCount(0);
    await preview.label.click({ force: true });

    // -- Save → the PRG keeps the section; the stored value is the plain Markdown typed ---------
    await textarea.fill(SAMPLE);
    await submitAndWait(page, 'Save');
    await expect(page).toHaveURL(editor(EXCL, 'description'));
    await expect(page.getByRole('status')).toContainText('Saved.');
    await expect(textarea).toHaveValue(SAMPLE);
    const stored = await db.from('projects').select('body_md').eq('id', EXCL).single();
    expect(stored.error).toBeNull();
    // Plain Markdown, no HTML — compared with LF line endings: the browser's multipart/form-data
    // encoding of a `<textarea>` posts CRLF (the HTML form-submission rule, not the editor —
    // every textarea a server action receives arrives this way; the textarea API value shows LF
    // again and remark treats both endings alike).
    expect(unixLines(stored.data?.body_md)).toBe(SAMPLE);
    expect(stored.data?.body_md).not.toContain('<h2');

    // -- Preview parity: the public About root renders the same tree (same renderer, same
    // sanitize schema, same CSS module — 00 S1.5c.AC4) ---------------------------------------
    const about = page.locator('section[aria-labelledby="about-title"] [data-variant="about"]');
    let publicHtml = '';
    await expectAtUrl(page, `/projects/${EXCL_SLUG}`, async () => {
      await expect(about.locator('h2')).toHaveText('Parity heading', { timeout: 1_000 });
      publicHtml = await about.innerHTML();
    });
    expect(normaliseHtml(publicHtml)).toBe(normaliseHtml(previewHtml));

    // -- An emptied Body saves as '' (ADR-0040 D7 — never a silent no-op) --------------------
    await open(page, editor(EXCL, 'description'));
    await textarea.fill('');
    await submitAndWait(page, 'Save');
    await expect(page.getByRole('status')).toContainText('Saved.');
    await expect(textarea).toHaveValue('');
    const emptied = await db.from('projects').select('body_md').eq('id', EXCL).single();
    expect(emptied.data?.body_md).toBe('');

    // -- Restore THROUGH the form (revalidates the public entry); afterAll is the safety net ---
    await textarea.fill(seedBody);
    await submitAndWait(page, 'Save');
    await expect(textarea).toHaveValue(seedBody);
    const restored = await db.from('projects').select('body_md').eq('id', EXCL).single();
    expect(unixLines(restored.data?.body_md)).toBe(seedBody);
    await expectAtUrl(page, `/projects/${EXCL_SLUG}`, async () => {
      await expect(about.locator('h2').first()).toHaveText('About the pack', { timeout: 1_000 });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-57 — phone chip row + toolbar wrap, axe + screenshots as admin (00 S1.5c.AC5)
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-57 admin: at 390 the chip row scrolls and the toolbar wraps without page overflow; at 1280 the 220px sidebar; axe zero serious/critical at 1280 + 390 on every section of both rows + the open dialog; screenshots per section', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    acceptNativeDialogs(page);
    await loginAs(page, 'admin');
    const nav = sectionNav(page);

    // -- 390: one-row chip strip that scrolls; the toolbar wraps; nothing overflows the page ---
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, editor(EXCL, 'description'));
    await expect(activeLink(page)).toHaveText('Description');
    await expect(activeLink(page)).toHaveAttribute('aria-current', 'page');
    const chips = await nav.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      rows: new Set(Array.from(el.querySelectorAll('a')).map((a) => a.offsetTop)).size,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(chips.scrollWidth, 'the chip row scrolls').toBeGreaterThan(chips.clientWidth);
    expect(chips.rows, 'the chips never wrap').toBe(1);
    expect(chips.pageWidth, 'no horizontal page overflow').toBeLessThanOrEqual(390);
    const bar = toolbar(page);
    const buttons = bar.getByRole('button');
    await expect(buttons).toHaveCount(13);
    for (let i = 0; i < 13; i += 1) await expect(buttons.nth(i)).toBeVisible();
    const strip = await bar.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      rows: new Set(Array.from(el.querySelectorAll('button')).map((b) => b.offsetTop)).size,
    }));
    expect(strip.scrollWidth, 'the toolbar never scrolls').toBeLessThanOrEqual(strip.clientWidth);
    expect(strip.rows, 'the toolbar wraps').toBeGreaterThan(1);
    // Wrapped rows start on the same x: on touch the group gap is 8px, so the separator's
    // push-back margin is 0 — otherwise every group after the first sits 4px right.
    const rowStarts = await bar.evaluate((el) => {
      const firstByRow = new Map<number, number>();
      for (const button of Array.from(el.querySelectorAll('button'))) {
        const box = button.getBoundingClientRect();
        const row = Math.round(box.top);
        firstByRow.set(row, Math.min(firstByRow.get(row) ?? Infinity, Math.round(box.left)));
      }
      return [...firstByRow.values()];
    });
    expect(new Set(rowStarts).size, 'wrapped toolbar rows start on the same x').toBe(1);
    // Touch spacing (below 900px or a coarse pointer): buttons sit 8px apart, so every button owns
    // a full 44×44 target — 3px outside ANY side of its 36px box still resolves to that button,
    // on both wrapped rows (03 C-24; ADR-0040 D12).
    await bar.scrollIntoViewIfNeeded();
    expect(
      await hitTargets(page, 'touch'),
      'a 44×44 target on every toolbar button at 390',
    ).toEqual(Array(13).fill(true));

    // -- 390, UNSAVED: the dot + the visually-hidden "Unsaved changes" label ride inside a chip
    // far along the row (Listings = 5th). The label is absolutely positioned, so the chip must
    // be its containing block or it escapes the scrolling row and widens the page (AC5).
    const activeChipInView = () =>
      nav.evaluate((el) => {
        const chip = el.querySelector('a[aria-current="page"]');
        if (!chip) return false;
        const row = el.getBoundingClientRect();
        const box = chip.getBoundingClientRect();
        return box.left >= row.left && box.right <= row.right;
      });
    // The island remounts per section, so the row would start at its left edge: the active chip
    // of a late section is scrolled into view on mount.
    await open(page, editor(EXCL, 'publish'));
    await expect.poll(activeChipInView, { message: 'the Publish chip is in view' }).toBe(true);
    // The LAST chip's focus ring (3px + 2px offset, 03 C-25) needs 5px between the chip and the
    // row's clip edge at the scrolled end — the row adds no end padding of its own.
    await nav.getByRole('link', { name: 'Publish' }).focus();
    const ringRoom = await nav.evaluate((el) => {
      const chip = el.querySelector('li:last-child a');
      return chip ? el.getBoundingClientRect().right - chip.getBoundingClientRect().right : -1;
    });
    expect(ringRoom, "room for the last chip's focus ring").toBeGreaterThanOrEqual(5);
    await open(page, editor(EXCL, 'listings'));
    await expect.poll(activeChipInView, { message: 'the Listings chip is in view' }).toBe(true);
    const curseforge = page.getByLabel('CurseForge id or URL');
    const curseforgeSeed = await curseforge.inputValue();
    await curseforge.fill(`${curseforgeSeed}9`);
    await expect(dirtyRoot(page)).toHaveCount(1);
    await expect(activeLink(page)).toContainText('Unsaved changes');
    const dirtyPageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(dirtyPageWidth, 'no horizontal page overflow while unsaved').toBeLessThanOrEqual(390);
    await curseforge.fill(curseforgeSeed);
    await expect(dirtyRoot(page)).toHaveCount(0);

    // -- 1280: the 220px sidebar column beside the section ----------------------------------
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, editor(EXCL, 'description'));
    const sidebar = await nav.boundingBox();
    expect(Math.round(sidebar?.width ?? 0)).toBe(220);
    // Mouse spacing (≥900px, fine pointer): the designed 4px pitch stays, so each button answers
    // 3px above / below its 36px box and 3px past a group's outer side (the `::after`, never the
    // strip), while in-group neighbours split their 4px gap evenly — 1px outside is this button,
    // 3px outside is the neighbour (the accepted 40px-wide target — 03 C-24; ADR-0040 D12).
    expect(
      await hitTargets(page, 'mouse'),
      'every toolbar button owns its hit target at 1280',
    ).toEqual(Array(13).fill(true));

    // -- axe + screenshots: every section of both rows at both widths, the dialog once each ---
    for (const width of [1280, 390] as const) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      for (const [id, sections, prefix, branch] of [
        [EXCL, EXCL_SECTIONS, 'admin-project', 'odsens'],
        [PIXEL, SYNCED_SECTIONS, 'admin-project-synced', 'modrinth'],
      ] as const) {
        for (const section of sections) {
          await open(page, editor(id, section));
          await expect(activeLink(page)).toHaveAttribute('href', editor(id, section));
          await expectOnlySection(page, branch, section);
          await expectNoSeriousA11y(page);
          await shoot(page, `${prefix}-${section}`);
        }
      }
      await open(page, editor(EXCL, 'general'));
      await page.getByLabel('Title', { exact: true }).fill(TITLE_EDIT);
      await nav.getByRole('link', { name: 'Gallery' }).click();
      await expect(leaveDialog(page)).toBeVisible();
      await expectNoSeriousA11y(page);
      await shoot(page, 'admin-project-dialog');
      await leaveDialog(page).getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(leaveDialog(page)).toBeHidden();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-57 — moderator: every section navigable, axe at both widths, the editor disabled
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-57 moderator: axe zero serious/critical at 1280 + 390 on every section of both rows; the Body textarea, every toolbar button and Save disabled "Admin only" while the Preview switch still flips and the section links still navigate', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await loginAs(page, 'mod');
    const nav = sectionNav(page);

    for (const width of [1280, 390] as const) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      for (const [id, sections, branch] of [
        [EXCL, EXCL_SECTIONS, 'odsens'],
        [PIXEL, SYNCED_SECTIONS, 'modrinth'],
      ] as const) {
        for (const section of sections) {
          await open(page, editor(id, section));
          await expect(activeLink(page)).toHaveAttribute('href', editor(id, section));
          await expectOnlySection(page, branch, section);
          await expectNoSeriousA11y(page);
        }
      }
    }

    // The Description section: disabled controls, never hidden (03 §2.10; ADR-0040 D5).
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, editor(EXCL, 'description'));
    const textarea = bodyField(page);
    await expect(textarea).toBeDisabled();
    await expect(textarea).toHaveAttribute('title', ADMIN_ONLY);
    await expect(textarea).toHaveValue(seedBody);
    const buttons = toolbar(page).getByRole('button');
    await expect(buttons).toHaveCount(13);
    for (let i = 0; i < 13; i += 1) {
      await expect(buttons.nth(i)).toBeDisabled();
      await expect(buttons.nth(i)).toHaveAttribute('title', ADMIN_ONLY);
    }
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();
    expect(await save.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(true);
    const preview = toggleFor(page, 'Preview');
    await expect(preview.input).toBeEnabled();
    await preview.label.click({ force: true });
    await expect(preview.input).toBeChecked();
    const pane = page.getByTestId('markdown-preview');
    await expect(pane.locator('[data-variant="about"] h2')).toHaveText('About the pack');
    await preview.label.click({ force: true });
    await expect(preview.input).not.toBeChecked();
    await expect(pane).toHaveCount(0);
    // Nothing posts from a moderator's page; the section links still navigate (S1.5c.AC6).
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });
    await nav.getByRole('link', { name: 'Gallery' }).click();
    await expect(page).toHaveURL(editor(EXCL, 'gallery'));
    await expectOnlySection(page, 'odsens', 'gallery');
    expect(posts).toEqual([]);
    await logout(page);
  });
});

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
    // Loaders are a CheckGrid of square boxes (ADR-0035 D4), scoped to the file well's group.
    // The native box is visually hidden (the square is the visible part): click its label, like
    // `toggleFor` does, then assert the input.
    const loaders = versions.getByRole('group', { name: 'Loaders' });
    await loaders.getByText('Datapack', { exact: true }).click();
    await expect(loaders.getByLabel('Datapack')).toBeChecked();
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
    // Type is the themed listbox (ADR-0035 D1): open the combobox, pick the option.
    await page.getByLabel('Type', { exact: true }).click();
    await page.getByRole('option', { name: 'Datapack' }).click();
    await expect(page.getByLabel('Type', { exact: true })).toHaveText('Datapack');
    const loaderGrid = page.getByRole('group', { name: 'Loaders' });
    await loaderGrid.getByText('Datapack', { exact: true }).click(); // label click — the box is visually hidden
    await expect(loaderGrid.getByLabel('Datapack')).toBeChecked();
    await page.getByLabel('Game versions').fill('1.21');

    await page.getByRole('button', { name: 'Create draft', exact: true }).click();
    // ok → redirect to the edit page — the uploads live there (data-model §6; page header).
    await page.waitForURL(UUID_TAIL);
    const id = page.url().split('/').pop();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    createdProjectId = id;

    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
    // S1.5c (ADR-0039 D2): the landing renders General; the state sentence is the PUBLISH section.
    await page.goto(`/admin/projects/${id}?section=publish`);
    await expect(page.getByText('This project is a draft. Nobody sees it.')).toBeVisible();
  });

  // ---------------------------------------------------------------------------------------------
  // T-E2E-35 — UploadWell states + the exact error copy (client pre-check, zero POSTs)
  // ---------------------------------------------------------------------------------------------

  test('T-E2E-35 UploadWell: idle + limits, dragover "Let go.", oversize and wrong-type copy', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    // S1.5c (ADR-0039 D2): the icon well is on `?section=gallery`, the file well on
    // `?section=versions`.
    await page.goto(`/admin/projects/${projectId()}?section=gallery`);
    const { icon, versions } = sections(page);
    const iconWell = icon.locator('[data-state]');
    const fileWell = versions.locator('[data-state]');

    // Idle copy + the always-visible limits lines (03 §2.10; computed from UPLOAD_KINDS — 04 U4).
    await expect(iconWell).toHaveAttribute('data-state', 'idle');
    await expect(iconWell.getByText('Drop a file here')).toBeVisible();
    await expect(iconWell.getByText('or pick one')).toBeVisible();
    await expect(iconWell.getByText('png · jpg · webp · 5 MB per image')).toBeVisible();

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
    await page.goto(`/admin/projects/${projectId()}?section=versions`);
    await expect(fileWell.getByText('.jar .zip .mrpack · 100 MB max')).toBeVisible();
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
    // S1.5c (ADR-0039 D2): Publish on `?section=publish` (the PRG lands back there, error and
    // all), the icon well on `?section=gallery`, the file well on `?section=versions`.
    const PUBLISH = `/admin/projects/${projectId()}?section=publish`;
    await page.goto(PUBLISH);
    const { publish, icon, versions } = sections(page);

    // Publish before anything is uploaded: precondition_failed lists BOTH gaps (ADR-0002 #65).
    await submitAndWait(page, 'Publish');
    await expect(page).toHaveURL(/section=publish&form=publish/);
    await expect(publish.getByRole('alert')).toHaveText(PRECONDITION_MESSAGE);

    // Icon upload (two-phase begin → signed PUT → commit against local Storage — 04 §1.4.5). The
    // transient `uploading` percent/progressbar is not raced here (see file header): `done` is the
    // contract — ✔ + name + size — then router.refresh() shows the committed icon server-side.
    await page.goto(`/admin/projects/${projectId()}?section=gallery`);
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
    await page.goto(`/admin/projects/${projectId()}?section=versions`);
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
    await page.goto(PUBLISH);
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
    for (const label of ['Slug', 'Title', 'Description', 'Type', 'Game versions']) {
      await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
    }
    // Loaders CheckGrid (ADR-0035 D4): the fieldset is disabled, so every box is.
    for (const box of await page
      .getByRole('group', { name: 'Loaders' })
      .getByRole('checkbox')
      .all()) {
      await expect(box).toBeDisabled();
    }
    const create = page.getByRole('button', { name: 'Create draft', exact: true });
    await expect(create).toBeDisabled();
    expect(await create.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(true);

    // The exclusive editor (readable: the project is LIVE — a draft would 404 for mod, T-RLS-18).
    // S1.5c (ADR-0039 D2 / 00 S1.5c.AC6): the moderator visits each section it asserts — the
    // section links are never disabled.
    await page.goto(`/admin/projects/${projectId()}?section=publish`);
    const { details, versions } = sections(page);
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

    // PUBLISH: Hide + Back to draft disabled under the title wrap.
    for (const name of ['Hide', 'Back to draft']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeDisabled();
      expect(await button.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(true);
    }

    // GENERAL: the comments Toggle disabled; DETAILS fields + Save disabled (scoped — 'Game
    // versions'/'Loaders' repeat in the file well).
    await page.goto(`/admin/projects/${projectId()}?section=general`);
    await expect(page.locator(`input[aria-label="Comments on ${TITLE}"]`)).toBeDisabled();
    for (const label of ['Slug', 'Title', 'Description', 'Game versions']) {
      await expect(details.getByLabel(label, { exact: true })).toBeDisabled();
    }
    for (const box of await details
      .getByRole('group', { name: 'Loaders' })
      .getByRole('checkbox')
      .all()) {
      await expect(box).toBeDisabled();
    }
    const save = details.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();
    expect(await save.evaluate((el) => el.closest('[title="Admin only"]') !== null)).toBe(true);

    // Wells (icon + gallery on GALLERY, file on VERSIONS): inert but present — aria-disabled +
    // title, inputs disabled.
    const wells = page.locator('[data-state][aria-disabled="true"][title="Admin only"]');
    const fileInputs = page.locator('input[type="file"]');
    for (const [section, count] of [
      ['gallery', 2],
      ['versions', 1],
    ] as const) {
      await page.goto(`/admin/projects/${projectId()}?section=${section}`);
      await expect(wells).toHaveCount(count);
      await expect(fileInputs).toHaveCount(count);
      for (let i = 0; i < count; i += 1) {
        await expect(fileInputs.nth(i)).toBeDisabled();
      }
    }

    // ProjectFileWell version fields ride the same flag.
    for (const label of ['Version number', 'Game versions', 'Changelog']) {
      await expect(versions.getByLabel(label, { exact: true })).toBeDisabled();
    }
    for (const box of await versions
      .getByRole('group', { name: 'Loaders' })
      .getByRole('checkbox')
      .all()) {
      await expect(box).toBeDisabled();
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
    await page.goto(`/admin/projects/${projectId()}?section=publish`);

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

  // ---------------------------------------------------------------------------------------------
  // T-E2E-11 (Settings leg; 00 S1.5b.AC1; 04 §5.7) — `/support` follows `site_settings.kofi_page`
  // through `revalidateTag('settings')`: a new name moves the ghost link; an EMPTY name closes tips
  // ("Tips open soon.", TIP ON KO-FI disabled, no ghost link, no panel); restoring reopens them.
  // Lives here because it writes `site_settings` (the T-E2E-35 serial-file reason); the public
  // page's own assertions are tests/e2e/smoke/support.spec.ts.
  // ---------------------------------------------------------------------------------------------
  test('T-E2E-11 Settings → /support: renamed page moves the link; empty page → "Tips open soon." + disabled button; restore reopens', async ({
    page,
  }) => {
    await loginAs(page, 'admin');

    async function setKofiPage(value: string): Promise<void> {
      await page.goto('/admin/settings');
      await page.getByLabel('Page name').fill(value);
      await saveAndWait(page);
    }

    const out = page.getByRole('link', { name: /on Ko-fi/ });
    const proceed = page.getByRole('button', { name: 'TIP ON KO-FI', exact: true });

    /**
     * `revalidateTag('settings', 'max')` is stale-while-revalidate: the first request after a save
     * can still serve the old page while the entry regenerates — re-navigate until it holds.
     */
    async function expectSupport(assert: () => Promise<void>): Promise<void> {
      await expect(async () => {
        await page.goto('/support');
        await assert();
      }).toPass({ timeout: 20_000, intervals: [400, 800, 1_600] });
    }

    await setKofiPage('oddsense-e2e');
    await expectSupport(async () => {
      await expect(out).toHaveAttribute('href', 'https://ko-fi.com/oddsense-e2e', {
        timeout: 1_000,
      });
    });

    await setKofiPage('');
    expect((await readSettings()).kofi_page ?? '').toBe('');
    await expectSupport(async () => {
      await expect(page.getByText('Tips open soon.', { exact: true })).toBeVisible({
        timeout: 1_000,
      });
    });
    await expect(proceed).toBeDisabled();
    await expect(out).toHaveCount(0);
    await expect(page.getByText('KO-FI PANEL LOADS HERE')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    // The rest of the page is unchanged: pays-for + the empty leaderboard still render.
    await expect(page.getByRole('heading', { name: 'What it pays for' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'NOBODY YET' })).toBeVisible();
    await expectNoSeriousA11y(page);
    await shoot(page, 'support-tips-closed');

    await setKofiPage('oddsense');
    expect((await readSettings()).kofi_page).toBe('oddsense');
    await expectSupport(async () => {
      await expect(proceed).toBeEnabled({ timeout: 1_000 });
    });
    await expect(out).toHaveAttribute('href', 'https://ko-fi.com/oddsense');
    await expect(page.getByText('Tips open soon.')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------
// T-E2E-47 (S1.6; 00 S1.6.AC7 + AC8; recipe per ADR-0043 D9) — the `/admin` videos list and the
// public empty state. A service-side truncate never revalidates the ISR pages (FLK-4 forbids
// waiting the 600 s out), so the empty state is reached the way Oliver would reach it: the admin
// hides every visible video through the `/admin` Hidden toggles — each flip is ONE `updateVideo`
// call → `revalidateTag('videos')` — and the pages are polled (re-navigation, never a sleep). The
// page logic keys on zero VISIBLE rows; the literally empty list is the unit arm
// `splitVideos([])` (tests/unit/videos.test.ts). Un-hides exactly the rows it hid — the seed's
// own hidden row `seedvid0002` stays hidden — and polls both pages back to seed truth.
// `mutatesSeed`, restored: through the same action on the happy path; `afterAll` repairs a failed
// run (service client for the rows — cleanup only — then the app's own revalidation for the ISR
// entries, the `repairThreadCache` reasoning: `next start` keeps them on disk for the next run).
// ---------------------------------------------------------------------------------------------
test.describe('videos on /admin + the public empty state (S1.6 — ADR-0043 D9)', () => {
  const HIDDEN_SEED = SEED_VIDEOS.hiddenLong.youtubeId; // seedvid0002 — hidden on seed, stays so
  const SHORT_SEED = SEED_VIDEOS.short.youtubeId; // seedvid0003 — the one `is_short` row
  const SEED_VIDEO_IDS: readonly string[] = Object.values(SEED_VIDEOS).map((v) => v.youtubeId);
  const CHANNEL = 'https://www.youtube.com/@OdSens';
  const EMPTY_TITLE = 'NO VIDEOS YET';
  const EMPTY_LINE = "They'll show up here when they exist.";

  type VideoRow = {
    youtube_id: string;
    title: string;
    hidden: boolean;
    is_short: boolean;
    is_short_override: boolean | null;
  };

  /** Set once the admin test has un-hidden everything AND seen both pages back on seed truth. */
  let restoredThroughApp = false;
  /** Set when the admin test starts flipping — until then the caches were never touched. */
  let mutated = false;

  function service() {
    return loose(asRole('service'));
  }

  /** Every seed video, newest first (the `/admin` list order). */
  async function readVideos(): Promise<VideoRow[]> {
    const { data, error } = await service()
      .from('videos')
      .select('youtube_id, title, hidden, is_short, is_short_override')
      .in('youtube_id', [...SEED_VIDEO_IDS])
      .order('published_at', { ascending: false });
    expect(error).toBeNull();
    return (data ?? []) as VideoRow[];
  }

  function videoList(page: Page) {
    return page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: /^VIDEOS/ }),
    });
  }

  /** One Hidden flip = one `updateVideo` call + PRG; waits until the re-render shows `want`. */
  async function setHidden(page: Page, title: string, want: boolean): Promise<void> {
    await page.goto('/admin');
    const { input, label } = toggleFor(page, `Hide ${title}`);
    if (want) await expect(input).not.toBeChecked();
    else await expect(input).toBeChecked();
    await label.click();
    if (want) await expect(input).toBeChecked({ timeout: 10_000 });
    else await expect(input).not.toBeChecked({ timeout: 10_000 });
  }

  /**
   * Two more `revalidateTag('videos')` calls that leave seed truth behind: the Short override ON
   * and back to "Auto" on the hidden seed row (hidden → the public pages never show it either
   * way; `is_short: null` hands `seedvid0002` back to the heuristic = false, override NULL).
   */
  async function nudgeVideosTag(page: Page, hiddenTitle: string): Promise<void> {
    await page.goto('/admin');
    const short = toggleFor(page, `Mark ${hiddenTitle} as a Short`);
    const auto = videoList(page).getByRole('button', { name: /^Auto/ });
    await expect(short.input).not.toBeChecked();
    await expect(auto).toHaveCount(0);
    await short.label.click();
    await expect(short.input).toBeChecked({ timeout: 10_000 });
    await expect(auto).toHaveCount(1);
    await page.goto('/admin');
    await auto.click();
    await expect(short.input).not.toBeChecked({ timeout: 10_000 });
    await expect(auto).toHaveCount(0);
  }

  /**
   * `expectAtUrl` with the `repairThreadCache` cycle: `revalidateTag(…, 'max')` is
   * stale-while-revalidate twice over (the page entry AND the `unstable_cache` data entry —
   * tests/helpers/threadCache.ts), so the regeneration after the LAST flip can bake the previous
   * list for another 600 s. When the re-navigation poll runs dry, revalidate again through the
   * app (`nudgeVideosTag`) and poll again — never a fixed sleep (FLK-4).
   */
  async function expectVideosAtUrl(
    page: Page,
    url: string,
    hiddenTitle: string,
    assert: () => Promise<void>,
  ): Promise<void> {
    for (let cycle = 0; ; cycle += 1) {
      try {
        await expect(async () => {
          await page.goto(url);
          await assert();
        }).toPass({ timeout: 8_000, intervals: [400, 800, 1_600] });
        return;
      } catch (error) {
        if (cycle === 3) throw error;
        await nudgeVideosTag(page, hiddenTitle);
      }
    }
  }

  /** `/videos` on seed truth: hero = seedvid0001, 4 Up next rows, the one grid card, the one Short. */
  async function expectSeedVideosPage(page: Page): Promise<void> {
    const quick = { timeout: 1_000 };
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('VIDEOS', quick);
    await expect(page.getByRole('heading', { name: EMPTY_TITLE })).toHaveCount(0, quick);
    await expect(
      page.getByRole('button', { name: /^Play Seed Long Video One/ }).first(),
    ).toBeVisible(quick);
    const more = page.locator('section[aria-labelledby="section-title-more-videos"]');
    await expect(more.getByRole('heading', { level: 3 })).toHaveText(
      'Seed Long Video Seven',
      quick,
    );
    await expect(page.getByRole('button', { name: /^Play Seed Short: Pipe Bonk/ })).toHaveCount(
      1,
      quick,
    );
    for (const title of ['Seed Long Video Four', 'Seed Long Video Six']) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible(quick);
    }
    expect(await page.content()).not.toContain(HIDDEN_SEED);
    await expect(page.locator('iframe')).toHaveCount(0);
  }

  /** Home on seed truth: the 2-up = seedvid0001 + seedvid0004. */
  async function expectSeedHome(page: Page): Promise<void> {
    const latest = page.locator('section[aria-labelledby="latest-videos"]');
    const cards = latest.locator('article[data-variant="home"]');
    await expect(cards).toHaveCount(2, { timeout: 1_000 });
    await expect(cards.nth(0).getByRole('heading', { level: 3 })).toHaveText(
      'Seed Long Video One',
      { timeout: 1_000 },
    );
    await expect(cards.nth(1).getByRole('heading', { level: 3 })).toHaveText(
      'Seed Long Video Four',
      { timeout: 1_000 },
    );
    expect(await page.content()).not.toContain(HIDDEN_SEED);
  }

  test.beforeAll(() => {
    loadEnvTest();
  });

  test.afterAll(async ({ browser }) => {
    if (!mutated || restoredThroughApp) return;
    // A failed run. Rows first (service client — cleanup only): SEED-11 truth is `seedvid0002`
    // hidden, `seedvid0003` the one Short, no override anywhere.
    for (const youtubeId of SEED_VIDEO_IDS) {
      const { error } = await service()
        .from('videos')
        .update({
          hidden: youtubeId === HIDDEN_SEED,
          is_short: youtubeId === SHORT_SEED,
          is_short_override: null,
        })
        .eq('youtube_id', youtubeId);
      expect(error).toBeNull();
    }
    // Then the ISR entries, through the app's own revalidation (a service write revalidates
    // nothing), in a fresh admin context since afterAll has no page.
    const hiddenTitle = (await readVideos()).find((v) => v.youtube_id === HIDDEN_SEED)?.title ?? '';
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginAs(page, 'admin');
      await nudgeVideosTag(page, hiddenTitle);
      await expectVideosAtUrl(page, '/videos', hiddenTitle, () => expectSeedVideosPage(page));
      await expectVideosAtUrl(page, '/', hiddenTitle, () => expectSeedHome(page));
    } finally {
      await context.close();
    }
  });

  test('T-E2E-47 moderator: the /admin VIDEOS list shows Hidden + Short toggles disabled under title="Admin only"; a click sends no POST and writes nothing (AC7)', async ({
    page,
  }) => {
    const before = await readVideos();
    expect(before.map((v) => v.youtube_id).sort()).toEqual([...SEED_VIDEO_IDS].sort());
    const visible = before.filter((v) => !v.hidden);
    expect(visible).toHaveLength(6);

    await loginAs(page, 'mod');
    await page.goto('/admin');
    const list = videoList(page);
    await expect(list.getByRole('heading', { level: 2 })).toHaveText(/^VIDEOS/);

    // The RLS-filtered read (05 T-RLS-49: a moderator never reads a hidden video): six LIVE rows,
    // the hidden seed row is nowhere in the document.
    await expect(list.locator('tbody tr')).toHaveCount(6);
    await expect(list.getByText('LIVE', { exact: true })).toHaveCount(6);
    await expect(list.getByText('HIDDEN', { exact: true })).toHaveCount(0);
    expect(await page.content()).not.toContain(HIDDEN_SEED);

    // Both toggles on every row: present, disabled, under title="Admin only" (03 §2.10) — never
    // absent. No row carries an override on seed, so no "Auto" button renders.
    for (const video of visible) {
      for (const label of [`Hide ${video.title}`, `Mark ${video.title} as a Short`]) {
        const { input, label: wrapper } = toggleFor(page, label);
        await expect(input).toHaveCount(1);
        await expect(input).toBeDisabled();
        expect(
          await wrapper.evaluate((el) => el.closest('[title="Admin only"]') !== null),
          `${label} sits under title="${ADMIN_ONLY}"`,
        ).toBe(true);
      }
    }
    await expect(list.getByRole('button', { name: /^Auto/ })).toHaveCount(0);
    const shortSeed = visible.find((v) => v.youtube_id === SHORT_SEED);
    await expect(toggleFor(page, `Mark ${shortSeed?.title ?? ''} as a Short`).input).toBeChecked();

    // Clicking a disabled control issues no action call and no forbidden toast (02 §1.3). A
    // server-action POST leaves in the click's own task, so two painted frames bound the wait;
    // the stored rows are the second witness.
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });
    const first = visible[0];
    await toggleFor(page, `Hide ${first?.title ?? ''}`).label.click({ force: true });
    await toggleFor(page, `Mark ${first?.title ?? ''} as a Short`).label.click({ force: true });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    expect(posts, 'no server-action POST left the page').toEqual([]);
    await expect(page.getByText('Not allowed.')).toHaveCount(0);
    await expect(page.getByText('Saved.', { exact: true })).toHaveCount(0);
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
    expect(await readVideos()).toEqual(before);
  });

  test('T-E2E-47 admin: hiding every visible video through the /admin Hidden toggles empties /videos and the Home column ("NO VIDEOS YET" + channel link, zero iframe — AC8); un-hiding restores both', async ({
    page,
  }) => {
    // Twelve action round trips + four polled public pages (each may need a revalidation cycle).
    test.setTimeout(240_000);
    const seed = await readVideos();
    const hiddenTitle = seed.find((v) => v.youtube_id === HIDDEN_SEED)?.title ?? '';
    const toHide = seed.filter((v) => !v.hidden);
    expect(toHide.map((v) => v.youtube_id)).not.toContain(HIDDEN_SEED);
    expect(toHide).toHaveLength(6);

    await loginAs(page, 'admin');
    await page.goto('/admin');
    const list = videoList(page);
    // The admin reads every row: 7, one of them HIDDEN (seedvid0002, newest first → row 1).
    await expect(list.locator('tbody tr')).toHaveCount(7);
    await expect(list.getByText('7 TOTAL', { exact: true })).toBeVisible();
    await expect(list.getByText('HIDDEN', { exact: true })).toHaveCount(1);
    await expect(list.getByText('LIVE', { exact: true })).toHaveCount(6);
    await expect(list.locator('tbody tr').first()).toContainText(hiddenTitle);

    // -- Hide all six, one `updateVideo` each; the first flip also proves the "Saved." PRG -------
    mutated = true;
    for (const [i, video] of toHide.entries()) {
      await setHidden(page, video.title, true);
      if (i === 0) await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    }
    await expect(list.getByText('HIDDEN', { exact: true })).toHaveCount(7);
    await expect(list.getByText('LIVE', { exact: true })).toHaveCount(0);
    expect((await readVideos()).every((v) => v.hidden)).toBe(true);

    // -- /videos: the §11.7 empty state, strings verbatim (03 G-05), channel link, no iframe -----
    await expectVideosAtUrl(page, '/videos', hiddenTitle, async () => {
      await expect(page.getByRole('heading', { level: 2, name: EMPTY_TITLE })).toBeVisible({
        timeout: 1_000,
      });
    });
    await expect(page).toHaveTitle('Videos — odsens');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('VIDEOS');
    await expect(page.getByText(EMPTY_LINE, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'The YouTube channel' })).toHaveAttribute(
      'href',
      CHANNEL,
    );
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Play / })).toHaveCount(0);
    const emptyHtml = await page.content();
    for (const youtubeId of SEED_VIDEO_IDS) expect(emptyHtml).not.toContain(youtubeId);
    await expectNoSeriousA11y(page);
    await shoot(page, 'videos-empty');

    // -- Home: the same empty state inside the Latest videos column; the side column still renders
    const latest = page.locator('section[aria-labelledby="latest-videos"]');
    await expectVideosAtUrl(page, '/', hiddenTitle, async () => {
      await expect(latest.getByRole('heading', { level: 3, name: EMPTY_TITLE })).toBeVisible({
        timeout: 1_000,
      });
    });
    await expect(latest.getByText(EMPTY_LINE, { exact: true })).toBeVisible();
    await expect(latest.getByRole('link', { name: 'The YouTube channel' })).toHaveAttribute(
      'href',
      CHANNEL,
    );
    await expect(latest.locator('article')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 2, name: 'FIND ME', exact: true }),
    ).toBeVisible();
    await expect(page.locator('aside[aria-label="Support"][data-compact]')).toHaveCount(1);
    await expectNoSeriousA11y(page);
    await shoot(page, 'home-videos-empty');

    // -- Un-hide exactly the rows this test hid (seedvid0002 stays hidden), same action ----------
    for (const video of toHide) await setHidden(page, video.title, false);
    await expect(list.getByText('HIDDEN', { exact: true })).toHaveCount(1);
    await expect(list.getByText('LIVE', { exact: true })).toHaveCount(6);
    expect(await readVideos()).toEqual(seed);

    await expectVideosAtUrl(page, '/videos', hiddenTitle, () => expectSeedVideosPage(page));
    await expectVideosAtUrl(page, '/', hiddenTitle, () => expectSeedHome(page));
    expect(await readVideos()).toEqual(seed); // a nudge cycle leaves seed truth behind too
    restoredThroughApp = true;
  });
});

// ---------------------------------------------------------------------------------------------
// T-E2E-39 (S1.8; 00 S1.8.AC1 / AC2 / AC4 / AC5 / AC8 / AC10; 02 §1.3 `/admin/mentions`; 03 §2.8
// `MentionPreview`, §2.10 `ReorderableList`; ADR-0002 C7 / #33 / #73; ADR-0045) — curating Seen on.
// Same recipe as T-E2E-47 (FLK-3 / FLK-4): every public effect is reached the way Oliver reaches
// it — `createMention` / `updateMention` through the page, each of which calls
// `revalidateTag('mentions')` (+ the project's tag) — and the ISR pages are polled by
// re-navigation, never slept on; a dry poll revalidates again through the app (`nudgeMentionsTag`:
// Hide → Show on the seed TikTok row, which leaves seed truth behind). There is no delete action
// (01 INV-24), so the two rows this test creates are HIDDEN through the UI, the three public pages
// polled back to seed truth, and only then removed with the service client (cleanup only — a
// hidden row is on no public page, so its removal needs no revalidation). `mutatesSeed` (the
// reorder rewrites `…0301.sort_order`, the nudge flips `…0302.status`), restored through the same
// actions; `afterAll` repairs a failed run (rows by service, then the app's own revalidation in a
// fresh context — the `repairThreadCache` reasoning: `next start` keeps ISR entries on disk).
//
// The pasted link is answered by the :4010 fixture server (`OEMBED_BASE` → `youtube/oembed.json` =
// title + creator; `YOUTUBE_API_BASE` `videos?id=seedvid0009` → `youtube/videos/seedvid0009.json` =
// views + date — ADR-0045 D8; step 2 wins the title, step 3 fills views + date, 04 §5.4).
// The unreadable link is `http://127.0.0.1:4010/x`: the SSRF guard refuses loopback before any
// request leaves (04 §4.4), which is exactly the "couldn't read it" path — deterministic, offline.
// ---------------------------------------------------------------------------------------------
test.describe('mentions on /admin/mentions (S1.8 — T-E2E-39)', () => {
  const SEED_YOUTUBE_TITLE = 'Metal Pipe Mace is the loudest mod I have ever installed';
  const SEED_TIKTOK_TITLE = 'this mod makes no sense and I love it';
  const SEED_REACH = '1.2M VIEWS · 2 VIDEOS · 2 CREATORS';

  const PASTED_URL = 'https://www.youtube.com/watch?v=seedvid0009';
  const PASTED_ID = 'seedvid0009';
  // tests/fixtures/youtube/oembed.json (title, creator) + youtube/videos/seedvid0009.json
  // (viewCount 48213, publishedAt 2026-07-04T15:00:00Z).
  const PASTED_TITLE = 'I played every OdSens datapack at once';
  const PASTED_CREATOR = 'BlockBuddy';
  const PASTED_VIEWS = 48_213;
  const PASTED_VIEWS_LABEL = '48.2K VIEWS';
  const PASTED_DATE = '4 Jul 2026';

  const UNREADABLE_URL = 'http://127.0.0.1:4010/x';
  const MANUAL_URL = 'https://127.0.0.1:4010/x'; // as stored: http is upgraded (04 §1.6)
  const MANUAL_TITLE = 't_e2e39 a write-up nobody could fetch';
  const MANUAL_CREATOR = 't_e2e39 blog';
  const UNREADABLE_LINE = "Couldn't read that page. You can fill the fields by hand.";

  const TEST_URLS: readonly string[] = [PASTED_URL, MANUAL_URL];
  const COLUMNS =
    'id, url, platform, external_id, title, creator_name, thumbnail_url, status, source, featured, sort_order, view_count, project_id, created_by';

  type MentionRow = {
    id: string;
    url: string;
    platform: string;
    external_id: string | null;
    title: string;
    creator_name: string;
    thumbnail_url: string | null;
    status: string;
    source: string;
    featured: boolean;
    sort_order: number;
    view_count: number | null;
    project_id: string | null;
    created_by: string | null;
  };

  /** Set once both test rows are gone AND the three public pages were seen back on seed truth. */
  let restoredThroughApp = false;
  /** Set right before the first write — until then no row and no cache was touched. */
  let mutated = false;

  function service() {
    return loose(asRole('service'));
  }

  /** Every mention, seed rows first (`…0301`, `…0302`), then whatever this test created. */
  async function readMentions(): Promise<MentionRow[]> {
    const { data, error } = await service().from('mentions').select(COLUMNS).order('id');
    expect(error).toBeNull();
    const rows = (data ?? []) as MentionRow[];
    const seedIds: readonly string[] = Object.values(SEED_MENTIONS);
    return [
      ...rows.filter((row) => seedIds.includes(row.id)),
      ...rows.filter((row) => !seedIds.includes(row.id)),
    ];
  }

  async function readByUrl(url: string): Promise<MentionRow | undefined> {
    return (await readMentions()).find((row) => row.url === url);
  }

  /** Cleanup only (service client): the rows this test pastes — `mentions.url` is UNIQUE. */
  async function deleteTestRows(): Promise<void> {
    const { error } = await service()
      .from('mentions')
      .delete()
      .in('url', [...TEST_URLS]);
    expect(error).toBeNull();
  }

  function mentionList(page: Page) {
    return page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: /^ALL MENTIONS/ }),
    });
  }

  function tableRow(page: Page, title: string) {
    return mentionList(page).locator('tbody tr', { hasText: title });
  }

  function featuredOrder(page: Page) {
    return page.locator('ol[aria-label="Featured mentions"] li');
  }

  function addRegion(page: Page) {
    return page.getByRole('region', { name: 'Add a mention' });
  }

  /**
   * One worded row button = one `updateMention({id, patch})` + PRG; waits until the re-rendered row
   * offers `becomes` (Feature → Unfeature, Hide → Show, …), i.e. the stored state was read back.
   */
  async function rowAction(page: Page, word: string, title: string, becomes: string) {
    await page.goto('/admin/mentions');
    const row = tableRow(page, title);
    await row.getByRole('button', { name: `${word} ${title}`, exact: true }).click();
    await expect(row.getByRole('button', { name: `${becomes} ${title}`, exact: true })).toBeVisible(
      { timeout: 10_000 },
    );
  }

  /** Two `revalidateTag('mentions')` calls that leave seed truth behind (`…0302` stays published). */
  async function nudgeMentionsTag(page: Page): Promise<void> {
    await rowAction(page, 'Hide', SEED_TIKTOK_TITLE, 'Show');
    await rowAction(page, 'Show', SEED_TIKTOK_TITLE, 'Hide');
  }

  /**
   * `expectAtUrl` with the T-E2E-47 cycle: `revalidateTag(…, 'max')` is stale-while-revalidate
   * twice over (the page entry AND the `unstable_cache` reader), so the regeneration after the
   * LAST write can bake the previous list for another 600 s. When the re-navigation poll runs dry,
   * revalidate again through the app and poll again — never a fixed sleep (FLK-4).
   */
  async function expectMentionsAtUrl(
    page: Page,
    url: string,
    assert: () => Promise<void>,
  ): Promise<void> {
    for (let cycle = 0; ; cycle += 1) {
      try {
        await expect(async () => {
          await page.goto(url);
          await assert();
        }).toPass({ timeout: 8_000, intervals: [400, 800, 1_600] });
        return;
      } catch (error) {
        if (cycle === 3) throw error;
        await nudgeMentionsTag(page);
      }
    }
  }

  const quick = { timeout: 1_000 };

  /** Home: the IN THE WILD cards in order + the reach line (totals over every published mention). */
  async function expectHomeStrip(page: Page, titles: string[], reach: string): Promise<void> {
    const strip = page.locator('section[aria-labelledby="section-title-in-the-wild"]');
    await expect(strip.locator('article[data-variant] h3')).toHaveText(titles, quick);
    await expect(strip.getByText(reach, { exact: true })).toBeVisible(quick);
  }

  /** `/projects/metal-pipe-mace`: the SEEN ON count + its cards in order. */
  async function expectProjectRow(page: Page, titles: string[]): Promise<void> {
    const row = page.locator('section[aria-labelledby="section-title-seen-on"]');
    const count = titles.length === 1 ? '1 MENTION' : `${titles.length} MENTIONS`;
    await expect(row.getByText(count, { exact: true })).toBeVisible(quick);
    await expect(row.locator('article[data-variant] h3')).toHaveText(titles, quick);
  }

  /** `/seen-on`: the filter buttons (names with counts) + the cards in order. */
  async function expectSeenOn(page: Page, buttons: string[], titles: string[]): Promise<void> {
    const names = page.locator('[role="group"][aria-label="Filter"]').getByRole('link');
    await expect(names).toHaveText(buttons, quick);
    await expect(page.locator('main article[data-variant] h3')).toHaveText(titles, quick);
  }

  async function expectSeedEverywhere(page: Page): Promise<void> {
    await expectMentionsAtUrl(page, '/', () =>
      expectHomeStrip(page, [SEED_YOUTUBE_TITLE], SEED_REACH),
    );
    await expectMentionsAtUrl(page, '/projects/metal-pipe-mace', () =>
      expectProjectRow(page, [SEED_YOUTUBE_TITLE]),
    );
    await expectMentionsAtUrl(page, '/seen-on', () =>
      expectSeenOn(
        page,
        ['ALL 2', 'YOUTUBE 1', 'TIKTOK 1'],
        [SEED_YOUTUBE_TITLE, SEED_TIKTOK_TITLE],
      ),
    );
  }

  /** Waits for the ONE server-action POST a completed reorder sends (the glue has no redirect). */
  function reorderPost(page: Page) {
    return page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname === '/admin/mentions',
    );
  }

  async function featuredSortOrders(): Promise<Record<string, number>> {
    const rows = await readMentions();
    return Object.fromEntries(
      rows.filter((row) => row.featured).map((row) => [row.title, row.sort_order]),
    );
  }

  test.beforeAll(() => {
    loadEnvTest();
  });

  test.afterAll(async ({ browser }) => {
    if (!mutated || restoredThroughApp) return;
    // A failed run. Rows first (service client — cleanup only): the test rows go, SEED-10 truth
    // comes back (`…0301` featured at sort_order 1, both rows published).
    await deleteTestRows();
    const youtube = await service()
      .from('mentions')
      .update({ status: 'published', featured: true, sort_order: 1 })
      .eq('id', SEED_MENTIONS.youtube);
    expect(youtube.error).toBeNull();
    const tiktok = await service()
      .from('mentions')
      .update({ status: 'published', featured: false, sort_order: 2 })
      .eq('id', SEED_MENTIONS.tiktok);
    expect(tiktok.error).toBeNull();
    const runs = await service().from('sync_runs').delete().eq('source', 'mentions');
    expect(runs.error).toBeNull();
    // Then the ISR entries, through the app's own revalidation (a service write revalidates
    // nothing), in a fresh admin context since afterAll has no page.
    const context = await browser.newContext();
    // A bare context has none of `../fixtures`' routing: keep the optimizer from asking
    // `i.ytimg.com` for the seed thumbnails while the repair polls the public pages (H-10).
    await context.route('**/_next/image?**', (route) => route.abort());
    const page = await context.newPage();
    try {
      await loginAs(page, 'admin');
      await nudgeMentionsTag(page);
      await expectSeedEverywhere(page);
    } finally {
      await context.close();
    }
  });

  test('T-E2E-39 moderator: /admin/mentions shows paste, publish, reorder, Feature and Hide controls disabled under title="Admin only"; a click sends no POST and writes nothing', async ({
    page,
  }) => {
    const before = await readMentions();
    expect(before.map((row) => row.id)).toEqual([SEED_MENTIONS.youtube, SEED_MENTIONS.tiktok]);

    await loginAs(page, 'mod');
    await page.goto('/admin/mentions');
    await expect(page).toHaveTitle('Mentions · Admin');

    // The RLS-filtered read (05 T-RLS-102 / 103; ADR-0045 D24): published rows only — both seed
    // rows are, so the moderator sees FEATURED + LIVE and can never see HIDDEN / DRAFT.
    const list = mentionList(page);
    await expect(list.locator('tbody tr')).toHaveCount(2);
    await expect(list.getByText('FEATURED', { exact: true })).toHaveCount(1);
    await expect(list.getByText('LIVE', { exact: true })).toHaveCount(1);
    await expect(list.getByText('HIDDEN', { exact: true })).toHaveCount(0);

    const underAdminOnly = (el: Element) => el.closest('[title="Admin only"]') !== null;

    // The add-a-mention island: link field, Fetch, Assign to and PUBLISH — present, disabled,
    // under title="Admin only" (03 §2.10), with no <form> anywhere in it.
    const region = addRegion(page);
    await expect(region).toHaveAttribute('data-state', 'empty');
    const paste = [
      region.getByLabel('Link', { exact: true }),
      region.getByRole('button', { name: 'Fetch', exact: true }),
      region.getByLabel('Assign to', { exact: true }),
      region.getByRole('button', { name: 'PUBLISH', exact: true }),
    ];
    for (const control of paste) {
      await expect(control).toHaveCount(1);
      await expect(control).toBeDisabled();
      expect(await control.evaluate(underAdminOnly), `${ADMIN_ONLY} on the add controls`).toBe(
        true,
      );
    }
    await expect(region.locator('form')).toHaveCount(0);

    // Row actions: the same worded buttons an admin gets, disabled, no <form> around them.
    const rowButtons = [
      `Unfeature ${SEED_YOUTUBE_TITLE}`,
      `Hide ${SEED_YOUTUBE_TITLE}`,
      `Feature ${SEED_TIKTOK_TITLE}`,
      `Hide ${SEED_TIKTOK_TITLE}`,
    ].map((name) => list.getByRole('button', { name, exact: true }));
    for (const button of rowButtons) {
      await expect(button).toHaveCount(1);
      await expect(button).toBeDisabled();
      expect(await button.evaluate(underAdminOnly)).toBe(true);
    }
    await expect(list.locator('form')).toHaveCount(0);

    // Reorder: the ⠿ handle and both Move buttons — disabled + aria-disabled + the title itself.
    await expect(featuredOrder(page)).toHaveCount(1);
    const reorder = [
      `Move ${SEED_YOUTUBE_TITLE}`,
      `Move up ${SEED_YOUTUBE_TITLE}`,
      `Move down ${SEED_YOUTUBE_TITLE}`,
    ].map((name) => page.getByRole('button', { name, exact: true }));
    for (const button of reorder) {
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).toHaveAttribute('title', ADMIN_ONLY);
    }

    // SYNC: "Sync now" disabled the `SyncStatus` way.
    const sync = page.getByRole('button', { name: 'Sync now' });
    await expect(sync).toHaveCount(1);
    await expect(sync).toBeDisabled();
    expect(await sync.evaluate(underAdminOnly)).toBe(true);

    // Clicking a disabled control issues no action call and no forbidden toast (02 §1.3). A
    // server-action POST leaves in the click's own task, so two painted frames bound the wait;
    // the stored rows are the second witness.
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(req.url());
    });
    for (const control of [paste[1], paste[3], rowButtons[1], rowButtons[2], ...reorder, sync]) {
      await control?.click({ force: true });
    }
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    expect(posts, 'no server-action POST left the page').toEqual([]);
    await expect(page.getByText('Not allowed.')).toHaveCount(0);
    await expect(page.getByText('Saved.', { exact: true })).toHaveCount(0);
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
    expect(await readMentions()).toEqual(before);

    await expectNoSeriousA11y(page);
    await shoot(page, 'admin-mentions-moderator');

    // The Suggested view reads the same for a moderator: the stub, nothing to press.
    await page.goto('/admin/mentions?tab=suggested');
    await expect(page.getByRole('heading', { name: 'NOTHING SUGGESTED' })).toBeVisible();
    await expect(page.locator('main').getByRole('button')).toHaveCount(0);
  });

  test('T-E2E-39 admin: paste a YouTube link → preview (thumb, title, creator, views, date) → assign metal-pipe-mace → PUBLISH → SEEN ON count 2; FEATURED / LIVE / HIDDEN tags; Feature → Home strip; reorder by keyboard AND by the Move buttons flips the strip and survives a reload; Hide → gone from Home, the project page and /seen-on; an unreadable link → the error line + manual fields → PUBLISH; Suggested stub mutates nothing', async ({
    page,
    requests,
  }) => {
    // ~16 action round trips + ~14 polled public pages (each may need a revalidation cycle).
    test.setTimeout(300_000);
    await deleteTestRows(); // a leftover from a killed run would answer PUBLISH with `conflict`
    const seed = await readMentions();
    expect(seed.map((row) => row.id)).toEqual([SEED_MENTIONS.youtube, SEED_MENTIONS.tiktok]);
    expect(seed.map((row) => [row.status, row.featured, row.sort_order, row.view_count])).toEqual([
      ['published', true, 1, 1_200_000],
      ['published', false, 2, null],
    ]);

    await loginAs(page, 'admin');
    await page.goto('/admin/mentions');
    const list = mentionList(page);
    const region = addRegion(page);
    await expect(list.locator('tbody tr')).toHaveCount(2);
    await expect(list.getByText('2 TOTAL', { exact: true })).toBeVisible();
    await expect(
      tableRow(page, SEED_YOUTUBE_TITLE).getByText('FEATURED', { exact: true }),
    ).toBeVisible();
    await expect(
      tableRow(page, SEED_TIKTOK_TITLE).getByText('LIVE', { exact: true }),
    ).toBeVisible();
    await expect(tableRow(page, SEED_TIKTOK_TITLE)).toContainText('About OddSense');
    await expect(tableRow(page, SEED_YOUTUBE_TITLE)).toContainText('Metal Pipe Mace');
    await expect(tableRow(page, SEED_YOUTUBE_TITLE)).toContainText('1.2M');
    // The admin list asks no platform for a thumbnail — marks only (ADR-0002 #33).
    const listImages = await list
      .locator('img')
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src') ?? ''));
    for (const src of listImages) expect(src).toMatch(/^\/brand\/marks\//);
    await expect(featuredOrder(page)).toHaveCount(1);

    // -- Empty state: PUBLISH is there but disabled until there is something to publish ----------
    await expect(region).toHaveAttribute('data-state', 'empty');
    await expect(region.getByText('Paste a link above.', { exact: true })).toBeVisible();
    const publish = region.getByRole('button', { name: 'PUBLISH', exact: true });
    await expect(publish).toBeDisabled();

    // -- SYNC: "Sync now" runs `refreshMentions` against the fixture server (ADR-0045 D11). The
    // fixture answers `videos?id=seedvid0001` with strangers, so the seed count is untouched.
    mutated = true;
    const syncRow = page
      .locator('section', { has: page.getByRole('heading', { level: 2, name: 'SYNC' }) })
      .locator('tbody tr');
    await expect(syncRow).toHaveCount(1);
    await expect(syncRow).toContainText('Mentions');
    await syncRow.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText('Sync started.')).toBeVisible({ timeout: 30_000 });
    await expect(syncRow.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 15_000 });
    const run = await service()
      .from('sync_runs')
      .select('ok, finished_at, error')
      .eq('source', 'mentions')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();
    expect(run.error).toBeNull();
    expect(run.data?.ok).toBe(true);
    expect(run.data?.finished_at).not.toBeNull();
    expect((await readMentions())[0]?.view_count).toBe(1_200_000);

    // -- Paste → Fetch → the preview card, every field from the fixture server (AC1) -------------
    await page.goto('/admin/mentions');
    const link = region.getByLabel('Link', { exact: true });
    await link.fill(PASTED_URL);
    await region.getByRole('button', { name: 'Fetch', exact: true }).click();
    await expect(region).toHaveAttribute('data-state', 'preview', { timeout: 45_000 });
    await expect(region.getByText(PASTED_TITLE, { exact: true })).toBeVisible();
    await expect(region.getByText(`YouTube · ${PASTED_CREATOR}`)).toBeVisible();
    await expect(region.getByText(PASTED_VIEWS_LABEL, { exact: true })).toBeVisible();
    await expect(region.locator('time')).toHaveText(PASTED_DATE);
    await expect(region.locator('time')).toHaveAttribute('datetime', /^2026-07-04T15:00:00/);
    const previewThumb = region.locator('img[src^="/_next/image"]');
    await expect(previewThumb).toHaveCount(1);
    expect(decodeURIComponent((await previewThumb.getAttribute('src')) ?? '')).toContain(
      `https://i.ytimg.com/vi/${PASTED_ID}/hqdefault.jpg`,
    );
    await expect(region.locator('[role="alert"]')).toHaveCount(0);
    expect(await readByUrl(PASTED_URL), 'a preview stores nothing').toBeUndefined();
    await expectNoSeriousA11y(page);
    await shoot(page, 'admin-mentions-preview');

    // -- Assign → PUBLISH: "Saved.", the island resets, the row lands on top as LIVE (AC2) --------
    const assign = region.getByLabel('Assign to', { exact: true });
    await expect(assign).toHaveText('About OddSense generally'); // the safe default
    await assign.click();
    await expect(
      page.getByRole('listbox', { name: 'Assign to options' }).getByRole('option'),
    ).toHaveText([
      'About OddSense generally',
      'Metal Pipe Mace',
      'Pixel Chameleon',
      'Seed Exclusive Pack',
    ]);
    await page.getByRole('option', { name: 'Metal Pipe Mace', exact: true }).click();
    await expect(assign).toHaveText('Metal Pipe Mace');
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(region).toHaveAttribute('data-state', 'empty');
    await expect(link).toHaveValue('');
    await expect(link).toBeFocused();
    await expect(list.locator('tbody tr')).toHaveCount(3, { timeout: 10_000 });
    await expect(list.getByText('3 TOTAL', { exact: true })).toBeVisible();
    await expect(list.locator('tbody tr').first()).toContainText(PASTED_TITLE); // newest added
    const pastedRow = tableRow(page, PASTED_TITLE);
    await expect(pastedRow.getByText('LIVE', { exact: true })).toBeVisible();
    await expect(pastedRow).toContainText(`YouTube · ${PASTED_CREATOR}`);
    await expect(pastedRow).toContainText('Metal Pipe Mace');
    await expect(pastedRow).toContainText('48.2K');

    const stored = await readByUrl(PASTED_URL);
    expect(stored).toMatchObject({
      url: PASTED_URL,
      platform: 'youtube',
      external_id: PASTED_ID,
      title: PASTED_TITLE,
      creator_name: PASTED_CREATOR,
      status: 'published',
      source: 'manual',
      featured: false,
      view_count: PASTED_VIEWS,
      project_id: MACE,
      created_by: SEED_USERS.oddsense,
    });

    // Only ever an `i.ytimg.com` address (01 INV-54; ADR-0045 D7). Which video's is the fixture's
    // business: `youtube/oembed.json` answers every link with the same recorded thumbnail.
    expect(stored?.thumbnail_url).toMatch(
      /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/hqdefault\.jpg$/,
    );

    // The project page: SEEN ON count 2 — the featured seed mention first, then the new one.
    await expectMentionsAtUrl(page, '/projects/metal-pipe-mace', () =>
      expectProjectRow(page, [SEED_YOUTUBE_TITLE, PASTED_TITLE]),
    );
    const newCard = page
      .locator('section[aria-labelledby="section-title-seen-on"] article[data-variant]')
      .filter({ hasText: PASTED_TITLE });
    await expect(newCard).toHaveAttribute('data-variant', 'inline'); // plays in place (AC5)
    await expect(newCard.getByText(PASTED_VIEWS_LABEL, { exact: true })).toBeVisible();
    await expect(newCard.getByRole('button', { name: `Play ${PASTED_TITLE}` })).toBeVisible();
    // `/seen-on`: newest first, counts and tiles follow (1,200,000 + 48,213 still reads 1.2M).
    await expectMentionsAtUrl(page, '/seen-on', () =>
      expectSeenOn(
        page,
        ['ALL 3', 'YOUTUBE 2', 'TIKTOK 1'],
        [PASTED_TITLE, SEED_YOUTUBE_TITLE, SEED_TIKTOK_TITLE],
      ),
    );
    await expect(page.locator('main dl dd')).toHaveText(['1.2M', '3', '3']);
    // Not featured yet → Home still shows the one seed card; the reach line counts all three.
    await expectMentionsAtUrl(page, '/', () =>
      expectHomeStrip(page, [SEED_YOUTUBE_TITLE], '1.2M VIEWS · 3 VIDEOS · 3 CREATORS'),
    );

    // -- Feature → joins the END of the Home strip (sort_order = last + 1) — "Saved." PRG ---------
    await rowAction(page, 'Feature', PASTED_TITLE, 'Unfeature');
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await expect(pastedRow.getByText('FEATURED', { exact: true })).toBeVisible();
    await expect(featuredOrder(page)).toHaveCount(2);
    await expect(featuredOrder(page).nth(0)).toContainText(SEED_YOUTUBE_TITLE);
    await expect(featuredOrder(page).nth(1)).toContainText(PASTED_TITLE);
    expect(await featuredSortOrders()).toEqual({ [SEED_YOUTUBE_TITLE]: 1, [PASTED_TITLE]: 2 });
    await expectMentionsAtUrl(page, '/', () =>
      expectHomeStrip(
        page,
        [SEED_YOUTUBE_TITLE, PASTED_TITLE],
        '1.2M VIEWS · 3 VIDEOS · 3 CREATORS',
      ),
    );

    // -- Reorder by keyboard (⠿ handle, ArrowUp): ONE action call; Home flips; survives a reload --
    await page.goto('/admin/mentions');
    await expect(featuredOrder(page)).toHaveCount(2);
    const byKeys = reorderPost(page);
    await page.getByRole('button', { name: `Move ${PASTED_TITLE}`, exact: true }).press('ArrowUp');
    await byKeys;
    await expect(featuredOrder(page).nth(0)).toContainText(PASTED_TITLE);
    await expect.poll(featuredSortOrders).toEqual({ [PASTED_TITLE]: 1, [SEED_YOUTUBE_TITLE]: 2 });
    await page.reload();
    await expect(featuredOrder(page).nth(0)).toContainText(PASTED_TITLE);
    await expect(featuredOrder(page).nth(1)).toContainText(SEED_YOUTUBE_TITLE);
    await expectMentionsAtUrl(page, '/', () =>
      expectHomeStrip(
        page,
        [PASTED_TITLE, SEED_YOUTUBE_TITLE],
        '1.2M VIEWS · 3 VIDEOS · 3 CREATORS',
      ),
    );

    // -- Reorder by the visible Move buttons (00 S1.8 risk note): same contract, other way round.
    // The ends are `aria-disabled`, never natively disabled (focus must not drop to <body>).
    await page.goto('/admin/mentions');
    const moveUpFirst = page.getByRole('button', { name: `Move up ${PASTED_TITLE}`, exact: true });
    const moveDownFirst = page.getByRole('button', {
      name: `Move down ${PASTED_TITLE}`,
      exact: true,
    });
    await expect(moveUpFirst).toHaveAttribute('aria-disabled', 'true');
    await expect(moveUpFirst).toHaveJSProperty('disabled', false); // focusable — a no-op press
    await expect(moveDownFirst).not.toHaveAttribute('aria-disabled');
    for (const button of [moveUpFirst, moveDownFirst]) {
      const box = await button.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const byButton = reorderPost(page);
    await moveDownFirst.click();
    await byButton;
    await expect(featuredOrder(page).nth(0)).toContainText(SEED_YOUTUBE_TITLE);
    await expect(moveDownFirst).toBeFocused(); // the pressed button keeps focus at the end
    await expect(moveDownFirst).toHaveAttribute('aria-disabled', 'true');
    await expect.poll(featuredSortOrders).toEqual({ [SEED_YOUTUBE_TITLE]: 1, [PASTED_TITLE]: 2 });
    await page.reload();
    await expect(featuredOrder(page).nth(0)).toContainText(SEED_YOUTUBE_TITLE);
    await expect(featuredOrder(page).nth(1)).toContainText(PASTED_TITLE);
    await expectMentionsAtUrl(page, '/', () =>
      expectHomeStrip(
        page,
        [SEED_YOUTUBE_TITLE, PASTED_TITLE],
        '1.2M VIEWS · 3 VIDEOS · 3 CREATORS',
      ),
    );

    // -- Hide → HIDDEN tag, out of FEATURED ORDER, gone from all three public pages (AC8) ---------
    await rowAction(page, 'Hide', PASTED_TITLE, 'Show');
    await expect(pastedRow.getByText('HIDDEN', { exact: true })).toBeVisible();
    await expect(pastedRow.getByRole('button')).toHaveCount(1); // "Show" only
    await expect(featuredOrder(page)).toHaveCount(1);
    // The three worded tags, one per row (05 T-E2E-39 "FEATURED / LIVE / HIDDEN").
    await expect(list.locator('tbody tr')).toHaveCount(3);
    await expect(list.getByText('FEATURED', { exact: true })).toHaveCount(1);
    await expect(list.getByText('LIVE', { exact: true })).toHaveCount(1);
    await expect(list.getByText('HIDDEN', { exact: true })).toHaveCount(1);
    await expectNoSeriousA11y(page);
    await shoot(page, 'admin-mentions-curated');
    await expectSeedEverywhere(page);
    expect(await page.content()).not.toContain(PASTED_ID);

    // -- An unreadable link → the action's line verbatim + the manual fields → PUBLISH (AC1) ------
    await page.goto('/admin/mentions');
    await link.fill(UNREADABLE_URL);
    await region.getByRole('button', { name: 'Fetch', exact: true }).click();
    await expect(region).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
    const alert = region.locator('[role="alert"]');
    await expect(alert).toHaveCount(1);
    await expect(alert).toHaveText(UNREADABLE_LINE);
    await expect(region.locator('img[src^="/_next/image"]')).toHaveCount(0);
    const title = region.getByLabel('Title', { exact: true });
    const creator = region.getByLabel('Creator', { exact: true });
    await expect(title).toBeVisible();
    await expect(creator).toBeVisible();
    for (const label of ['Creator link', 'Date', 'Views']) {
      await expect(region.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(region.getByLabel('Platform', { exact: true })).toHaveText('Article');
    await expectNoSeriousA11y(page);
    await shoot(page, 'admin-mentions-manual');

    // PUBLISH with nothing typed: the action's own words land on the two required fields.
    await publish.click();
    await expect(region.getByText('Type a title.', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(region.getByText("Type the creator's name.", { exact: true })).toBeVisible();
    expect(await readByUrl(MANUAL_URL)).toBeUndefined();

    await title.fill(MANUAL_TITLE);
    await creator.fill(MANUAL_CREATOR);
    await publish.click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(region).toHaveAttribute('data-state', 'empty');
    await expect(list.locator('tbody tr')).toHaveCount(4, { timeout: 10_000 });
    const manualRow = tableRow(page, MANUAL_TITLE);
    await expect(manualRow.getByText('LIVE', { exact: true })).toBeVisible();
    await expect(manualRow).toContainText(`Article · ${MANUAL_CREATOR}`);
    await expect(manualRow).toContainText('About OddSense');
    expect(await readByUrl(MANUAL_URL)).toMatchObject({
      url: MANUAL_URL,
      platform: 'article',
      external_id: null,
      title: MANUAL_TITLE,
      creator_name: MANUAL_CREATOR,
      thumbnail_url: null,
      status: 'published',
      source: 'manual',
      featured: false,
      view_count: null,
      project_id: null,
      created_by: SEED_USERS.oddsense,
    });

    // Publicly: a link-out card, `READ ON <SITE>` (03 V-04), the placeholder mark and NO remote
    // image of any kind (ADR-0002 #33); about OddSense generally → the ODSENS chip. Never clicked.
    await expectMentionsAtUrl(page, '/seen-on', () =>
      expectSeenOn(
        page,
        ['ALL 3', 'YOUTUBE 1', 'TIKTOK 1', 'ARTICLE 1'],
        [SEED_YOUTUBE_TITLE, SEED_TIKTOK_TITLE, MANUAL_TITLE], // no date → last
      ),
    );
    const manualCard = page.locator('main article[data-variant]').filter({ hasText: MANUAL_TITLE });
    await expect(manualCard).toHaveAttribute('data-variant', 'link-out');
    const manualOut = manualCard.getByRole('link', { name: /^READ ON 127\.0\.0\.1 ?: / });
    await expect(manualOut).toHaveAttribute('href', MANUAL_URL);
    await expect(manualOut).toHaveAttribute('target', '_blank');
    await expect(manualOut).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(manualCard.locator('img[src^="/_next/image"]')).toHaveCount(0);
    await expect(manualCard.getByRole('img', { name: 'Article' })).toHaveCount(1);
    await expect(manualCard.getByRole('img', { name: 'odsens' })).toHaveCount(1);
    await expect(manualCard.getByText(MANUAL_CREATOR, { exact: true })).toBeVisible();
    await expect(manualCard.getByRole('link', { name: MANUAL_CREATOR })).toHaveCount(0); // no link given
    await expectNoSeriousA11y(page);

    // -- Suggested: the v1.5 stub — no rows, no Approve / Dismiss, nothing that mutates (AC10) ----
    await page.goto('/admin/mentions');
    await page
      .getByRole('navigation', { name: 'Mentions views' })
      .getByRole('link', { name: /^Suggested/ })
      .click();
    await expect(page).toHaveURL(/\/admin\/mentions\?tab=suggested$/);
    const views = page.getByRole('navigation', { name: 'Mentions views' });
    await expect(views.getByRole('link', { name: /^Suggested/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(views.getByRole('link', { name: 'Mentions', exact: true })).not.toHaveAttribute(
      'aria-current',
    );
    await expect(page.getByRole('heading', { name: 'NOTHING SUGGESTED' })).toBeVisible();
    await expect(
      page.getByText('Auto-found mentions will wait here for a yes or no. Not yet.', {
        exact: true,
      }),
    ).toBeVisible();
    const main = page.locator('main');
    await expect(main.getByRole('button')).toHaveCount(0);
    await expect(main.locator('form, input, textarea, [role="combobox"]')).toHaveCount(0);
    await expect(main.getByRole('button', { name: /approve|dismiss/i })).toHaveCount(0);
    await expect(main.locator('table')).toHaveCount(0);
    // The sidebar item stays current on `?tab=` (the nav compares the pathname only).
    await expect(
      page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Mentions' }),
    ).toHaveAttribute('aria-current', 'page');

    // -- Cleanup THROUGH THE UI: hide the manual row too, poll all three pages back to seed truth,
    // and only then remove the two (now invisible) rows with the service client --------------------
    await rowAction(page, 'Hide', MANUAL_TITLE, 'Show');
    await expectSeedEverywhere(page);
    const html = await page.content();
    expect(html).not.toContain(MANUAL_TITLE);
    expect(html).not.toContain(PASTED_ID);

    await deleteTestRows();
    const runs = await service().from('sync_runs').delete().eq('source', 'mentions');
    expect(runs.error).toBeNull();
    expect(await readMentions()).toEqual(seed);
    restoredThroughApp = true;

    // The preview thumbnail and every public card rode `/_next/image` on OUR host (01 INV-54):
    // this test never pressed Play, so the browser asked no YouTube / Google host for anything.
    const google = requests.filter((url) => {
      try {
        return /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|ggpht\.com|google\.com|googleapis\.com|googlevideo\.com|gstatic\.com)$/.test(
          new URL(url).hostname,
        );
      } catch {
        return false;
      }
    });
    expect(google, 'no browser request to a YouTube / Google host').toEqual([]);
  });
});
