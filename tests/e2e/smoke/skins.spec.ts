/**
 * tests/e2e/smoke/skins.spec.ts — T-E2E-7 + T-E2E-8 (05 §7.5; 00 S1.7.AC2–AC5, AC8, AC10; 02 route
 * row `/skins`, SM-06; 03 §2.7 `SkinViewer3D` / `SkinCard`, C-13, C-18; DESIGN.md §4, §6 #5;
 * S1.7 D16 / D14 / D21 / D21 / D22 — ADR-0047 / ADR-0048): the public `/skins` page on
 * SEED-7 / SEED-13 (two published skins — `seed-skin-b` first by `sort_order`), at 1280 and 390.
 *  - title, one h1, the dry subline; the stage is in the ISR HTML (the Suspense fallback holds the
 *    default selection — SM-05's spirit).
 *  - 2 `SkinCard`s in seed order: `seed-skin-b` first (`aria-current="true"`, `data-exclusive`,
 *    `ExclusiveBadge`; `render_bust_path NULL` → a live `canvas` in its 3:4 slot once the chunk
 *    lands — ADR-0048 D14 / D15), `seed-skin-a` second (a bust `<img>` whose `src` decodes to
 *    `…0601/bust.png`, pixelated); every corner reference thumb is 64px with computed
 *    `image-rendering: pixelated` (AC3).
 *  - the stage `canvas[role="img"]` reaches `data-state="ready"` after the lazy load (AC2); a
 *    `data-state="unsupported"` FAILS the run loudly (ADR-0048 D21 — the fallback is never silently
 *    accepted; check the SwiftShader launch args in playwright.config.ts).
 *  - DOWNLOAD PNG: `href` = `/api/download/<…0602>`, the `download` attribute, the primary look
 *    (`data-variant="primary"`); the Slim switch is checked for the slim seed skin (AC4).
 *  - clicking card A moves `aria-current`, swaps the name / description / href to `…0601`, sets
 *    `?skin=seed-skin-a` with no scroll and no focus move (the viewer swaps its texture in place —
 *    still ONE canvas, its label follows the name); Slim resets to that skin's model; Spin / Walk
 *    flip `aria-pressed`; Front ⇄ Back flips its label; selected + focused shows the
 *    `--indigo-lift` edge and the gold ring; no `download` event before the link is clicked.
 *  - a direct `/skins?skin=seed-skin-a` load selects it without taking focus; an unknown slug
 *    falls back to the first skin.
 *  - `prefers-reduced-motion: reduce` → Spin starts off and Walk is disabled (03 row).
 *  - the route itself: `page.request.get('/api/download/<…0602>')` → 302 whose `Location` is the
 *    public texture object with `?download=seed-skin-b.png` (ADR-0048 D22; `skins.downloads` restored in
 *    `afterAll` — 05 H-1).
 *  - T-E2E-8 (ADR-0048 D21): every `<script src>` chunk `/` and `/projects` request is fetched and none
 *    holds `skinview3d` / `WebGLRenderer`; on `/skins`, once the viewer is ready, at least one
 *    requested chunk does (AC5 — the chunk is lazy, never first-load JS).
 *  - no horizontal overflow at 390; axe zero serious/critical in the default, selected and
 *    reduced-motion states; screenshots `skins`, `skins-selected`, `skins-reduced-motion`.
 * H-10: the texture is a LOCAL Supabase object (SEED-13), so the shared context lets it through.
 * The empty state (AC8) is not reachable with seed data — it is a described gallery fixture
 * (`tests/fixtures/ui/skinsArt.ts`) and the admin flow (T-E2E-38) covers publish.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { asRole, loose } from '../../helpers/asRole';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { loadEnvTest } from '../../helpers/envTest';
import { shoot } from '../../helpers/screenshots';
import { SEED_SKINS } from '../../helpers/seedIds';
import { stubVa } from '../../helpers/vaStub';

const GOLD = 'rgb(255, 198, 31)'; // --gold
const INDIGO_LIFT = 'rgb(139, 134, 245)'; // --indigo-lift
const CHALK = 'rgb(238, 241, 246)'; // --chalk
const SLAB = 'rgb(21, 30, 41)'; // --slab

// SEED-7 (05 §3; ADR-0048 D20).
const SLUG_A = 'seed-skin-a';
const SLUG_B = 'seed-skin-b';
const NAME_A = 'Seed Skin A';
const NAME_B = 'Seed Skin B';
const DESCRIPTION_A = 'The one that started it. Plain, dependable, slightly cursed.';
const DESCRIPTION_B = 'Slim arms. Big feelings.';

/** SwiftShader + the lazy chunk + the texture fetch: generous, never asserted synchronously. */
const VIEWER_TIMEOUT = 30_000;

