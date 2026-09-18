/**
 * tests/e2e/smoke/videos.spec.ts — T-E2E-6 (05 §7.2; 00 S1.6.AC2–AC5, AC7, AC10; 02 route row
 * `/videos`, SM-05; 03 §2.6; 01 INV-57; DESIGN.md §6.4, §11.1, §11.5, §12.7): the public `/videos`
 * page on SEED-11 (7 rows — ADR-0043 D8), at 1280 and 390.
 *  - title, one h1; the big player is a FACADE for the newest visible long video (`seedvid0001`):
 *    88px play block, duration chip, CLICK TO LOAD YOUTUBE chip; title / meta / blurb / "Watch on
 *    YouTube"; Up next = 4 rows (`seedvid0001`, `…0004`, `…0005`, `…0006`), none of them a button
 *    (ADR-0043 D5); hidden `seedvid0002` is nowhere in the document (AC7); MORE VIDEOS = the one
 *    remaining long video; the Short `seedvid0003` is ONLY in `ShortsRow` (AC5), 104px, 9:16.
 *  - AC2: no `<iframe>` in the initial HTML or the DOM, and ZERO requests to any YouTube / Google
 *    host before the click — matched on `new URL(u).hostname`, never by substring: thumbnails are
 *    `/_next/image?url=https%3A%2F%2Fi.ytimg.com…` on OUR host, which legitimately contains
 *    "ytimg" in its query (01 INV-54).
 *  - no horizontal page overflow; nothing focused on first render; gold focus ring on the facade,
 *    and ring room inside the Shorts scroller; axe zero serious/critical before and after.
 *  - click → exactly one `iframe`, src `https://www.youtube-nocookie.com/embed/<id>?autoplay=1`, in
 *    the facade's own box; focus lands on the iframe; `video_play {youtube_id, kind:'video'}` on
 *    the `window.va` stub. A Shorts click → STILL one iframe (the hero is a facade again),
 *    `kind:'short'`. A grid card click → still one.
 *  - Up next swap (AC4): click row 2 → the big player, title and `?v=` swap, `aria-current` moves
 *    (selected + focused shows the `--indigo-lift` edge AND the gold ring), focus stays on the row,
 *    the page does not scroll, no iframe, no `video_play`; picking a row while the hero plays
 *    removes the frame. A direct `/videos?v=<id>` load selects that video without taking focus;
 *    a hidden / Short / unknown id falls back to the newest.
 * H-10: the iframe's own request to youtube-nocookie.com is aborted by the shared context — the
 * element and its `src` are asserted, and `data-state` is `loading` or `playing` (its `onLoad`
 * timing is not ours). The empty state + the hide/unhide legs live in
 * tests/e2e/admin/projects.spec.ts (T-E2E-47 — they write `videos`; the `admin` project is serial).
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';
import { SEED_VIDEOS } from '../../helpers/seedIds';
import { stubVa } from '../../helpers/vaStub';

/** Every host YouTube or Google could be reached on (AC2) — tested against the HOSTNAME only. */
const GOOGLE_HOST =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|ggpht\.com|google\.com|googleapis\.com|googlevideo\.com|googleusercontent\.com|gstatic\.com|doubleclick\.net)$/;

function googleHostRequests(requests: string[]): string[] {
  return requests.filter((url) => {
    try {
      return GOOGLE_HOST.test(new URL(url).hostname);
    } catch {
      return false;
    }
  });
}

const GOLD = 'rgb(255, 198, 31)'; // --gold
const INDIGO_LIFT = 'rgb(139, 134, 245)'; // --indigo-lift

const TITLE_ONE = 'Seed Long Video One';
const TITLE_FOUR = 'Seed Long Video Four';
const PLAY_ONE = `Play ${TITLE_ONE}, 10 minutes`;
const PLAY_FOUR = `Play ${TITLE_FOUR}, 12 minutes 4 seconds`;

