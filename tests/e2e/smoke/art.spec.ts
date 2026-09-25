/**
 * tests/e2e/smoke/art.spec.ts — T-E2E-9 (05 §7.5; 00 S1.7.AC6 / AC8 / AC10; 02 route row `/art`,
 * SM-07; 03 §2.7 `ArtMasonry` / `ArtCard` / `ArtMasonryLightbox`, §2.3 `Lightbox` meta; DESIGN.md
 * §6 #6, §11.7; ADR-0048 D17): the public `/art` page on SEED-8 + SEED-13, at 1280 and 390.
 *  - title, one h1, the subline; the filter row `ALL 2 · AVATARS 1 · THUMBNAILS 1 · ICONS 0` (the
 *    three kind buttons are FIXED — ICONS stays at 0 so the empty state is reachable; RENDERS /
 *    OTHER appear only when such pieces exist) as links with `aria-current`.
 *  - two `ArtCard`s in a `<ul>`, masonry order (`sort_order` 1, 2 — SEED-8): each ONE
 *    `<a href=<image URL> aria-label="Open <title>" data-art-index>` around a `next/image` whose
 *    `alt` is the title and whose `src` is OUR optimizer over the local Supabase object. The image
 *    is at NATURAL aspect: computed `height` is `auto` (CSS Typed OM — `getComputedStyle` would
 *    report the used px value), the 256×256 avatar box is square and the 1280×720 thumbnail box is
 *    16:9 within 2 % (AC6 "never cropped"), so the two boxes differ.
 *  - filters are URL state owned by the `ArtGallery` island (ADR-0048 D17): AVATARS writes `?kind=avatar`
 *    and leaves one card; ICONS → the §11.7 empty state, strings verbatim; a reload restores it; an
 *    unknown value (`?kind=nonsense`) and a kind with no button (`?kind=render`) fall away to ALL.
 *  - a click on the avatar card opens the lazy `Lightbox` (`dialog[aria-modal]`, the URL stays)
 *    with the title, the year `2025` and a Download link whose `href` is the public object URL +
 *    `?download=seed-art-avatar.png` (Supabase answers `Content-Disposition: attachment` —
 *    05 T-RLS-122); Esc closes it and focus returns to the card link; the thumbnail's lightbox
 *    (opened by keyboard) has NO Download and no year; ←/→ wrap through the shown pieces.
 *  - no horizontal overflow, gold focus rings on the card links and the filter links, axe zero
 *    serious/critical in the unfiltered, filtered, empty and lightbox states; screenshots `art`,
 *    `art-filtered`, `art-empty`, `art-lightbox`.
 * Read-only: nothing here writes `art` (the add / publish legs are T-E2E-38 in the `admin` project).
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

const GOLD = 'rgb(255, 198, 31)'; // --gold
const INDIGO_LIFT = 'rgb(139, 134, 245)'; // --indigo-lift
const LINE_SOFT = 'rgb(44, 58, 75)'; // --line-soft

// SEED-8 (ADR-0048 D20) + SEED-13 object paths (F-8 hashes: icon-256.png / thumb-1280x720.png).
const AVATAR_TITLE = 'Seed Avatar';
const THUMB_TITLE = 'Seed Thumbnail';
const AVATAR_OBJECT = 'art/00000000-0000-4000-8000-000000000701/b64a4e0e96965d51.png';
const THUMB_OBJECT = 'art/00000000-0000-4000-8000-000000000702/6ce87bbf56e4d5f6.png';
const AVATAR_DOWNLOAD = `${AVATAR_OBJECT}?download=seed-art-avatar.png`;

/** DESIGN.md §11.7 Art, verbatim. */
const EMPTY_TITLE = 'NO ART HERE YET';
const EMPTY_LINE = 'Nothing in this filter. Try "all".';

const filterBar = (page: Page) => page.locator('[role="group"][aria-label="Filter"]');
const cards = (page: Page) => page.locator('main ul a[data-art-index]');
const dialog = (page: Page) => page.locator('dialog[aria-modal="true"]');

/** The filter state in the URL, whatever order the bar wrote the params in. */
async function expectQuery(page: Page, want: Record<string, string>): Promise<void> {
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
    })
    .toEqual({ path: '/art', query: want });
}

/** Width ÷ height of an element's box. */
async function aspect(locator: ReturnType<Page['locator']>): Promise<number> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return (box?.width ?? 0) / (box?.height ?? 1);
}