const stage = (page: Page) => page.locator('main [data-variant="stage"]');
const readyCanvas = (page: Page) => stage(page).locator('[data-state="ready"] canvas[role="img"]');
const cardLinks = (page: Page) => page.locator('main ul a[href^="?skin="]');
const cardLink = (page: Page, slug: string) => page.locator(`main ul a[href="?skin=${slug}"]`);
/** The `<article>` around a card's link (`has` is relative to the article — a bare `a[href]`). */
const cardOf = (page: Page, slug: string) =>
  page.locator('main ul article', { has: page.locator(`a[href="?skin=${slug}"]`) });
const stageName = (page: Page) => page.locator('main h2').first();
const download = (page: Page) => page.getByRole('link', { name: 'DOWNLOAD PNG' });
const slim = (page: Page) => page.getByRole('switch', { name: 'Slim arms' });
/** The Toggle's `<label>` — the click target (the input is visually hidden; comments.spec precedent). */
const slimLabel = (page: Page) => page.locator('label:has(input[aria-label="Slim arms"])');
const spin = (page: Page) => stage(page).getByRole('button', { name: 'Spin' });
const walk = (page: Page) => stage(page).getByRole('button', { name: 'Walk' });
const flip = (page: Page) => stage(page).getByRole('button', { name: /^(Front|Back)$/ });

/** The stage viewer must reach `ready`; `unsupported` is a loud failure, not a pass (ADR-0048 D21). */
async function expectViewerReady(page: Page): Promise<void> {
  const body = stage(page).locator('[data-state]').first();
  await expect(body).toHaveAttribute('data-state', /^(ready|unsupported)$/, {
    timeout: VIEWER_TIMEOUT,
  });
  expect(
    await body.getAttribute('data-state'),
    'SkinViewer3D fell to `unsupported`: headless Chromium has no WebGL here — check the ADR-0048 D21 SwiftShader launch args (playwright.config.ts) before touching the spec',
  ).toBe('ready');
  await expect(readyCanvas(page)).toHaveCount(1);
  // The controls were `disabled` until this frame: their Button colours ease from the disabled
  // look to chalk-on-slab over --dur-fast, and an axe pass that samples mid-fade reports a
  // 4.35:1 blend. Retried until the never-pressed Front/Back button rests (the videos.spec idiom).
  await expect(flip(page)).toHaveCSS('color', CHALK);
  await expect(flip(page)).toHaveCSS('background-color', SLAB);
}

