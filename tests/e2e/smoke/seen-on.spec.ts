/**
 * tests/e2e/smoke/seen-on.spec.ts — T-E2E-10 (05 §7.2; 00 S1.8.AC5 / AC6 / AC11 / AC12; 02 route row
 * `/seen-on`, §2.6; 03 §2.8 `MentionCard` / `SeenOnGrid`, V-04; DESIGN.md §12.1, §12.2, §12.7 #62;
 * ADR-0002 #21 / #33 / #62; ADR-0045): the public `/seen-on` page on SEED-10, at 1280 and 390.
 *  - title, one h1, three `StatTile`s (`VIEWS 1.2M` · `MENTIONS 2` · `CREATORS 2` — shown at every
 *    width, ADR-0045 D20); filter bar `ALL 2 · YOUTUBE 1 · TIKTOK 1` (only platforms with a mention
 *    get a button) + the project `Select` (`All projects` · `Metal Pipe Mace` · `About OddSense`).
 *  - two `MentionCard`s, newest `published_at` first (SEED-10 literals — ADR-0045 D4: YouTube
 *    2026-06-14, TikTok 2026-05-02). The YouTube card is a FACADE (56px play block — D17) whose
 *    footer strip links to `/projects/metal-pipe-mace`; the TikTok card links OUT (`target=_blank`,
 *    `rel="noopener noreferrer"`, chip `WATCH ON TIKTOK`), shows the `PlatformMark` placeholder and
 *    NO remote image of any kind (ADR-0002 #33), and — being about OddSense generally — carries the
 *    `ODSENS` wordmark chip. Creator = public name + link, nothing else (AC11).
 *  - before any click: no `<iframe>` in the HTML or the DOM, ZERO requests to a YouTube / Google
 *    host (matched on `new URL(u).hostname` — the thumbnail is `/_next/image?url=…i.ytimg.com…` on
 *    OUR host, 01 INV-54) and none to TikTok.
 *  - filters are URL state owned by the `SeenOnGrid` island (D15): a click writes `?platform=`,
 *    the select writes `?project=`, a reload and a direct load restore them, a value the bar does
 *    not offer falls away. The empty leg is TIKTOK × Metal Pipe Mace (D22 — the select can never
 *    offer `pixel-chameleon`, which has no mention) → `NOTHING HERE` / `Try another filter.`
 *  - no horizontal overflow, 1-up grid at 390, gold focus rings, axe zero serious/critical in the
 *    unfiltered, filtered, empty and playing states; screenshots `seen-on`, `seen-on-filtered`,
 *    `seen-on-empty`, `seen-on-playing`.
 * H-10: the link-out card is never clicked (it leaves the site); the iframe's own request is
 * aborted by the shared context — the element and its `src` are asserted, never its load.
 * Read-only: the hide / publish / reorder legs write `mentions` and live in
 * tests/e2e/admin/projects.spec.ts (T-E2E-39 — the `admin` project is serial).
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

/** Every host YouTube or Google could be reached on — tested against the HOSTNAME only. */
const GOOGLE_HOST =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|ggpht\.com|google\.com|googleapis\.com|googlevideo\.com|googleusercontent\.com|gstatic\.com|doubleclick\.net)$/;
/** No TikTok host is ever asked for anything — not a thumbnail, not an embed (ADR-0002 #33). */
const TIKTOK_HOST = /(^|\.)(tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com)$/;

function requestsTo(requests: string[], host: RegExp): string[] {
  return requests.filter((url) => {
    try {
      return host.test(new URL(url).hostname);
    } catch {
      return false;
    }
  });
}

const GOLD = 'rgb(255, 198, 31)'; // --gold
const INDIGO_LIFT = 'rgb(139, 134, 245)'; // --indigo-lift
const LINE_SOFT = 'rgb(44, 58, 75)'; // --line-soft

// SEED-10 (ADR-0045 D4).
const YOUTUBE_TITLE = 'Metal Pipe Mace is the loudest mod I have ever installed';
const TIKTOK_TITLE = 'this mod makes no sense and I love it';
const TIKTOK_URL = 'https://www.tiktok.com/@seedtok/video/1';

const filterBar = (page: Page) => page.locator('[role="group"][aria-label="Filter"]');
const cards = (page: Page) => page.locator('main article[data-variant]');
const projectSelect = (page: Page) => page.getByLabel('Project', { exact: true });