test.describe('art', () => {
  test('T-E2E-9 /art: title, filter row ALL 2 · AVATARS 1 · THUMBNAILS 1 · ICONS 0, two cards at natural aspect (height auto, 1:1 vs 16:9), one <a> per card with aria-label + data-art-index, gold focus rings, axe', async ({
    page,
  }) => {
    const isPhone = (page.viewportSize()?.width ?? 1280) < 600;
    const response = await page.goto('/art', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Art — odsens');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('ART');
    await expect(page.getByText('Pictures people asked for.', { exact: true })).toBeVisible();
    // Nothing takes focus on first render (the island resolves without touching it).
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');

    // Filter row: ALL first and active, then the three FIXED kind buttons — ICONS at 0.
    const filter = filterBar(page);
    const filterNames = await filter
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim()));
    expect(filterNames).toEqual(['ALL 2', 'AVATARS 1', 'THUMBNAILS 1', 'ICONS 0']);
    await expect(filter.getByRole('link', { name: 'ALL 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(filter.getByRole('combobox')).toHaveCount(0); // no selects on this bar

    // Two cards in a <ul>, masonry order: the avatar (sort_order 1) then the thumbnail (2).
    await expect(cards(page)).toHaveCount(2);
    const avatar = cards(page).nth(0);
    const thumb = cards(page).nth(1);
    await expect(avatar).toHaveAttribute('aria-label', `Open ${AVATAR_TITLE}`);
    await expect(avatar).toHaveAttribute('data-art-index', '0');
    await expect(thumb).toHaveAttribute('aria-label', `Open ${THUMB_TITLE}`);
    await expect(thumb).toHaveAttribute('data-art-index', '1');
    expect(await page.locator('main ul li a[data-art-index]').count()).toBe(2); // <li> children
    // Without JS the link opens the image itself (03 §2.7).
    expect(decodeURIComponent((await avatar.getAttribute('href')) ?? '')).toContain(AVATAR_OBJECT);
    expect(decodeURIComponent((await thumb.getAttribute('href')) ?? '')).toContain(THUMB_OBJECT);
    // Visible caption: title + "Kind · year" (the prototype strip); the credit is never shown.
    await expect(avatar.getByText(AVATAR_TITLE, { exact: true })).toBeVisible();
    await expect(avatar.getByText('Avatar · 2025', { exact: true })).toBeVisible();
    await expect(thumb.getByText('Thumbnail', { exact: true })).toBeVisible();

    // The image: alt = title, served by OUR optimizer over the local object (01 INV-54).
    const avatarImg = avatar.locator('img');
    const thumbImg = thumb.locator('img');
    await expect(avatarImg).toHaveAttribute('alt', AVATAR_TITLE);
    await expect(thumbImg).toHaveAttribute('alt', THUMB_TITLE);
    const avatarSrc = (await avatarImg.getAttribute('src')) ?? '';
    expect(avatarSrc).toMatch(/^\/_next\/image\?/);
    expect(decodeURIComponent(avatarSrc)).toContain(AVATAR_OBJECT);
    expect(decodeURIComponent((await thumbImg.getAttribute('src')) ?? '')).toContain(THUMB_OBJECT);
    await expect(avatarImg).toHaveAttribute('width', '256');
    await expect(avatarImg).toHaveAttribute('height', '256');
    await expect(thumbImg).toHaveAttribute('width', '1280');
    await expect(thumbImg).toHaveAttribute('height', '720');

    // Natural aspect (AC6): `height: auto` in the cascade — read through the CSS Typed OM, since
    // getComputedStyle resolves a rendered element's height to its used px value.
    const heights = await page
      .locator('main ul a[data-art-index] img')
      .evaluateAll((imgs) =>
        imgs.map((img) => img.computedStyleMap().get('height')?.toString() ?? ''),
      );
    expect(heights).toEqual(['auto', 'auto']);
    // … and the boxes follow the images' own ratios: square vs 16:9 (within 2 %), so they differ.
    const avatarRatio = await aspect(avatarImg);
    const thumbRatio = await aspect(thumbImg);
    expect(Math.abs(avatarRatio - 1)).toBeLessThan(0.02);
    expect(Math.abs(thumbRatio - 16 / 9) / (16 / 9)).toBeLessThan(0.02);
    const avatarBox = await avatarImg.boundingBox();
    const thumbBox = await thumbImg.boundingBox();
    expect(Math.round(avatarBox?.height ?? 0)).not.toBe(Math.round(thumbBox?.height ?? 0));
    // Columns: side by side at 1280 (four columns), stacked at 390 (one column under 480).
    if (avatarBox && thumbBox) {
      if (isPhone) {
        expect(thumbBox.y).toBeGreaterThanOrEqual(avatarBox.y + avatarBox.height);
        expect(Math.round(thumbBox.x)).toBe(Math.round(avatarBox.x));
        expect(Math.round(thumbBox.width)).toBe(Math.round(avatarBox.width));
      } else {
        expect(thumbBox.x).toBeGreaterThanOrEqual(avatarBox.x + avatarBox.width);
        expect(Math.round(thumbBox.y)).toBe(Math.round(avatarBox.y));
      }
    }

    // The sr-only count line; no lightbox yet.
    await expect(page.getByText('Showing 2 of 2')).toBeAttached();
    await expect(dialog(page)).toHaveCount(0);

    // No sideways scroll; heading levels never skip (h1 → the island's h2).
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(page.viewportSize()?.width);
    const levels = await page
      .locator('main :is(h1, h2, h3, h4)')
      .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
    expect(levels).toEqual([1, 2]);

    // Card at rest: its own 2px --line-soft outline; hover → --indigo-lift (03 §2.7 states).
    await expect(avatar).toHaveCSS('outline-color', LINE_SOFT);
    await expect(avatar).toHaveCSS('outline-width', '2px');
    if (!isPhone) {
      await avatar.hover();
      await expect(avatar).toHaveCSS('outline-color', INDIGO_LIFT);
      await page.mouse.move(0, 0);
      await expect(avatar).toHaveCSS('outline-color', LINE_SOFT);
    }

    // Gold 3px focus ring on the card links and the filter links (DESIGN.md §5; 03 C-25) — the
    // links' own inset outlines would otherwise win over the global `:focus-visible` rule.
    const kindLink = filter.getByRole('link', { name: 'AVATARS 1' });
    const activeLink = filter.getByRole('link', { name: 'ALL 2' }); // aria-current — indigo fill
    for (const target of [avatar, thumb, kindLink, activeLink]) {
      await target.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(target).toBeFocused();
      await expect(target).toHaveCSS('outline-color', GOLD);
      await expect(target).toHaveCSS('outline-width', '3px');
      await expect(target).toHaveCSS('outline-style', 'solid');
      await expect(target).toHaveCSS('outline-offset', '2px');
    }
    await activeLink.blur();

    await expectNoSeriousA11y(page);
    await shoot(page, 'art');
  });

  test('T-E2E-9 /art filters: AVATARS → ?kind=avatar + one card; ICONS → NO ART HERE YET / Nothing in this filter. Try "all". (reload restores it); ?kind=nonsense and a kind with no button fall away; axe', async ({
    page,
  }) => {
    await page.goto('/art');
    const filter = filterBar(page);
    await expect(cards(page)).toHaveCount(2);

    // AVATARS → ?kind=avatar, one card, no reload (RP-02) — the counts stay un-faceted.
    await filter.getByRole('link', { name: 'AVATARS 1' }).click();
    await expectQuery(page, { kind: 'avatar' });
    await expect(filter.getByRole('link', { name: 'AVATARS 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(filter.getByRole('link', { name: 'ALL 2' })).not.toHaveAttribute('aria-current');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toHaveAttribute('aria-label', `Open ${AVATAR_TITLE}`);
    await expect(cards(page)).toHaveAttribute('data-art-index', '0');
    await expect(filter.getByRole('link', { name: 'THUMBNAILS 1' })).toBeVisible();
    await expect(page.getByText('Showing 1 of 2')).toBeAttached(); // sr-only live line
    await expectNoSeriousA11y(page);
    await shoot(page, 'art-filtered');

    // ICONS is a fixed button at 0 (ADR-0048 D17): the §11.7 empty state, strings verbatim (00 AC8).
    await filter.getByRole('link', { name: 'ICONS 0' }).click();
    await expectQuery(page, { kind: 'icon' });
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3, name: EMPTY_TITLE })).toBeVisible();
    await expect(page.getByText(EMPTY_LINE, { exact: true })).toBeVisible();
    await expect(page.getByText('Showing 0 of 2')).toBeAttached();
    // The bar stays: counts are over every published piece, not the filtered set.
    await expect(filter.getByRole('link', { name: 'ALL 2' })).toBeVisible();
    await expect(filter.getByRole('link', { name: 'ICONS 0' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    // The URL is the state: a reload restores the same empty view.
    await page.reload();
    await expectQuery(page, { kind: 'icon' });
    await expect(page.getByRole('heading', { level: 3, name: EMPTY_TITLE })).toBeVisible();
    await expect(filter.getByRole('link', { name: 'ICONS 0' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(cards(page)).toHaveCount(0);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(page.viewportSize()?.width);
    await expectNoSeriousA11y(page);
    await shoot(page, 'art-empty');

    // ALL clears the param and brings everything back.
    await filter.getByRole('link', { name: 'ALL 2' }).click();
    await expectQuery(page, {});
    await expect(cards(page)).toHaveCount(2);

    // A direct load with a filter the bar offers is honoured …
    await page.goto('/art?kind=thumbnail');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toHaveAttribute('aria-label', `Open ${THUMB_TITLE}`);
    await expect(filter.getByRole('link', { name: 'THUMBNAILS 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // … an unknown value falls away silently …
    await page.goto('/art?kind=nonsense');
    await expect(cards(page)).toHaveCount(2);
    await expect(filter.getByRole('link', { name: 'ALL 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.getByRole('heading', { name: EMPTY_TITLE })).toHaveCount(0);
    // … and so does a real kind the bar offers no button for (no render exists → no RENDERS):
    // never an empty masonry under a bar that highlights nothing.
    await page.goto('/art?kind=render');
    await expect(cards(page)).toHaveCount(2);
    await expect(filter.getByRole('link', { name: 'ALL 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(filter.getByRole('link', { name: /RENDERS/ })).toHaveCount(0);
  });

  test('T-E2E-9 /art lightbox: the avatar card opens dialog[aria-modal] with "Seed Avatar", 2025 and a Download link to the public object + ?download=seed-art-avatar.png; Esc closes and focus returns to the card; the thumbnail has no Download; ←/→ wrap; axe', async ({
    page,
  }) => {
    await page.goto('/art', { waitUntil: 'networkidle' });
    const avatar = cards(page).nth(0);
    const thumb = cards(page).nth(1);
    await expect(dialog(page)).toHaveCount(0);

    // Click → the lazy Lightbox (03 C-18) opens on the avatar; the link's own navigation is
    // prevented, so the URL stays.
    await avatar.click();
    const box = dialog(page);
    await expect(box).toBeVisible({ timeout: 15_000 });
    await expect(box).toHaveAttribute('aria-label', 'Image viewer');
    await expect(box).toHaveAttribute('data-state', 'open');
    expect(new URL(page.url()).pathname).toBe('/art');
    await expect(box.getByText(AVATAR_TITLE, { exact: true })).toBeVisible();
    await expect(box.getByText('2025', { exact: true })).toBeVisible();
    const boxImg = box.locator('img');
    await expect(boxImg).toHaveAttribute('alt', AVATAR_TITLE);
    // The picture shows at its own size, or as large as the viewer allows (ADR-0048 D30): the
    // rendered box follows the `width` / `height` attributes, never the srcset candidate's
    // density (which drew a 256-px avatar at 171 px in PR #35 round 1).
    await expect
      .poll(async () =>
        boxImg.evaluate((img) => {
          const el = img as HTMLImageElement;
          // Measure against the viewer's middle grid column (44px | minmax(0, 1fr) | 44px): the
          // figure and media boxes around the image are content-sized and shrink WITH it, so they
          // would agree with a wrongly small picture (round 2 of PR #35).
          const dialog = el.closest('dialog') as HTMLElement;
          const column = parseFloat(
            getComputedStyle(dialog).gridTemplateColumns.split(' ')[1] ?? '0',
          );
          const rendered = Math.round(el.getBoundingClientRect().width);
          const expected = Math.min(Number(el.getAttribute('width')), Math.floor(column));
          return Math.abs(rendered - expected) <= 1 ? 'fits' : `${rendered}px vs ${expected}px`;
        }),
      )
      .toBe('fits');
    expect(decodeURIComponent((await boxImg.getAttribute('src')) ?? '')).toContain(AVATAR_OBJECT);
    // Download only when downloadable (AC6): the public object URL + `?download=<slug>.<ext>`.
    const download = box.getByRole('link', { name: 'Download' });
    await expect(download).toHaveCount(1);
    const href = (await download.getAttribute('href')) ?? '';
    expect(href).toMatch(
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/storage\/v1\/object\/public\//,
    );
    expect(href.endsWith(AVATAR_DOWNLOAD)).toBe(true);
    // Two pieces → both arrows; body scroll is locked while open.
    await expect(box.getByRole('button', { name: 'Previous image' })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Next image' })).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await expectNoSeriousA11y(page);
    await shoot(page, 'art-lightbox');

    // Esc → closed (after the 150ms fade) and focus is back on the opener link (03 §2.7).
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(avatar).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

    // Keyboard open on the thumbnail: no Download, no year; ← wraps to the avatar; Esc → focus back.
    await thumb.focus();
    await page.keyboard.press('Enter');
    await expect(box).toBeVisible();
    await expect(box.getByText(THUMB_TITLE, { exact: true })).toBeVisible();
    await expect(box.getByRole('link', { name: 'Download' })).toHaveCount(0);
    await expect(box.getByText('2025', { exact: true })).toHaveCount(0);
    await expect(box.locator('img')).toHaveAttribute('alt', THUMB_TITLE);
    await page.keyboard.press('ArrowLeft');
    await expect(box.getByText(AVATAR_TITLE, { exact: true })).toBeVisible();
    await expect(box.getByRole('link', { name: 'Download' })).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await expect(box.getByText(THUMB_TITLE, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(thumb).toBeFocused();
    expect(new URL(page.url()).pathname).toBe('/art');
  });
});