test.describe('skins', () => {
  test.beforeAll(() => {
    loadEnvTest();
  });

  test.afterAll(async () => {
    // 05 H-1: the route test below counts a download on …0602; SEED-7 pins `downloads 0` (ADR-0048 D20).
    const service = loose(asRole('service'));
    const { error } = await service
      .from('skins')
      .update({ downloads: 0 })
      .in('id', [SEED_SKINS.skinA, SEED_SKINS.skinB]);
    if (error)
      throw new Error(`skins.spec afterAll: could not restore skins.downloads — ${error.message}`);
  });

  test('T-E2E-7 /skins: two cards in seed order, live stage, DOWNLOAD PNG, Slim; card A click swaps in place; the route answers 302 + ?download=', async ({
    page,
  }) => {
    // Two WebGL viewers on software GL plus the settle-and-shoot walks: the 30 s default is tight.
    test.setTimeout(120_000);
    const va = await stubVa(page);
    const response = await page.goto('/skins', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    expect(await response?.text()).toContain('DOWNLOAD PNG'); // the stage is in the ISR HTML
    await expect(page).toHaveTitle('Skins — odsens');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('SKINS');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByText('Wear one. Or eight.')).toBeVisible();

    // Cards: two links in seed order (sort_order 1 → seed-skin-b), the first selected.
    const links = cardLinks(page);
    await expect(links).toHaveCount(2);
    expect(await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual([
      `?skin=${SLUG_B}`,
      `?skin=${SLUG_A}`,
    ]);
    const linkB = cardLink(page, SLUG_B);
    const linkA = cardLink(page, SLUG_A);
    await expect(linkB).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('main [aria-current="true"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([NAME_B, NAME_A]);

    // seed-skin-b: exclusive (gold outline + badge, one per card); its bust is a LIVE render.
    const cardB = cardOf(page, SLUG_B);
    expect(await cardB.evaluate((el) => el.hasAttribute('data-exclusive'))).toBe(true);
    await expect(cardB.getByText('ONLY ON ODSENS')).toHaveCount(1);
    await expect(cardB.locator('[data-state="ready"] canvas[role="img"]')).toHaveCount(1, {
      timeout: VIEWER_TIMEOUT,
    });
    await expect(cardB.locator('[data-state="unsupported"]')).toHaveCount(0);

    // seed-skin-a: no badge; the cached bust through next/image, pixelated (AC3).
    const cardA = cardOf(page, SLUG_A);
    expect(await cardA.evaluate((el) => el.hasAttribute('data-exclusive'))).toBe(false);
    await expect(cardA.getByText('ONLY ON ODSENS')).toHaveCount(0);
    const bust = cardA.getByRole('img', { name: `${NAME_A} skin, 3D render` });
    await expect(bust).toBeVisible();
    const bustSrc = decodeURIComponent((await bust.getAttribute('src')) ?? '');
    expect(bustSrc).toContain(`${SEED_SKINS.skinA}/bust.png`);
    await expect(bust).toHaveCSS('image-rendering', 'pixelated');

    // The 64×64 source pinned in every corner at 1×, never smoothed (AC3; DESIGN.md §4).
    const corners = page.locator('main ul img[alt=""]');
    await expect(corners).toHaveCount(2);
    for (const corner of await corners.all()) {
      await expect(corner).toHaveCSS('image-rendering', 'pixelated');
      const box = await corner.boundingBox();
      expect([Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)]).toEqual([64, 64]);
    }

    // The stage: a live 3D view of the selected skin (AC2), never a flat texture.
    await expectViewerReady(page);
    await expect(readyCanvas(page)).toHaveAttribute('aria-label', `3D view of ${NAME_B} skin`);
    await expect(stageName(page)).toHaveText(NAME_B);
    await expect(page.getByText(DESCRIPTION_B)).toBeVisible();
    await expect(spin(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(walk(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(walk(page)).toBeEnabled();
    await expect(flip(page)).toHaveText('Back');

    // DOWNLOAD PNG → the download route, saved by the browser (AC4; ADR-0048 D22).
    const link = download(page);
    await expect(link).toHaveAttribute('href', `/api/download/${SEED_SKINS.skinB}`);
    await expect(link).toHaveAttribute('download', '');
    await expect(link).toHaveAttribute('data-variant', 'primary');
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(slim(page)).toBeChecked(); // seed-skin-b is slim

    // No sideways scroll; nothing took focus on first render.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(page.viewportSize()?.width);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');

    await expectNoSeriousA11y(page);
    await shoot(page, 'skins');

    // Card A: the selection swaps in place — URL, aria-current, name, description, href, Slim.
    await linkA.scrollIntoViewIfNeeded();
    const scrollY = await page.evaluate(() => window.scrollY);
    await linkA.click();
    await expect(page).toHaveURL(/\/skins\?skin=seed-skin-a$/);
    await expect(linkA).toHaveAttribute('aria-current', 'true');
    await expect(linkB).not.toHaveAttribute('aria-current', 'true');
    await expect(page.locator('main [aria-current="true"]')).toHaveCount(1);
    await expect(stageName(page)).toHaveText(NAME_A);
    await expect(page.getByText(DESCRIPTION_A)).toBeVisible();
    await expect(page.getByText(DESCRIPTION_B)).toHaveCount(0);
    await expect(link).toHaveAttribute('href', `/api/download/${SEED_SKINS.skinA}`);
    await expect(slim(page)).not.toBeChecked(); // seed-skin-a is classic
    // Focus stays on the picked card; the page did not scroll (history.replaceState).
    await expect(linkA).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    // The viewer was not rebuilt: still ONE canvas, ready, now labelled for skin A.
    await expect(readyCanvas(page)).toHaveAttribute('aria-label', `3D view of ${NAME_A} skin`, {
      timeout: VIEWER_TIMEOUT,
    });
    await expect(stage(page).locator('canvas')).toHaveCount(1);
    // Selected AND keyboard-focused (a mouse click never sets :focus-visible — the videos.spec
    // round-trip): the --indigo-lift edge on the card AND the gold ring on the link, both at once.
    await expect(cardA).toHaveCSS('outline-color', INDIGO_LIFT);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(linkA).toBeFocused();
    await expect(linkA).toHaveCSS('outline-color', GOLD);
    await expect(linkA).toHaveCSS('outline-width', '3px');

    // Slim switches the model in place (still one ready canvas).
    await slimLabel(page).click();
    await expect(slim(page)).toBeChecked();
    await expect(readyCanvas(page)).toHaveCount(1, { timeout: VIEWER_TIMEOUT });

    // Controls: Spin / Walk are toggles, Front ⇄ Back is one button whose label flips.
    await spin(page).click();
    await expect(spin(page)).toHaveAttribute('aria-pressed', 'false');
    await walk(page).click();
    await expect(walk(page)).toHaveAttribute('aria-pressed', 'true');
    await flip(page).click();
    await expect(flip(page)).toHaveText('Front');
    await flip(page).click();
    await expect(flip(page)).toHaveText('Back');
    await expect(readyCanvas(page)).toHaveCount(1);

    // Nothing was downloaded: no `download` event yet.
    expect(va.events()).toEqual([]);

    await expectNoSeriousA11y(page);
    await shoot(page, 'skins-selected');

    // Picking card B again returns everything (Slim back to its own model).
    await linkB.click();
    await expect(page).toHaveURL(/\/skins\?skin=seed-skin-b$/);
    await expect(stageName(page)).toHaveText(NAME_B);
    await expect(slim(page)).toBeChecked();
    await expect(linkB).toBeFocused();

    // The route itself (AC4; 04 §2.3): 302 to the public texture with the download filename.
    const routed = await page.request.get(`/api/download/${SEED_SKINS.skinB}`, {
      maxRedirects: 0,
    });
    expect(routed.status()).toBe(302);
    const location = routed.headers()['location'] ?? '';
    expect(location).toContain(
      `/storage/v1/object/public/skins/${SEED_SKINS.skinB}/texture.png?download=${SLUG_B}.png`,
    );
  });

  test('T-E2E-7 /skins?skin=<slug>: a direct load selects that skin without taking focus; an unknown slug falls back to the first', async ({
    page,
  }) => {
    await page.goto(`/skins?skin=${SLUG_A}`, { waitUntil: 'networkidle' });
    await expect(stageName(page)).toHaveText(NAME_A);
    await expect(cardLink(page, SLUG_A)).toHaveAttribute('aria-current', 'true');
    await expect(download(page)).toHaveAttribute('href', `/api/download/${SEED_SKINS.skinA}`);
    await expect(slim(page)).not.toBeChecked();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(page.viewportSize()?.width);

    await page.goto('/skins?skin=nosuchskin', { waitUntil: 'networkidle' });
    await expect(stageName(page)).toHaveText(NAME_B);
    await expect(cardLink(page, SLUG_B)).toHaveAttribute('aria-current', 'true');
    await expect(download(page)).toHaveAttribute('href', `/api/download/${SEED_SKINS.skinB}`);
  });

  test('T-E2E-7 /skins reduced motion: Spin starts off and Walk is disabled', async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/skins', { waitUntil: 'networkidle' });
    await expectViewerReady(page);
    await expect(spin(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(walk(page)).toBeDisabled();
    await expect(flip(page)).toBeEnabled();
    await expectNoSeriousA11y(page);
    await shoot(page, 'skins-reduced-motion');
  });

  test('T-E2E-8 page weight: no skinview3d chunk is requested on / or /projects; /skins loads it lazily once the viewer mounts', async ({
    page,
    requests,
  }) => {
    test.setTimeout(90_000);
    const MARKER = /skinview3d|WebGLRenderer/;
    const isScript = (url: string): boolean => {
      try {
        return new URL(url).pathname.endsWith('.js');
      } catch {
        return false;
      }
    };
    const scriptsSince = (from: number): string[] =>
      Array.from(new Set(requests.slice(from).filter(isScript)));
    const bodyOf = async (url: string): Promise<string> => (await page.request.get(url)).text();

    for (const path of ['/', '/projects']) {
      const from = requests.length;
      await page.goto(path, { waitUntil: 'networkidle' });
      const scripts = scriptsSince(from);
      expect(scripts.length, `${path} requested script chunks`).toBeGreaterThan(0);
      for (const url of scripts) {
        expect(await bodyOf(url), `${path}: ${url} carries skinview3d`).not.toMatch(MARKER);
      }
    }

    const from = requests.length;
    await page.goto('/skins', { waitUntil: 'networkidle' });
    await expectViewerReady(page);
    const hits: string[] = [];
    for (const url of scriptsSince(from)) {
      if (MARKER.test(await bodyOf(url))) hits.push(url);
    }
    expect(
      hits.length,
      '/skins requested the skinview3d chunk after the viewer mounted',
    ).toBeGreaterThan(0);
  });
});