/** The filter state in the URL, whatever order the bar wrote the params in. */
async function expectQuery(page: Page, want: Record<string, string>): Promise<void> {
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
    })
    .toEqual({ path: '/seen-on', query: want });
}

test.describe('seen on', () => {
  test('T-E2E-10 /seen-on: title, three stat tiles 1.2M / 2 / 2, filter bar ALL 2 · YOUTUBE 1 · TIKTOK 1 + project select, two cards newest first (facade + TikTok link-out with no remote image, ODSENS chip), zero iframe, zero Google-host requests, axe', async ({
    page,
    requests,
  }) => {
    const isPhone = (page.viewportSize()?.width ?? 1280) < 600;
    const response = await page.goto('/seen-on', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    expect(await response?.text()).not.toContain('<iframe');
    await expect(page).toHaveTitle('Seen on — odsens');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('SEEN ON');
    // Nothing takes focus on first render (the island resolves without touching it).
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');

    // Reach totals over every published mention (02 §2.6): three tiles, label → compact value.
    const tiles = page.locator('main dl');
    await expect(tiles).toHaveCount(3);
    const tileTexts = await tiles.evaluateAll((lists) =>
      lists.map((list) => [
        list.querySelector('dt')?.textContent?.trim() ?? '',
        list.querySelector('dd')?.textContent?.trim() ?? '',
      ]),
    );
    expect(tileTexts).toEqual([
      ['VIEWS', '1.2M'],
      ['MENTIONS', '2'],
      ['CREATORS', '2'],
    ]);
    for (let i = 0; i < 3; i += 1) await expect(tiles.nth(i)).toBeVisible(); // every width (D20)

    // Filter bar: ALL first and active, then one button per platform that HAS a mention.
    const filter = filterBar(page);
    const filterNames = await filter
      .getByRole('link')
      .evaluateAll((links) => links.map((a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim()));
    expect(filterNames).toEqual(['ALL 2', 'YOUTUBE 1', 'TIKTOK 1']);
    await expect(filter.getByRole('link', { name: 'ALL 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // Project select: the projects with a mention + the general bucket, "All projects" selected.
    const select = projectSelect(page);
    await expect(select).toHaveRole('combobox');
    await expect(select).toHaveText('All projects');
    await select.click();
    const options = page.getByRole('listbox', { name: 'Project options' }).getByRole('option');
    await expect(options).toHaveText(['All projects', 'Metal Pipe Mace', 'About OddSense']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Project options' })).toBeHidden();

    // Two cards, newest first: the YouTube mention (14 Jun 2026), then the TikTok one (2 May 2026).
    await expect(cards(page)).toHaveCount(2);
    const youtube = cards(page).nth(0);
    const tiktok = cards(page).nth(1);
    await expect(youtube.getByRole('heading', { level: 3 })).toHaveText(YOUTUBE_TITLE);
    await expect(tiktok.getByRole('heading', { level: 3 })).toHaveText(TIKTOK_TITLE);
    const dates = await cards(page)
      .locator('time')
      .evaluateAll((times) => times.map((t) => t.getAttribute('datetime') ?? ''));
    expect(dates.map((d) => d.slice(0, 10))).toEqual(['2026-06-14', '2026-05-02']);

    // -- YouTube card: a facade (never a frame), creator line, footer strip → the project ---------
    await expect(youtube).toHaveAttribute('data-variant', 'inline');
    await expect(youtube).toHaveAttribute('data-state', 'idle');
    const play = youtube.getByRole('button', { name: `Play ${YOUTUBE_TITLE}`, exact: true });
    await expect(play).toBeVisible();
    const block = await youtube
      .locator('[data-variant="mention"] > button > span:first-child')
      .boundingBox();
    expect(Math.round(block?.width ?? 0)).toBe(56); // ADR-0045 D17 (DESIGN.md §12.7 grid cards)
    expect(Math.round(block?.height ?? 0)).toBe(56);
    const thumb = (await youtube.locator('img[alt=""]').first().getAttribute('src')) ?? '';
    expect(thumb).toMatch(/^\/_next\/image\?/); // OUR host (01 INV-54)
    expect(decodeURIComponent(thumb)).toContain('i.ytimg.com/vi/seedvid0001/');
    await expect(youtube.getByRole('img', { name: 'YouTube' })).toHaveCount(1);
    const creator = youtube.getByRole('link', { name: 'Seed Creator (opens in new tab)' });
    await expect(creator).toHaveAttribute('href', 'https://www.youtube.com/@seedcreator');
    await expect(creator).toHaveAttribute('target', '_blank');
    await expect(creator).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(youtube.getByText('1.2M VIEWS', { exact: true })).toBeVisible();
    await expect(youtube.getByRole('link', { name: /on YouTube/ })).toHaveCount(0); // playing only
    await expect(youtube.getByText('RESOURCE PACK', { exact: true })).toBeVisible();
    const projectLink = youtube.getByRole('link', { name: 'Metal Pipe Mace', exact: true });
    await expect(projectLink).toHaveAttribute('href', '/projects/metal-pipe-mace');
    expect((await projectLink.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(youtube.getByRole('img', { name: 'odsens' })).toHaveCount(0);

    // -- TikTok card: links out, placeholder mark, NO remote image, the ODSENS chip ----------------
    await expect(tiktok).toHaveAttribute('data-variant', 'link-out');
    await expect(tiktok.getByRole('button')).toHaveCount(0);
    // Name = the chip's words + the title (the chip is an inline-block, so the browser's name
    // computation puts a space before the colon).
    const out = tiktok.getByRole('link', {
      name: new RegExp(`^WATCH ON TIKTOK ?: ${TIKTOK_TITLE} \\(opens in new tab\\)$`),
    });
    await expect(out).toHaveAttribute('href', TIKTOK_URL);
    await expect(out).toHaveAttribute('target', '_blank');
    await expect(out).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(out.getByText('WATCH ON TIKTOK', { exact: true })).toBeVisible();
    await expect(out.getByText('↗', { exact: true })).toBeVisible();
    // Every image in the card is the local placeholder mark — never `next/image`, never TikTok's.
    const tiktokImages = await tiktok
      .locator('img')
      .evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src') ?? ''));
    expect(tiktokImages.length).toBeGreaterThan(0);
    for (const src of tiktokImages) expect(src).toBe('/brand/marks/tiktok.svg');
    await expect(tiktok.getByRole('img', { name: 'TikTok' })).toHaveCount(1);
    const tok = tiktok.getByRole('link', { name: 'Seed Tok (opens in new tab)' });
    await expect(tok).toHaveAttribute('href', 'https://www.tiktok.com/@seedtok');
    await expect(tiktok.getByText(/VIEWS?$/)).toHaveCount(0); // NULL count → no "0 VIEWS"
    const chip = tiktok.getByRole('img', { name: 'odsens' });
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('ODSENS');
    await expect(tiktok.getByRole('link', { name: 'Metal Pipe Mace' })).toHaveCount(0);

    // Grid: three tracks at 1280 (the two cards sit side by side), one column at 390.
    const youtubeBox = await youtube.boundingBox();
    const tiktokBox = await tiktok.boundingBox();
    expect(youtubeBox && tiktokBox).toBeTruthy();
    if (youtubeBox && tiktokBox) {
      if (isPhone) {
        expect(tiktokBox.y).toBeGreaterThanOrEqual(youtubeBox.y + youtubeBox.height);
        expect(Math.round(tiktokBox.x)).toBe(Math.round(youtubeBox.x));
      } else {
        expect(tiktokBox.x).toBeGreaterThanOrEqual(youtubeBox.x + youtubeBox.width);
        expect(Math.round(tiktokBox.y)).toBe(Math.round(youtubeBox.y));
        expect(Math.round(tiktokBox.height)).toBe(Math.round(youtubeBox.height));
      }
    }

    // Nothing of YouTube's / Google's / TikTok's before a click — no frame, no request.
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(requestsTo(requests, GOOGLE_HOST)).toEqual([]);
    expect(requestsTo(requests, TIKTOK_HOST)).toEqual([]);
    const optimized = requests
      .filter((url) => new URL(url).pathname === '/_next/image')
      .map((url) => new URL(url).searchParams.get('url') ?? '');
    expect(optimized.some((inner) => inner.includes('i.ytimg.com/vi/seedvid0001/'))).toBe(true);
    expect(optimized.filter((inner) => /tiktok/i.test(inner))).toEqual([]);

    // No sideways scroll; heading levels never skip (h1 → h2 → h3).
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(page.viewportSize()?.width);
    const levels = await page
      .locator('main :is(h1, h2, h3, h4)')
      .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
    expect(levels).toEqual([1, 2, 3, 3]);

    // Gold 3px focus ring on the facade, the link-out thumb, the footer project link — and the
    // filter bar's platform links, whose own 2px --line-soft outline used to win (S1.8 follow-up:
    // FilterBar.module.css `:focus-visible`, DESIGN.md §5 — 3px --gold, 2px offset).
    const platformLink = filter.getByRole('link', { name: 'YOUTUBE 1' });
    const activeLink = filter.getByRole('link', { name: 'ALL 2' }); // aria-current — indigo fill
    for (const target of [play, out, projectLink, platformLink, activeLink]) {
      await target.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(target).toBeFocused();
      await expect(target).toHaveCSS('outline-color', GOLD);
      await expect(target).toHaveCSS('outline-width', '3px');
      await expect(target).toHaveCSS('outline-style', 'solid');
      // The filter links draw their own outline INSIDE the box at rest; focused, the ring sits
      // outside it like everywhere else.
      if (target === platformLink || target === activeLink) {
        await expect(target).toHaveCSS('outline-offset', '2px');
      }
    }
    // At rest the link keeps its own 2px --line-soft outline (no visible change without focus).
    await activeLink.blur();
    await expect(platformLink).toHaveCSS('outline-color', LINE_SOFT);
    await expect(platformLink).toHaveCSS('outline-width', '2px');

    await expectNoSeriousA11y(page);
    await shoot(page, 'seen-on');
  });

  test('T-E2E-10 /seen-on filters: platform + project are URL state that survives a reload; TIKTOK × Metal Pipe Mace → NOTHING HERE / Try another filter.; an unknown value falls away', async ({
    page,
  }) => {
    await page.goto('/seen-on');
    const filter = filterBar(page);
    await expect(cards(page)).toHaveCount(2);

    // YOUTUBE → ?platform=youtube, one card, no reload (RP-02) — the counts stay un-faceted.
    await filter.getByRole('link', { name: 'YOUTUBE 1' }).click();
    await expectQuery(page, { platform: 'youtube' });
    await expect(filter.getByRole('link', { name: 'YOUTUBE 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(filter.getByRole('link', { name: 'ALL 2' })).not.toHaveAttribute('aria-current');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).getByRole('heading', { level: 3 })).toHaveText(YOUTUBE_TITLE);
    await expect(page.getByText('Showing 1 of 2')).toBeAttached(); // sr-only live line
    await expectNoSeriousA11y(page);
    await shoot(page, 'seen-on-filtered');

    // Project select → "About OddSense": with YOUTUBE still on, nothing matches …
    await projectSelect(page).click();
    await page.getByRole('option', { name: 'About OddSense', exact: true }).click();
    await expectQuery(page, { platform: 'youtube', project: 'odsens' });
    await expect(cards(page)).toHaveCount(0);
    // … and ALL brings the general mention back (the project filter is kept).
    await filter.getByRole('link', { name: 'ALL 2' }).click();
    await expectQuery(page, { project: 'odsens' });
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).getByRole('heading', { level: 3 })).toHaveText(TIKTOK_TITLE);
    await expect(projectSelect(page)).toHaveText('About OddSense');

    // The empty filter (ADR-0045 D22): TIKTOK × Metal Pipe Mace — strings verbatim (ADR-0002 #62).
    await filter.getByRole('link', { name: 'TIKTOK 1' }).click();
    await projectSelect(page).click();
    await page.getByRole('option', { name: 'Metal Pipe Mace', exact: true }).click();
    await expectQuery(page, { platform: 'tiktok', project: 'metal-pipe-mace' });
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3, name: 'NOTHING HERE' })).toBeVisible();
    await expect(page.getByText('Try another filter.', { exact: true })).toBeVisible();
    await expect(page.getByText('Showing 0 of 2')).toBeAttached();
    // The tiles and the bar stay: totals are over every published mention, not the filtered set.
    await expect(page.locator('main dl')).toHaveCount(3);
    await expect(filter.getByRole('link', { name: 'ALL 2' })).toBeVisible();

    // The URL is the state: a reload restores the same empty view.
    await page.reload();
    await expectQuery(page, { platform: 'tiktok', project: 'metal-pipe-mace' });
    await expect(page.getByRole('heading', { level: 3, name: 'NOTHING HERE' })).toBeVisible();
    await expect(filter.getByRole('link', { name: 'TIKTOK 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(projectSelect(page)).toHaveText('Metal Pipe Mace');
    await expect(cards(page)).toHaveCount(0);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(page.viewportSize()?.width);
    await expectNoSeriousA11y(page);
    await shoot(page, 'seen-on-empty');

    // A direct load with a filter the bar offers is honoured …
    await page.goto('/seen-on?project=metal-pipe-mace');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).getByRole('heading', { level: 3 })).toHaveText(YOUTUBE_TITLE);
    await expect(projectSelect(page)).toHaveText('Metal Pipe Mace');
    // … and values it does not offer fall away silently: a project without a mention, a platform
    // without one — never an empty grid under a select that reads "All projects".
    await page.goto('/seen-on?platform=twitch&project=pixel-chameleon');
    await expect(cards(page)).toHaveCount(2);
    await expect(filter.getByRole('link', { name: 'ALL 2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(projectSelect(page)).toHaveText('All projects');
    await expect(page.getByRole('heading', { name: 'NOTHING HERE' })).toHaveCount(0);
  });

  test('T-E2E-10 /seen-on play: the YouTube card → one nocookie iframe for seedvid0001, the --indigo-lift outline and "on YouTube ↗"; the link-out card never frames anything; axe', async ({
    page,
    requests,
  }) => {
    await page.goto('/seen-on', { waitUntil: 'networkidle' });
    const youtube = cards(page).nth(0);
    const tiktok = cards(page).nth(1);
    await expect(youtube).toHaveCSS('outline-color', LINE_SOFT);
    const before = await youtube.boundingBox();

    await youtube.getByRole('button', { name: `Play ${YOUTUBE_TITLE}`, exact: true }).click();
    const frame = page.locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect(youtube.locator('iframe')).toHaveCount(1);
    await expect(frame).toHaveAttribute('title', YOUTUBE_TITLE);
    const src = new URL((await frame.getAttribute('src')) ?? '');
    expect(src.origin).toBe('https://www.youtube-nocookie.com');
    expect(src.pathname).toBe('/embed/seedvid0001');
    await expect(frame).toBeFocused();
    await expect(youtube.locator('[data-variant="mention"]')).toHaveAttribute(
      'data-state',
      /^(loading|playing)$/,
    );

    // The playing signal: the card's outline COLOUR swaps (same 2px), the ghost link arrives at
    // the end of the creator row — and nothing moves (the row always holds its 44px).
    await expect(youtube).toHaveAttribute('data-state', 'playing');
    await expect(youtube).toHaveCSS('outline-color', INDIGO_LIFT);
    await expect(youtube).toHaveCSS('outline-width', '2px');
    const watch = youtube.getByRole('link', { name: 'on YouTube ↗ (opens in new tab)' });
    await expect(watch).toHaveAttribute('href', 'https://www.youtube.com/watch?v=seedvid0001');
    await expect(watch).toHaveAttribute('target', '_blank');
    await expect(watch).toHaveAttribute('rel', 'noopener noreferrer');
    expect((await watch.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(youtube.getByText('1.2M VIEWS', { exact: true })).toBeVisible();
    await expect(youtube.locator('time')).toHaveCount(0); // steps aside while the link is there
    const after = await youtube.boundingBox();
    expect([after?.width, after?.height]).toEqual([before?.width, before?.height]);

    // The other card is untouched, and the only Google-family host ever asked is the embed's.
    await expect(tiktok).toHaveAttribute('data-state', 'idle');
    await expect(tiktok).toHaveCSS('outline-color', LINE_SOFT);
    expect(
      requestsTo(requests, GOOGLE_HOST).every(
        (url) => new URL(url).hostname === 'www.youtube-nocookie.com',
      ),
    ).toBe(true);
    expect(requestsTo(requests, TIKTOK_HOST)).toEqual([]);

    await expectNoSeriousA11y(page);
    await shoot(page, 'seen-on-playing');
  });
});