const hero = (page: Page) => page.locator('[data-variant="hero"]');
const upNext = (page: Page) => page.getByRole('navigation', { name: 'Up next' });
const stageTitle = (page: Page) => page.locator('main h2').first();

/** Side length of a facade's play block (the first child of its button / cover). */
async function playBlock(page: Page, variant: string): Promise<number> {
  const box = await page
    .locator(`[data-variant="${variant}"] > :is(button, span):last-child > span:first-child`)
    .first()
    .boundingBox();
  return Math.round(box?.width ?? 0);
}

test.describe('videos', () => {
  test('T-E2E-6 /videos: facades only, zero Google-host requests, axe; play → one nocookie iframe, focus, video_play video; Short → still one iframe, video_play short', async ({
    page,
    requests,
  }) => {
    const va = await stubVa(page);
    const response = await page.goto('/videos', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    expect(await response?.text()).not.toContain('<iframe'); // 02 SM-05
    await expect(page).toHaveTitle('Videos — odsens');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('VIDEOS');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByText('Mostly me explaining bad decisions.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Subscribe on YouTube' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/@OdSens',
    );

    // The big player: a facade for the newest VISIBLE long video (hidden seedvid0002 is newer).
    await expect(hero(page)).toHaveCount(1);
    await expect(hero(page)).toHaveAttribute('data-state', 'idle');
    const play = page.getByRole('button', { name: PLAY_ONE, exact: true });
    await expect(play).toBeVisible();
    await expect(hero(page).getByText('CLICK TO LOAD YOUTUBE')).toBeVisible();
    await expect(hero(page).getByText('10:00', { exact: true })).toBeVisible();
    expect(await playBlock(page, 'hero')).toBe(88);
    await expect(stageTitle(page)).toHaveText(TITLE_ONE);
    await expect(
      page.getByText('I gave the mace a metal pipe sound and then could not stop swinging it.'),
    ).toBeVisible();
    await expect(page.getByText('This is the whole build')).toHaveCount(0); // first paragraph only
    const watch = page.getByRole('link', { name: /Watch on YouTube/ });
    await expect(watch).toHaveAttribute(
      'href',
      `https://www.youtube.com/watch?v=${SEED_VIDEOS.long.youtubeId}`,
    );
    await expect(watch).toHaveAttribute('target', '_blank');
    await expect(watch).toHaveAttribute('rel', 'noopener noreferrer');
    expect((await watch.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Up next: four rows, newest first, the selected one included; rows are links, never buttons.
    const rows = upNext(page).getByRole('listitem');
    await expect(rows).toHaveCount(4);
    const hrefs = await upNext(page)
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs).toEqual([
      `?v=${SEED_VIDEOS.long.youtubeId}`,
      `?v=${SEED_VIDEOS.long4.youtubeId}`,
      `?v=${SEED_VIDEOS.long5.youtubeId}`,
      `?v=${SEED_VIDEOS.long6.youtubeId}`,
    ]);
    await expect(upNext(page).getByRole('button')).toHaveCount(0);
    await expect(upNext(page).locator('[aria-current="true"]')).toHaveCount(1);
    await expect(upNext(page).getByRole('link').first()).toHaveAttribute('aria-current', 'true');
    await expect(upNext(page).getByText('CLICK TO LOAD YOUTUBE').first()).toBeHidden(); // < 312px (ADR-0043 D23)
    expect(await playBlock(page, 'upnext')).toBe(44);
    const thumb = await upNext(page).locator('[data-variant="upnext"]').first().boundingBox();
    expect(Math.round(thumb?.width ?? 0)).toBe(132);
    // ADR-0043 D22: on every Up next row (the seeded 1:02:03 one included) the duration chip sits
    // under the 44px play block — the two boxes never intersect.
    const overlaps = await upNext(page)
      .locator('[data-variant="upnext"]')
      .evaluateAll((facades) =>
        facades.map((facade) => {
          const cover = facade.lastElementChild;
          const play = cover?.children[0]?.getBoundingClientRect();
          const chip = cover?.children[1]?.lastElementChild?.getBoundingClientRect();
          if (!play || !chip) return true;
          return chip.top < play.bottom && chip.left < play.right && chip.right > play.left;
        }),
      );
    expect(overlaps).toEqual([false, false, false, false]);

    // AC7: the hidden video is nowhere in the document.
    const html = await page.content();
    expect(html).not.toContain(SEED_VIDEOS.hiddenLong.youtubeId);
    expect(html).not.toContain('Seed Long Video Two');

    // MORE VIDEOS: the long videos past Up next — and never a Short (AC5).
    const more = page.locator('section[aria-labelledby="section-title-more-videos"]');
    await expect(more.getByRole('heading', { level: 2 })).toHaveText('MORE VIDEOS');
    await expect(more.getByRole('article')).toHaveCount(1);
    await expect(more.getByRole('heading', { level: 3 })).toHaveText('Seed Long Video Seven');
    await expect(more.locator('[data-variant="card"]')).toHaveAttribute('data-state', 'idle');
    expect(await playBlock(page, 'card')).toBe(56);

    // ShortsRow: the one Short, 104px wide, 9:16, gold chip; its hint chip is hidden (< 312px).
    const shorts = page.locator('section[aria-labelledby="section-title-shorts"]');
    await expect(shorts.getByRole('heading', { level: 2 })).toHaveText('SHORTS');
    await expect(shorts.getByRole('listitem')).toHaveCount(1);
    const shortPlay = page.getByRole('button', { name: /^Play Seed Short: Pipe Bonk/ });
    await expect(shortPlay).toHaveCount(1); // only here: not in the stage, not in the grid
    const tile = await shorts.locator('[data-variant="short"]').boundingBox();
    expect(Math.round(tile?.width ?? 0)).toBe(104);
    expect(Math.round(((tile?.height ?? 0) / (tile?.width ?? 1)) * 9)).toBe(16);
    await expect(shorts.getByText('0:45', { exact: true })).toBeVisible();
    await expect(shorts.getByText('CLICK TO LOAD YOUTUBE')).toBeHidden();
    expect(await playBlock(page, 'short')).toBe(56);

    // AC2: nothing of YouTube's / Google's before the click — no frame, no request (hostname match).
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(googleHostRequests(requests)).toEqual([]);
    expect(requests.some((url) => new URL(url).pathname === '/_next/image')).toBe(true);

    // No sideways scroll; nothing took focus on first render.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(page.viewportSize()?.width);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');

    // Gold focus ring on the facade (drawn around the thumbnail), and ring room in the scroller:
    // the Short's button sits ≥ 5px (3px ring + 2px offset) inside the clipping list on every side.
    await shortPlay.focus();
    await expect(shortPlay).toHaveCSS('outline-color', GOLD);
    await expect(shortPlay).toHaveCSS('outline-width', '3px');
    const inside = await shortPlay.evaluate((button) => {
      const list = button.closest('ul');
      if (list === null) return null;
      const outer = list.getBoundingClientRect();
      const inner = button.getBoundingClientRect();
      return {
        left: inner.left - outer.left,
        top: inner.top - outer.top,
        bottom: outer.bottom - inner.bottom,
      };
    });
    expect(inside?.left ?? 0).toBeGreaterThanOrEqual(5);
    expect(inside?.top ?? 0).toBeGreaterThanOrEqual(5);
    expect(inside?.bottom ?? 0).toBeGreaterThanOrEqual(5);
    await play.focus();
    await expect(play).toHaveCSS('outline-color', GOLD);
    await play.blur();

    await expectNoSeriousA11y(page);
    await shoot(page, 'videos');

    // Click → one privacy-enhanced frame in the facade's own box; focus follows; one event.
    const box = await hero(page).boundingBox();
    await play.click();
    const frame = page.locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('title', TITLE_ONE);
    const src = new URL((await frame.getAttribute('src')) ?? '');
    expect(src.origin).toBe('https://www.youtube-nocookie.com');
    expect(src.pathname).toBe(`/embed/${SEED_VIDEOS.long.youtubeId}`);
    expect(src.searchParams.get('autoplay')).toBe('1');
    await expect(frame).toHaveAttribute('allow', /autoplay/);
    await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    await expect(hero(page)).toHaveAttribute('data-state', /^(loading|playing)$/);
    await expect(page.getByRole('button', { name: PLAY_ONE, exact: true })).toHaveCount(0);
    await expect(frame).toBeFocused();
    const frameBox = await frame.boundingBox();
    expect(Math.round(frameBox?.width ?? 0)).toBe(Math.round(box?.width ?? -1));
    expect(Math.round(frameBox?.height ?? 0)).toBe(Math.round(box?.height ?? -1));
    const after = await hero(page).boundingBox(); // the fixed aspect box kept its size
    expect([after?.width, after?.height]).toEqual([box?.width, box?.height]);
    await expect.poll(() => va.events().length).toBe(1);
    expect(va.events()[0]).toEqual({
      name: 'video_play',
      data: { youtube_id: SEED_VIDEOS.long.youtubeId, kind: 'video' },
    });
    // The only Google-family host ever asked is the privacy-enhanced embed.
    expect(
      googleHostRequests(requests).every(
        (url) => new URL(url).hostname === 'www.youtube-nocookie.com',
      ),
    ).toBe(true);
    await expectNoSeriousA11y(page);
    await shoot(page, 'videos-playing');

    // A Short → still exactly ONE iframe: the hero is a facade again; kind 'short'.
    await shortPlay.click();
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(shorts.locator('iframe')).toHaveCount(1);
    expect(new URL((await page.locator('iframe').getAttribute('src')) ?? '').pathname).toBe(
      `/embed/${SEED_VIDEOS.short.youtubeId}`,
    );
    await expect(hero(page)).toHaveAttribute('data-state', 'idle');
    await expect(page.getByRole('button', { name: PLAY_ONE, exact: true })).toBeVisible();
    await expect(page.locator('iframe')).toBeFocused();
    await expect.poll(() => va.events().length).toBe(2);
    expect(va.events()[1]).toEqual({
      name: 'video_play',
      data: { youtube_id: SEED_VIDEOS.short.youtubeId, kind: 'short' },
    });

    // A grid card → still one.
    await more.getByRole('button', { name: /^Play Seed Long Video Seven/ }).click();
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(more.locator('iframe')).toHaveCount(1);
    await expect.poll(() => va.events().length).toBe(3);
    expect(va.events()[2]).toEqual({
      name: 'video_play',
      data: { youtube_id: SEED_VIDEOS.long7.youtubeId, kind: 'video' },
    });
    await expectNoSeriousA11y(page);
  });

  test('T-E2E-6 /videos Up next: row 2 swaps the big player, ?v=, aria-current and keeps focus; no iframe, no event; a pick while playing removes the frame', async ({
    page,
    requests,
  }) => {
    const va = await stubVa(page);
    await page.goto('/videos', { waitUntil: 'networkidle' });
    const links = upNext(page).getByRole('link');
    const second = links.nth(1);
    await expect(second).toContainText(TITLE_FOUR);
    await expect(second).not.toHaveAttribute('aria-current', 'true');

    await expectNoSeriousA11y(page);
    await second.scrollIntoViewIfNeeded();
    const scrollY = await page.evaluate(() => window.scrollY);
    await second.click();

    await expect(page).toHaveURL(/\/videos\?v=seedvid0004$/);
    await expect(stageTitle(page)).toHaveText(TITLE_FOUR);
    await expect(page.getByRole('button', { name: PLAY_FOUR, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: PLAY_ONE, exact: true })).toHaveCount(0);
    await expect(page.getByText('A very small chameleon, a very large problem.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Watch on YouTube/ })).toHaveAttribute(
      'href',
      `https://www.youtube.com/watch?v=${SEED_VIDEOS.long4.youtubeId}`,
    );
    await expect(second).toHaveAttribute('aria-current', 'true');
    await expect(upNext(page).locator('[aria-current="true"]')).toHaveCount(1);
    await expect(links.first()).not.toHaveAttribute('aria-current', 'true');
    // Selection never plays: no frame, no event, nothing asked of YouTube.
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(va.events()).toEqual([]);
    expect(googleHostRequests(requests)).toEqual([]);
    // Focus stays on the picked row; the page did not scroll (history.replaceState — ADR-0043 D24).
    await expect(second).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    // Keyboard: selected AND focused — the --indigo-lift edge and the gold ring, both at once.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(second).toBeFocused();
    await expect(second).toHaveCSS('outline-color', GOLD);
    await expect(second).toHaveCSS('outline-width', '3px');
    // (retried: the edge colour eases in over --dur-fast)
    await expect(second).toHaveCSS(
      'box-shadow',
      new RegExp(`^${INDIGO_LIFT.replace(/[()]/g, '\\$&')}`),
    );
    await expectNoSeriousA11y(page);
    await shoot(page, 'videos-selected');

    // Enter on the next row selects it too.
    await page.keyboard.press('Tab');
    await expect(links.nth(2)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/videos\?v=seedvid0005$/);
    await expect(links.nth(2)).toHaveAttribute('aria-current', 'true');
    await expect(links.nth(2)).toBeFocused();
    // seedvid0006 has no description: no blurb, and the block keeps its height (no shift).
    const before = await upNext(page).boundingBox();
    await links.nth(3).click();
    await expect(page).toHaveURL(/\/videos\?v=seedvid0006$/);
    await expect(stageTitle(page)).toHaveText('Seed Long Video Six');
    expect(await upNext(page).boundingBox()).toEqual(before);

    // Play the big player, then pick another row: the frame goes, no second one appears.
    await page.getByRole('button', { name: /^Play Seed Long Video Six/ }).click();
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect.poll(() => va.events().length).toBe(1);
    await links.first().click();
    await expect(page).toHaveURL(/\/videos\?v=seedvid0001$/);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(hero(page)).toHaveAttribute('data-state', 'idle');
    await expect(page.getByRole('button', { name: PLAY_ONE, exact: true })).toBeVisible();
    expect(va.events()).toHaveLength(1);
  });

  test('T-E2E-6 /videos?v=<id>: a direct load selects that video without taking focus; hidden, Short and unknown ids fall back to the newest', async ({
    page,
  }) => {
    await page.goto(`/videos?v=${SEED_VIDEOS.long5.youtubeId}`, { waitUntil: 'networkidle' });
    await expect(stageTitle(page)).toContainText('Seed Long Video Five');
    await expect(upNext(page).getByRole('link').nth(2)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(page.viewportSize()?.width);

    // A grid video is selectable by URL; no Up next row is outlined then.
    await page.goto(`/videos?v=${SEED_VIDEOS.long7.youtubeId}`, { waitUntil: 'networkidle' });
    await expect(stageTitle(page)).toHaveText('Seed Long Video Seven');
    await expect(upNext(page).locator('[aria-current="true"]')).toHaveCount(0);

    for (const id of [
      SEED_VIDEOS.hiddenLong.youtubeId,
      SEED_VIDEOS.short.youtubeId,
      'nosuchvideo',
    ]) {
      await page.goto(`/videos?v=${id}`, { waitUntil: 'networkidle' });
      await expect(stageTitle(page)).toHaveText(TITLE_ONE);
      await expect(upNext(page).getByRole('link').first()).toHaveAttribute('aria-current', 'true');
      expect(await page.content()).not.toContain('Seed Long Video Two');
    }
  });
});
