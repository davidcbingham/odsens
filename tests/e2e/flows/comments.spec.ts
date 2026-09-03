/**
 * tests/e2e/flows/comments.spec.ts — the S1.4 comment flows, T-E2E-24..30 (05 §7.5; 00 S1.4.AC1–AC12;
 * 03 §2.4; DESIGN.md §5, §11.1, §11.2; ADR-0002 #72 / #76, ADR-0028 D1). One serial file in the `e2e`
 * project (05 §1.1). Every test signs in through `loginAs` / `loginAsUser` (H-9), waits for the thread
 * composer to hydrate (the detail page streams behind `loading.tsx` — the profile.spec.ts idiom, now
 * tests/helpers/hydration.ts) and acts on `/projects/pixel-chameleon`, the SEED-9 thread.
 *
 *  - T-E2E-24 (seed_user): post → the optimistic bubble (`aria-busy`; observable because the
 *    server-action POST is held on the wire until it is asserted) → persisted after reload; count
 *    increments; toast "Comment posted."; Edit → Save → "· edited"; Reply to `…0201` → depth 1 in the
 *    nested <ol>; reply to the creator reply `…0202` → flat with the client-added `@oddsense ` prefix
 *    (stored body asserted via the service client — T-ACT-16 stores as sent); Delete on the own root
 *    that has an own reply → "Deleted." slot with the reply intact; Like `…0201` → ♥ 2 + the
 *    `--indigo-lift` fill, again → ♥ 1.
 *  - T-E2E-25: the B1–B3 pre-check — 1001 chars → "That didn't post." inline, danger field border, the
 *    rule beside POST, no modal, no toast; two links → "That didn't post. Too many links."; empty →
 *    POST disabled. None of the three leaves the browser (no server-action POST).
 *  - T-E2E-26: `hold_first_time` (service, `mutatesSeed`) + a factory first-timer → dashed gold-deep
 *    bubble, HELD FOR REVIEW + the line; the row is read client-side under RLS after a reload and is
 *    absent from the ISR HTML; anon reload → not visible (ADR-0002 C1).
 *  - T-E2E-27: Report on `…0202` → chips → SEND REPORT → "Reported. OddSense will look at it."; a second
 *    report → the same line, no error, still one row (idempotent — T-ACT-21).
 *  - T-E2E-28: a banned account never reaches the thread — every page request answers 307 `/banned`
 *    (02 §3 M4b, ADR-0019; tests/e2e/flows/banned.spec.ts), so there is no composer and no POST
 *    control. SPEC TENSION, recorded for the foreman: the 05 clause "composer replaced by 'You can't
 *    comment here.' with dimmed avatar" (`CommentThread[data-state=banned]`, 03 §2.4) is unreachable
 *    under M4b — the proxy and `ViewerProvider` read the same `is_banned` flag, so a banned viewer is
 *    redirected before the thread renders. Asserted here as the observable outcome, not the slab.
 *  - T-E2E-29: `/projects/seed-exclusive-pack` (SEED-6 `comments_enabled=false`) → CLOSED + the line.
 *  - T-E2E-30 (seed_mod): the Moderate square toggle OFF/ON; held `…0203` inline (RPC
 *    `moderator_thread`, ADR-0002 A2) with `ModActionRow` + FIRST COMMENT; Approve (filled emerald) →
 *    published; Moderate ON → Ban user on a factory user's comment (inline confirm in plain words, where
 *    to undo) → Hide it → "Hidden by a moderator."; MOD tag on the mod's own comment; the banned user's
 *    next request lands on `/banned`.
 *
 * Seed hygiene (05 H-1; the foreman's E2E ordering note): factory rows wherever 05 allows (the hidden
 * and banned rows, the held first-timer, the MOD-tag comment); the seed rows 05 names (`…0201` reply
 * target + like, `…0202` reply-to-reply + report, `…0203` approve) are restored. Every test leaves the
 * thread as it found it (T-E2E-24 hard-deletes its own rows BEFORE its final like/unlike so those two
 * revalidations regenerate a clean ISR entry; T-E2E-26/27 remove their factory rows and report
 * in-test), and `restoreSeedThread` runs in BOTH hooks: `beforeAll` (self-healing — a failed earlier
 * run may have left rows, orphans and a stale ISR entry behind) and `afterAll`. It restores `…0203` to
 * held (+ `moderated_*` NULL), `site_settings.moderation_mode = 'auto'`, the SEED-3 `comment_count`
 * values, empties `notification_events` (SEED-12), removes every non-seed comment on the thread and
 * the factory users, then repairs the `project:pixel-chameleon` ISR entry through one more
 * revalidating action (`repairThreadCache`: like + unlike `…0201` — FLK-4, through the app's action,
 * never a sleep) and proves `3 TOTAL` is back. Handles of seed users are never asserted (profile.spec
 * renames `seed_user` in the parallel `e2e` project).
 */
import type { Browser, Locator, Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures';
import { clearRateLimitHitsFor, readProfile } from '../../helpers/arrange';
import { asRole, loose } from '../../helpers/asRole';
import {
  commentIdsBy,
  countReports,
  deleteCommentsBy,
  deleteLike,
  deleteNonSeedComments,
  deleteReport,
  readCommentRow,
  restoreSeedHeldComment,
  setModerationMode,
} from '../../helpers/commentsReset';
import { loadEnvTest } from '../../helpers/envTest';
import {
  cleanupFactories,
  makeComment,
  makeUser,
  purgeNotificationEvents,
  restoreSeedCommentCounts,
  trackComment,
} from '../../helpers/factories';
import { waitForHydrated } from '../../helpers/hydration';
import { loginAs, loginAsUser, logout } from '../../helpers/loginAs';
import { SEED_COMMENTS, SEED_USERS } from '../../helpers/seedIds';
import { repairThreadCache } from '../../helpers/threadCache';

test.describe.configure({ mode: 'serial' });

const PAGE = '/projects/pixel-chameleon';
const COMPOSER = '#comment-composer';
/** SEED-9 bodies (supabase/seed.sql). */
const SEED_ROOT_TEXT = 'The chameleon blends into my kitchen floor. Ten out of ten.';
const SEED_REPLY_TEXT = 'The kitchen floor is a valid biome.';
const SEED_HELD_TEXT = 'first comment here, the tail is great';
/** Bodies this file posts (`t_` tags them as test rows; unique per run). */
const RUN = Math.random().toString(36).slice(2, 8);
const ROOT_TEXT = `hello from e2e ${RUN}`;
const EDITED_TEXT = `${ROOT_TEXT}, still here`;
const OWN_REPLY_TEXT = `t_${RUN} own reply`;
const REPLY_TEXT = `t_${RUN} reply to the seed root`;
const NESTED_TEXT = `t_${RUN} nice biome`;
const HELD_E2E_TEXT = `t_${RUN} first time here`;
const USER_TEXT = `t_${RUN} plain user root`;
const MOD_TEXT = `t_${RUN} mod says hi`;

const INDIGO_LIFT = 'rgb(139, 134, 245)'; // --indigo-lift #8b86f5
const EMERALD = 'rgb(23, 185, 79)'; // --emerald #17b94f
const GOLD = 'rgb(255, 198, 31)'; // --gold #ffc61f
const GOLD_DEEP = 'rgb(192, 132, 0)'; // --gold-deep #c08400
const DANGER_FIELD = 'rgb(192, 90, 69)'; // --danger-field #c05a45
/** Error messages rendered by the page (never Next's `#__next-route-announcer__`). */
const ALERTS = '[role="alert"]:not(#__next-route-announcer__)';
/** 04 §5.5 scopes the flows hit (keyed by profile id). */
const COMMENT_SCOPES = [
  'comment',
  'comment_day',
  'comment_edit',
  'comment_delete',
  'like',
  'report',
];
const SEED_ACTORS = [SEED_USERS.seed_user, SEED_USERS.seed_mod, SEED_USERS.seed_user2];

/** Rows created at/after this instant are this file's (5-minute margin for clock skew; seed rows are days old). */
const fileStart = new Date(Date.now() - 5 * 60_000).toISOString();

// ---- Locators ---------------------------------------------------------------------------------

/** The `CommentThread` root (`data-state` shell) inside the page's `<section id="comments">`. */
function thread(page: Page): Locator {
  return page.locator('#comments > div[data-state]');
}

function composerForm(page: Page): Locator {
  return page.locator('form', { has: page.locator(COMPOSER) });
}

function rootItem(t: Locator, text: string): Locator {
  return t.locator('li[data-depth="0"]').filter({ hasText: text });
}

function replyItem(root: Locator, text: string): Locator {
  return root.locator('li[data-depth="1"]').filter({ hasText: text });
}

function articleOf(item: Locator): Locator {
  return item.locator('> article');
}

/** Toast slabs inside the `ToastProvider` region (the thread's own sr status line has no child div). */
function toastItems(page: Page): Locator {
  return page.locator('[role="status"][aria-live="polite"] div[data-state]');
}

function toast(page: Page, text: string): Locator {
  return toastItems(page).filter({ hasText: text });
}

/** A Next server-action round trip (POST to the page URL with the `next-action` header). */
function isServerAction(request: Request): boolean {
  return request.method() === 'POST' && request.headers()['next-action'] !== undefined;
}

// ---- Waits -----------------------------------------------------------------------------------

/**
 * The `N TOTAL` count (03 §2.2 `SectionTitle`: the heading announces "COMMENTS N total" once; the
 * visible `PixelLabel` is decorative) — N = the slots the viewer sees (ADR-0002 #76).
 */
async function expectTotal(t: Locator, n: number, timeout?: number): Promise<void> {
  const options = timeout === undefined ? undefined : { timeout };
  await expect(
    t.getByRole('heading', { level: 2, name: `COMMENTS ${n} total`, exact: true }),
  ).toBeVisible(options);
}

/** The composer is client-rendered after the viewer read; hydrated = the whole island is live. */
async function awaitThread(page: Page): Promise<Locator> {
  await expect(page.locator(COMPOSER)).toHaveCount(1);
  await waitForHydrated(page, COMPOSER);
  return thread(page);
}

async function openThread(page: Page): Promise<Locator> {
  await page.goto(PAGE);
  return awaitThread(page);
}

/**
 * ISR entries are stale-while-revalidate after `revalidateTag(…, 'max')`: the first request after
 * an action can still serve the previous page while the entry regenerates. Re-navigate until
 * `assert` holds (inner assertions use short timeouts so the whole block retries quickly).
 */
async function expectAtUrl(page: Page, url: string, assert: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url);
    await assert();
  }).toPass({ timeout: 20_000, intervals: [400, 800, 1_600] });
}

/**
 * Posts `text` from the thread composer (the B1–B3 pre-check passes) and waits for the STORED row:
 * the composer clears only on an ok result and the optimistic bubble (`aria-busy`) has gone by
 * then, so a service read right after sees the row.
 */
async function postRoot(page: Page, t: Locator, text: string): Promise<Locator> {
  await page.locator(COMPOSER).fill(text);
  await composerForm(page).getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.locator(COMPOSER)).toHaveValue('');
  const root = rootItem(t, text);
  await expect(root).toHaveAttribute('data-state', /^(published|held)$/);
  await expect(root.locator('> article')).not.toHaveAttribute('aria-busy', 'true');
  return root;
}

/** The one id a flow just stored (a failed post must not leave an empty id in the trackers). */
function single(ids: readonly string[], what: string): string {
  const [id] = ids;
  if (ids.length !== 1 || id === undefined) {
    throw new Error(`${what}: expected exactly one stored comment, found ${String(ids.length)}`);
  }
  return id;
}

/** Report `article` with `reason` and wait for the one-line confirmation (03 §2.4 `ReportPicker`). */
async function sendReport(article: Locator, reason: 'Spam' | 'Rude'): Promise<void> {
  await article.getByRole('button', { name: 'Report', exact: true }).click();
  const picker = article.locator('form[data-state="picking"]');
  const group = picker.getByRole('radiogroup', { name: 'Reason' });
  await expect(group.getByRole('radio')).toHaveText(['Spam', 'Rude', 'Something else']);
  const send = picker.getByRole('button', { name: 'Send report' });
  await expect(send).toBeDisabled(); // until a reason is checked
  await group.getByRole('radio', { name: reason, exact: true }).click();
  await expect(group.getByRole('radio', { name: reason, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await send.click();
  await expect(article.locator('[data-state="done"]').getByRole('status')).toHaveText(
    'Reported. OddSense will look at it.',
  );
  await expect(article.locator(ALERTS)).toHaveCount(0);
}

// ---- Hooks -----------------------------------------------------------------------------------

/** SEED-9 / SEED-3 shape back (05 H-1): rows, statuses, counts, settings; the ISR repair LAST. */
async function restoreSeedThread(browser: Browser): Promise<void> {
  await restoreSeedHeldComment();
  await setModerationMode('auto');
  await deleteReport(SEED_COMMENTS.creatorReply, SEED_USERS.seed_user);
  await deleteLike(SEED_COMMENTS.published, SEED_USERS.seed_user);
  await deleteCommentsBy(SEED_USERS.seed_user, fileStart);
  await deleteCommentsBy(SEED_USERS.seed_mod, fileStart);
  await cleanupFactories();
  await deleteNonSeedComments();
  await restoreSeedCommentCounts();
  await purgeNotificationEvents();
  await clearRateLimitHitsFor(COMMENT_SCOPES, SEED_ACTORS);
  await repairThreadCache(browser, { path: PAGE, rootText: SEED_ROOT_TEXT, expectedTotal: 3 });
  await clearRateLimitHitsFor(['like'], [SEED_USERS.seed_user]);
}

test.beforeAll(async ({ browser }) => {
  loadEnvTest();
  // Self-healing: a failed earlier run may have left rows and a stale ISR entry behind.
  await restoreSeedThread(browser);
});

test.afterAll(async ({ browser }) => {
  await restoreSeedThread(browser);
});

// ---------------------------------------------------------------------------------------------
// T-E2E-24 (edit window) — the Edit control is gone once the 15 minutes are over (00 S1.4.AC7:
// "after 15 min only Delete remains"; the client-clock branch of `Comment`). The row is arranged
// 16 minutes old through the service client, so the ISR entry needs a real revalidation
// (`repairThreadCache` likes + unlikes a seed root through the action) before it can show it.
// ---------------------------------------------------------------------------------------------
test('T-E2E-24 edit window: an own comment older than 15 minutes shows Delete but no Edit', async ({
  page,
  browser,
}) => {
  // Runs FIRST in the serial file: the thread is the seed shape (3 slots, `beforeAll` repaired it),
  // so the fresh entry must show exactly 4 — and the row is removed + the entry repaired back to 3
  // before the next flow. Two ISR repairs (each a like/unlike pair + re-navigation) need headroom.
  test.setTimeout(90_000);
  const OLD_TEXT = `t_${RUN} older than fifteen minutes`;
  await makeComment({
    author_id: SEED_USERS.seed_user,
    body: OLD_TEXT,
    created_at: new Date(Date.now() - 16 * 60_000).toISOString(),
  });
  try {
    await repairThreadCache(browser, { path: PAGE, rootText: SEED_ROOT_TEXT, expectedTotal: 4 });

    await loginAs(page, 'user');
    const t = await openThread(page);
    const old = articleOf(rootItem(t, OLD_TEXT));
    await expect(old).toBeVisible();
    await expect(old.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await expect(old.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    // The seed root by seed_user (3 days old) reads the same way.
    const seedRoot = articleOf(rootItem(t, SEED_ROOT_TEXT));
    await expect(seedRoot.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  } finally {
    // Back to the seed shape for the flows that follow (they assert `3 TOTAL` on entry).
    await cleanupFactories();
    await restoreSeedCommentCounts();
    await repairThreadCache(browser, { path: PAGE, rootText: SEED_ROOT_TEXT, expectedTotal: 3 });
  }
});

// ---------------------------------------------------------------------------------------------
// T-E2E-24 — post / edit / reply / reply-to-reply / delete / like as seed_user
// ---------------------------------------------------------------------------------------------

test('T-E2E-24 comment as user: post → optimistic bubble → persisted, count, toast; Edit → "· edited"; reply → depth 1; reply-to-reply → flat "@oddsense " prefix; Delete → "Deleted." slot with the reply intact; Like …0201 ♥ 2 → ♥ 1', async ({
  page,
}) => {
  const service = loose(asRole('service'));
  await loginAs(page, 'user');
  const t = await openThread(page);
  await expect(t).toHaveAttribute('data-state', 'normal');
  await expectTotal(t, 3);

  // -- Post: the server-action POST is held on the wire until the optimistic bubble is asserted ----
  // The route stays for the whole test (unrouting a pending route auto-handles it and the later
  // `fallback()` throws "already handled"); once released, every later POST passes straight through.
  let releasePost: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  await page.route(
    (url) => url.pathname === PAGE,
    async (route) => {
      if (isServerAction(route.request())) await held;
      await route.fallback();
    },
  );
  const composer = composerForm(page);
  const box = page.locator(COMPOSER);
  const post = composer.getByRole('button', { name: 'Post', exact: true });
  await expect(post).toBeDisabled(); // empty body → no POST control enabled
  await box.fill(ROOT_TEXT);
  await expect(composer.getByText(`${ROOT_TEXT.length} / 1000`, { exact: true })).toBeVisible();
  await expect(post).toBeEnabled();
  try {
    await post.click();
    // Optimistic bubble (ADR-0002 #72 / 03 §2.4): `aria-busy`, no actions, the composer submitting.
    const pending = t.locator('article[aria-busy="true"]').filter({ hasText: ROOT_TEXT });
    await expect(pending).toBeVisible();
    await expect(pending.getByRole('button')).toHaveCount(0);
    await expect(composer).toHaveAttribute('data-state', 'submitting');
  } finally {
    releasePost();
  }

  await expect(t.locator('article[aria-busy="true"]')).toHaveCount(0);
  const root = rootItem(t, ROOT_TEXT);
  await expect(root).toHaveAttribute('data-state', 'published');
  await expect(root).toHaveAttribute('data-own', '');
  await expect(toast(page, 'Comment posted.')).toBeVisible();
  await expect(box).toHaveValue('');
  await expectTotal(t, 4);
  const rootId = single(await commentIdsBy(SEED_USERS.seed_user, fileStart), 'T-E2E-24 root post');
  expect((await readCommentRow(rootId))?.status).toBe('published');

  // -- Persisted after reload (the action revalidated `project:pixel-chameleon`) ------------------
  await expectAtUrl(page, PAGE, async () => {
    await expect(rootItem(thread(page), ROOT_TEXT)).toHaveAttribute('data-state', 'published', {
      timeout: 1_000,
    });
  });
  const t2 = await awaitThread(page);
  await expectTotal(t2, 4);

  // -- Edit → Save → "· edited" (inside the 15-minute window — 00 S1.4.AC7) ------------------------
  const root2 = rootItem(t2, ROOT_TEXT);
  const rootArticle = articleOf(root2);
  await rootArticle.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(root2).toHaveAttribute('data-state', 'editing');
  const editBox = rootArticle.getByLabel('Edit comment');
  await expect(editBox).toHaveValue(ROOT_TEXT);
  await editBox.fill(EDITED_TEXT);
  await rootArticle.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(root2).toHaveAttribute('data-state', 'published');
  await expect(rootArticle).toContainText(EDITED_TEXT);
  await expect(rootArticle).toContainText('· edited');
  expect((await readCommentRow(rootId))?.edited_at).not.toBeNull();

  // -- Reply to the own root (so the delete below leaves a slot with a reply) ---------------------
  await rootArticle.getByRole('button', { name: 'Reply', exact: true }).click();
  const ownReplyForm = rootArticle.locator('form:has(textarea[aria-label="Your reply"])');
  await ownReplyForm.getByLabel('Your reply').fill(OWN_REPLY_TEXT);
  await ownReplyForm.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(ownReplyForm).toHaveCount(0); // the reply composer closes once the row is stored
  const ownReply = replyItem(root2, OWN_REPLY_TEXT);
  await expect(ownReply).toHaveAttribute('data-state', 'published');
  await expectTotal(t2, 5);

  // -- Reply to …0201 → indented one level (nested <ol>: 52px margin, 2px line — DESIGN.md §5) ------
  const seedRoot = rootItem(t2, SEED_ROOT_TEXT);
  const seedArticle = articleOf(seedRoot);
  await seedArticle.getByRole('button', { name: 'Reply', exact: true }).click();
  const seedReplyForm = seedArticle.locator('form:has(textarea[aria-label="Your reply"])');
  await seedReplyForm.getByLabel('Your reply').fill(REPLY_TEXT);
  await seedReplyForm.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(seedReplyForm).toHaveCount(0);
  const reply = replyItem(seedRoot, REPLY_TEXT);
  await expect(reply).toHaveAttribute('data-state', 'published');
  await expect(reply).toHaveAttribute('data-depth', '1');
  const nestedList = seedRoot.locator('> ol');
  expect(
    await nestedList.evaluate((el) => [
      getComputedStyle(el).marginLeft,
      getComputedStyle(el).borderLeftWidth,
    ]),
  ).toEqual(['52px', '2px']);
  await expect(seedRoot.locator('> ol > li')).toHaveCount(2); // the creator reply, then mine
  await expectTotal(t2, 6);

  // -- Reply to the reply (…0202 by oddsense) → flat, with the client-added "@oddsense " prefix -----
  const creatorReply = replyItem(seedRoot, SEED_REPLY_TEXT);
  const creatorArticle = articleOf(creatorReply);
  await expect(creatorArticle.getByText('CREATOR', { exact: true })).toBeVisible();
  await creatorArticle.getByRole('button', { name: 'Reply', exact: true }).click();
  const nestedForm = creatorArticle.locator('form:has(textarea[aria-label="Your reply"])');
  await expect(nestedForm.getByText('Replying to')).toBeVisible();
  await expect(nestedForm.getByText('@oddsense', { exact: true })).toBeVisible();
  await nestedForm.getByLabel('Your reply').fill(NESTED_TEXT);
  // The prefix counts towards the 1000 (`@oddsense ` = 10).
  await expect(
    nestedForm.getByText(`${10 + NESTED_TEXT.length} / 1000`, { exact: true }),
  ).toBeVisible();
  await nestedForm.getByRole('button', { name: 'Post', exact: true }).click();
  // The composer sits inside the creator reply's <li> and its textarea text would match too —
  // wait for it to close (it unmounts on `onPosted`) before locating the new row.
  await expect(nestedForm).toHaveCount(0);
  const nestedReply = replyItem(seedRoot, NESTED_TEXT);
  await expect(nestedReply).toHaveAttribute('data-depth', '1'); // never a third level
  await expect(articleOf(nestedReply)).toContainText(`@oddsense ${NESTED_TEXT}`);
  await expect(t2.locator('li[data-depth="1"] li')).toHaveCount(0);
  await expect(seedRoot.locator('> ol > li')).toHaveCount(3);
  await expectTotal(t2, 7);
  const storedNested = await service
    .from('comments')
    .select('body, parent_id')
    .eq('author_id', SEED_USERS.seed_user)
    .eq('body', `@oddsense ${NESTED_TEXT}`)
    .maybeSingle();
  expect(storedNested.error).toBeNull();
  expect(storedNested.data).toEqual({
    body: `@oddsense ${NESTED_TEXT}`,
    parent_id: SEED_COMMENTS.published, // stored under the ROOT (data-model §2.5)
  });

  // -- Delete the own root: asks once inline; the slot keeps the reply (00 S1.4.AC8) ---------------
  await rootArticle.getByRole('button', { name: 'Delete', exact: true }).click();
  const strip = rootArticle.getByRole('group', { name: 'Delete this comment?' });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Keep it' })).toBeFocused();
  await expect(page.locator('dialog')).toHaveCount(0); // inline, never a modal
  await strip.getByRole('button', { name: 'Delete it' }).click();
  const deletedSlot = t2
    .locator('li[data-depth="0"][data-state="deleted"]')
    .filter({ hasText: OWN_REPLY_TEXT });
  await expect(deletedSlot).toBeVisible();
  await expect(deletedSlot.getByText('Deleted.', { exact: true })).toBeVisible();
  await expect(t2.getByText(EDITED_TEXT)).toHaveCount(0);
  await expect(replyItem(deletedSlot, OWN_REPLY_TEXT)).toHaveAttribute('data-state', 'published');
  await expectTotal(t2, 7); // the slot counts (ADR-0028 D1)
  expect((await readCommentRow(rootId))?.status).toBe('deleted');

  // -- Like …0201 → ♥ 2 + --indigo-lift fill; again → ♥ 1 (00 S1.4.AC6) ---------------------------
  // This test's rows leave first, so the two revalidations below regenerate a clean ISR entry
  // (05 H-1 — through the action, FLK-4; the rows on screen are client state).
  expect(await deleteCommentsBy(SEED_USERS.seed_user, fileStart)).toBe(4);
  const like = seedArticle.getByRole('button', { name: 'Like, 1 like', exact: true });
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await expect(like).toHaveText('♥ 1');
  await like.click();
  const liked = seedArticle.getByRole('button', { name: 'Like, 2 likes', exact: true });
  await expect(liked).toHaveAttribute('aria-pressed', 'true');
  await expect(liked).toHaveText('♥ 2');
  await expect
    .poll(() => liked.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe(INDIGO_LIFT);
  await expect(liked).not.toHaveAttribute('aria-busy', 'true');
  expect((await readCommentRow(SEED_COMMENTS.published))?.like_count).toBe(2);
  await liked.click();
  const unliked = seedArticle.getByRole('button', { name: 'Like, 1 like', exact: true });
  await expect(unliked).toHaveAttribute('aria-pressed', 'false');
  await expect(unliked).toHaveText('♥ 1');
  await expect(unliked).not.toHaveAttribute('aria-busy', 'true');
  expect((await readCommentRow(SEED_COMMENTS.published))?.like_count).toBe(1);
  await expect(page.locator(ALERTS)).toHaveCount(0);

  // The thread is back to its seed shape for the next test (and the ISR entry is fresh).
  await restoreSeedCommentCounts();
  await expectAtUrl(page, PAGE, async () => {
    await expectTotal(thread(page), 3, 1_000);
  });
});

// ---------------------------------------------------------------------------------------------
// T-E2E-25 — composer errors stay inline; nothing leaves the browser
// ---------------------------------------------------------------------------------------------

test('T-E2E-25 comment errors: 1001 chars → "That didn\'t post." inline + the rule beside POST (no modal, no toast); two links → "Too many links."; empty → POST disabled; no request is sent', async ({
  page,
}) => {
  await loginAs(page, 'user');
  const t = await openThread(page);
  const posts: string[] = [];
  page.on('request', (request) => {
    if (isServerAction(request)) posts.push(request.url());
  });
  const composer = composerForm(page);
  const box = page.locator(COMPOSER);
  const post = composer.getByRole('button', { name: 'Post', exact: true });

  // Empty (and whitespace-only, trimmed empty): POST disabled, Ctrl+Enter does nothing.
  await expect(post).toBeDisabled();
  await box.fill('   ');
  await expect(post).toBeDisabled();
  await box.press('Control+Enter');
  await expect(composer).toHaveAttribute('data-state', 'idle');

  // 1001 characters: counter turns gold, the field goes danger, one plain line, the rule beside POST.
  await box.fill('x'.repeat(1001));
  const counter = composer.getByText('1001 / 1000', { exact: true });
  await expect(counter).toBeVisible();
  expect(await counter.evaluate((el) => getComputedStyle(el).color)).toBe(GOLD);
  await post.click();
  await expect(composer).toHaveAttribute('data-state', 'error');
  const alert = composer.locator(ALERTS);
  await expect(alert).toHaveText("That didn't post.");
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  await expect
    .poll(() => box.evaluate((el) => getComputedStyle(el).borderColor))
    .toBe(DANGER_FIELD);
  await expect(composer.getByText('1000 characters, one link.')).toBeVisible();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(toastItems(page)).toHaveCount(0);

  // Two links: the line names the rule; the previous line cleared on the keystroke.
  await box.fill('see https://a.example and https://b.example');
  await expect(composer).toHaveAttribute('data-state', 'idle');
  await post.click();
  await expect(composer).toHaveAttribute('data-state', 'error');
  await expect(alert).toHaveText("That didn't post. Too many links.");
  await expect(t.locator('li').filter({ hasText: 'https://a.example' })).toHaveCount(0); // not posted
  await expect(toastItems(page)).toHaveCount(0);

  expect(posts, 'no server-action POST left the browser').toEqual([]);
  await expectTotal(t, 3);
});

// ---------------------------------------------------------------------------------------------
// T-E2E-26 — hold_first_time: the first-timer's own held bubble (client-side read)
// ---------------------------------------------------------------------------------------------

test('T-E2E-26 comment held: hold_first_time + a first-time factory user → dashed gold bubble, HELD FOR REVIEW + the line, read client-side; anon reload → not visible', async ({
  page,
}) => {
  await setModerationMode('hold_first_time');
  const userId = await makeUser({ comment_count: 0 });
  await loginAsUser(page, userId);
  const t = await openThread(page);
  await expectTotal(t, 3);

  const bubble = await postRoot(page, t, HELD_E2E_TEXT);
  await expect(bubble).toHaveAttribute('data-state', 'held');
  await expect(bubble).toHaveAttribute('data-own', '');
  const notice = bubble.getByRole('status');
  await expect(notice).toContainText('HELD FOR REVIEW');
  await expect(notice).toContainText(HELD_E2E_TEXT);
  await expect(notice).toContainText(
    'Only you can see this until OddSense approves it. Usually quick.',
  );
  const bubbleBox = bubble.locator('[class*="comment-bubble"]');
  await expect
    .poll(() =>
      bubbleBox.evaluate((el) => [
        getComputedStyle(el).outlineStyle,
        getComputedStyle(el).outlineColor,
      ]),
    )
    .toEqual(['dashed', GOLD_DEEP]);
  await expect(bubble.getByRole('button', { name: /^Like, / })).toHaveCount(0); // no like on held
  await expectTotal(t, 4); // the author counts the own held row (ADR-0002 #76)
  const heldId = single(await commentIdsBy(userId), 'T-E2E-26 held post');
  trackComment(heldId);
  expect((await readCommentRow(heldId))?.status).toBe('held');

  // After a reload the row comes from the viewer's own RLS read (ADR-0002 C1), never the ISR HTML.
  await page.reload();
  const t2 = await awaitThread(page);
  await expect(
    t2.locator('li[data-state="held"]').filter({ hasText: HELD_E2E_TEXT }),
  ).toBeVisible();
  const html = await (await page.request.get(PAGE)).text();
  expect(html).not.toContain(HELD_E2E_TEXT);

  // Anon: not visible, count unchanged.
  await logout(page);
  await page.goto(PAGE);
  await expect(thread(page)).toHaveAttribute('data-state', 'signed-out');
  await expect(page.getByText(HELD_E2E_TEXT)).toHaveCount(0);
  await expectTotal(thread(page), 3);

  await setModerationMode('auto');
  // Leave the thread as found: the held row would otherwise stay visible to the moderator in
  // T-E2E-30 (the RPC returns held rows) until the file-level cleanup.
  await cleanupFactories();
});

// ---------------------------------------------------------------------------------------------
// T-E2E-27 — report, twice
// ---------------------------------------------------------------------------------------------

test('T-E2E-27 comment report: Report on …0202 → Spam / Rude / Something else → SEND REPORT → "Reported. OddSense will look at it."; again → the same line, no error (idempotent)', async ({
  page,
}) => {
  await loginAs(page, 'user');
  const t = await openThread(page);
  await sendReport(articleOf(replyItem(rootItem(t, SEED_ROOT_TEXT), SEED_REPLY_TEXT)), 'Rude');
  expect(await countReports(SEED_COMMENTS.creatorReply, SEED_USERS.seed_user)).toBe(1);

  await page.reload();
  const t2 = await awaitThread(page);
  await sendReport(articleOf(replyItem(rootItem(t2, SEED_ROOT_TEXT), SEED_REPLY_TEXT)), 'Spam');
  expect(await countReports(SEED_COMMENTS.creatorReply, SEED_USERS.seed_user)).toBe(1); // no-op
  expect((await readCommentRow(SEED_COMMENTS.creatorReply))?.status).toBe('published');

  await deleteReport(SEED_COMMENTS.creatorReply, SEED_USERS.seed_user);
});

// ---------------------------------------------------------------------------------------------
// T-E2E-28 — banned
// ---------------------------------------------------------------------------------------------

test('T-E2E-28 comment banned: a banned account never reaches the thread — /projects/pixel-chameleon → 307 /banned (02 §3 M4b), no composer, no POST control', async ({
  page,
}) => {
  await loginAs(page, 'banned');
  const direct = await page.request.get(PAGE, { maxRedirects: 0 });
  expect(direct.status()).toBe(307);
  expect(new URL(direct.headers()['location'] ?? '', direct.url()).pathname).toBe('/banned');

  await page.goto(PAGE);
  expect(new URL(page.url()).pathname).toBe('/banned');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("YOU'RE BANNED");
  await expect(page.locator(COMPOSER)).toHaveCount(0);
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);
  await expect(page.locator('#comments')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// T-E2E-29 — closed
// ---------------------------------------------------------------------------------------------

test('T-E2E-29 comment closed: /projects/seed-exclusive-pack → CLOSED + "Comments are off for this one. The old ones stay."', async ({
  page,
}) => {
  await loginAs(page, 'user');
  await page.goto('/projects/seed-exclusive-pack');
  await expect(page.locator('header nav button[aria-haspopup="menu"]')).toBeVisible(); // signed in
  const t = thread(page);
  await expect(t).toHaveAttribute('data-state', 'closed');
  await expect(t.getByText('CLOSED', { exact: true })).toBeVisible();
  await expect(t.getByText('Comments are off for this one. The old ones stay.')).toBeVisible();
  await expect(t.locator('textarea')).toHaveCount(0);
  await expect(t.getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);
  await expectTotal(t, 0);
});

// ---------------------------------------------------------------------------------------------
// T-E2E-30 — as seed_mod
// ---------------------------------------------------------------------------------------------

test('T-E2E-30 comment as mod: Moderate OFF/ON toggle; held …0203 inline with ModActionRow + FIRST COMMENT; Approve (filled emerald) → published; Moderate ON → Ban user (inline, plain words) + Hide on a factory comment → "Hidden by a moderator."; MOD tag on the mod\'s own comment; the banned user lands on /banned', async ({
  page,
}) => {
  // A plain user's root comment, posted through the UI (the action revalidates the ISR entry).
  const userId = await makeUser();
  const handle = (await readProfile(userId))?.handle ?? '';
  expect(handle).toMatch(/^t_/);
  await loginAsUser(page, userId);
  const asUser = await openThread(page);
  const userRootAsUser = await postRoot(page, asUser, USER_TEXT);
  await expect(userRootAsUser).toHaveAttribute('data-state', 'published');
  const userCommentId = single(await commentIdsBy(userId), 'T-E2E-30 user post');
  trackComment(userCommentId);
  await logout(page);

  await loginAs(page, 'mod');
  await expectAtUrl(page, PAGE, async () => {
    await expect(rootItem(thread(page), USER_TEXT)).toBeVisible({ timeout: 1_000 });
  });
  const t = await awaitThread(page);
  await expect(t.getByRole('region', { name: 'Loading comments' })).toHaveCount(0); // merge done

  // Header: the square toggle, OFF (DESIGN.md §11.1; 03 §2.4 `data-moderate`).
  const sw = t.getByRole('switch', { name: 'Moderate' });
  const swLabel = t.locator('label:has(input[aria-label="Moderate"])');
  await expect(sw).not.toBeChecked();
  await expect(swLabel).toHaveText('OFF');
  await expect(t).toHaveAttribute('data-moderate', 'off');

  // Held …0203 — inline for the moderator (RPC `moderator_thread`), mod row + FIRST COMMENT always.
  const heldRow = t.locator('li[data-state="held"]').filter({ hasText: SEED_HELD_TEXT });
  await expect(heldRow).toBeVisible();
  await expect(heldRow.getByText('FIRST COMMENT', { exact: true })).toBeVisible();
  await expect(heldRow.getByText('HELD FOR REVIEW')).toHaveCount(0); // the notice is author-only
  const heldMod = heldRow.getByRole('group', { name: 'Moderation' });
  const approve = heldMod.getByRole('button', { name: 'Approve' });
  await expect(approve).toBeVisible();
  expect(await approve.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(EMERALD);
  await expect(heldMod.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
  await expect(heldMod.getByRole('button', { name: 'Ban user' })).toBeVisible();
  // Ordinary rows carry no mod row while Moderate is OFF.
  const userRoot = rootItem(t, USER_TEXT);
  await expect(userRoot.getByRole('group', { name: 'Moderation' })).toHaveCount(0);
  await expectTotal(t, 5); // 3 public slots + the held row + the user's comment

  // Approve → published; the mod row leaves an ordinary row while OFF.
  await approve.click();
  await expect(toast(page, 'Approved.')).toBeVisible();
  const approved = t.locator('li[data-depth="0"]').filter({ hasText: SEED_HELD_TEXT });
  await expect(approved).toHaveAttribute('data-state', 'published');
  await expect(approved.getByRole('group', { name: 'Moderation' })).toHaveCount(0);
  await expect(approved.getByText('FIRST COMMENT', { exact: true })).toHaveCount(0);
  expect(await readCommentRow(SEED_COMMENTS.held)).toMatchObject({
    status: 'published',
    moderated_by: SEED_USERS.seed_mod,
  });
  await expectTotal(t, 5);

  // The mod's own comment carries the MOD tag (03 §2.4 `data-mod`).
  const modOwn = await postRoot(page, t, MOD_TEXT);
  await expect(modOwn).toHaveAttribute('data-state', 'published');
  await expect(modOwn).toHaveAttribute('data-mod', '');
  await expect(modOwn).toHaveAttribute('data-own', '');
  await expect(articleOf(modOwn).getByText('MOD', { exact: true })).toBeVisible();
  await expectTotal(t, 6);

  // Moderate ON → every ordinary row gets its mod row; Approve never shows on a published row.
  await swLabel.click();
  await expect(sw).toBeChecked();
  await expect(swLabel).toHaveText('ON');
  await expect(t).toHaveAttribute('data-moderate', 'on');
  const userMod = articleOf(userRoot).getByRole('group', { name: 'Moderation' });
  await expect(userMod).toBeVisible();
  await expect(userMod.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(userMod.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();

  // Ban user: asks once, inline, in plain words, and says where to undo (DESIGN.md §11.1).
  await userMod.getByRole('button', { name: 'Ban user' }).click();
  const banStrip = userMod.getByRole('group', {
    name: `Ban @${handle}? They can't comment anywhere. Undo in Admin → Comments.`,
  });
  await expect(banStrip).toBeVisible();
  await expect(banStrip.getByRole('button', { name: 'Keep' })).toBeFocused();
  await expect(page.locator('dialog')).toHaveCount(0);
  await banStrip.getByRole('button', { name: 'Ban', exact: true }).click();
  await expect(toast(page, 'Banned.')).toBeVisible();
  expect((await readProfile(userId))?.is_banned).toBe(true);

  // Hide the (factory) user's comment → the "Hidden by a moderator." slot (00 S1.4.AC12).
  await userMod.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(toast(page, 'Hidden.')).toBeVisible();
  await expect(t.getByText(USER_TEXT)).toHaveCount(0);
  const hiddenSlots = t.locator('li[data-state="hidden"]');
  await expect(hiddenSlots).toHaveCount(2); // seed …0204 + this one
  await expect(hiddenSlots.filter({ hasText: 'Hidden by a moderator.' })).toHaveCount(2);
  expect(await readCommentRow(userCommentId)).toMatchObject({
    status: 'hidden',
    moderated_by: SEED_USERS.seed_mod,
  });
  await expectTotal(t, 6); // the slot still counts
  await expect(page.locator(ALERTS)).toHaveCount(0);

  // The banned user's next request lands on /banned (02 §3 M4b, ADR-0019) — the banned state.
  await logout(page);
  await loginAsUser(page, userId);
  await page.goto(PAGE);
  expect(new URL(page.url()).pathname).toBe('/banned');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("YOU'RE BANNED");
  await expect(page.locator(COMPOSER)).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// T-E2E-24 (empty thread) — 03 §2.4 `CommentThread` `data-state="empty"` / DESIGN.md §11.2
// "NO COMMENTS YET" + "Say something." + one primary button, on the zero-comment seed project.
// ---------------------------------------------------------------------------------------------
test('T-E2E-24 empty thread: signed in on a project with no comments → NO COMMENTS YET / Say something. + one button that focuses the composer', async ({
  page,
}) => {
  await loginAs(page, 'user');
  await page.goto('/projects/metal-pipe-mace');
  const t = thread(page);
  await expect(t).toHaveAttribute('data-state', 'empty');
  await expectTotal(t, 0);
  await expect(t.getByRole('heading', { name: 'NO COMMENTS YET' })).toBeVisible();
  await expect(t.getByText('Say something.', { exact: true })).toBeVisible();
  // One action on the empty state (03 `EmptyState`: a primary `Button href` → an `<a>`); the
  // composer's own POST sits above the list and is disabled while the body is empty.
  const action = t.getByRole('link', { name: 'Write a comment', exact: true });
  await expect(action).toHaveAttribute('data-variant', 'primary');
  await expect(t.locator('[data-variant="primary"]')).toHaveCount(2);
  await action.click();
  await expect(page.locator(COMPOSER)).toBeFocused();
});
