/**
 * tests/e2e/smoke/home.spec.ts — `/` (00 S0.AC1/AC3/AC8; 05 T-E2E-17, T-E2E-19, T-E2E-45a;
 * S1.2: T-E2E-1 hero + featured, T-E2E-45b sitemap). Runs in `smoke-desktop` (1280) and
 * `smoke-phone` (390).
 *
 * T-E2E-1 by slice (05 §8): S1.2 "hero + featured", S1.6 "Latest videos" — its own test below.
 * The IN THE WILD strip + ReachLine (S1.8), the footer creators line (S1.8),
 * `FloatingSupportButton` (S1.9 — 03 Slice cell) and the 4-up `ExclusiveBadge` text
 * "ONLY ON ODSENS" (S1.3 — 03 `ProjectCard` "the `ExclusiveBadge` itself ships in S1.3") are NOT
 * asserted yet; their rows extend this spec in those slices. Seed truths (SEED-6): hero =
 * pixel-chameleon (featured_order 1), Featured 4-up = seed-exclusive-pack only (hero excluded,
 * 02 §2.1 — no back-fill). SEED-11 (7 rows — ADR-0043 D8): the Home 2-up = `seedvid0001` +
 * `seedvid0004`; `seedvid0002` is hidden (and the newest row overall), `seedvid0003` is a Short.
 *
 * T-E2E-1 Latest videos leg (00 S1.6.AC2 / AC6; 02 §2.1 #4; ADR-0041 D6; ADR-0043 D15): two
 * facades and no `<iframe>`, ZERO requests to any YouTube / Google host — matched on
 * `new URL(u).hostname`, never by substring: thumbnails are `/_next/image?url=https%3A%2F%2F
 * i.ytimg.com…` on OUR host (01 INV-54) — the three RP-13 "Find me" links, exactly one compact
 * `TipPanel` in the same row, columns side by side at 1280 and stacked at 390, gold focus rings,
 * 44px targets, no horizontal overflow, axe, screenshot. The 0-videos column (§11.7 empty state)
 * is asserted where `videos` is written: tests/e2e/admin/projects.spec.ts (T-E2E-47).
 */
import { stat } from 'node:fs/promises';
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';
import { SEED_VIDEOS } from '../../helpers/seedIds';

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

/** 02 RP-13 — the "Find me" links, in order. */
const FIND_ME_LINKS = [
  { name: 'Modrinth', href: 'https://modrinth.com/user/OddSense/mods' },
  { name: 'CurseForge', href: 'https://www.curseforge.com/members/oddsense/projects' },
  { name: 'YouTube', href: 'https://www.youtube.com/@OdSens' },
];

const NAV_ORDER = ['Projects', 'Videos', 'Skins', 'Art', 'Seen on'];
const SUPPORT_TEXT = /♥\s*SUPPORT/;

test.describe('home', () => {
  test('S0.AC1 nav order, Support, burger, footer groups · T-E2E-45a robots · T-E2E-19 screenshot', async ({
    page,
    request,
    requests,
  }) => {
    const isPhone = (page.viewportSize()?.width ?? 1280) < 900;

    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    const nav = page.locator('header nav[aria-label="Main"]');
    await expect(nav).toHaveCount(1);

    // No "Home" item (03 N-02) and no "Commissions" item while FLAGS.commissions is false (01 INV-74).
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Commissions' })).toHaveCount(0);

    if (!isPhone) {
      const linkTexts = await nav.locator('a:visible').evaluateAll((els) =>
        els
          .filter((el) => {
            const href = el.getAttribute('href') ?? '';
            return href !== '/' && href !== '/support';
          })
          .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()),
      );
      expect(linkTexts).toEqual(NAV_ORDER);

      const support = nav.locator('a[href="/support"]');
      await expect(support).toBeVisible();
      await expect(support).toHaveText(SUPPORT_TEXT);
    } else {
      const burger = page.locator('header button[aria-label="Menu"]');
      await expect(burger).toBeVisible();
      const box = await burger.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(burger).toHaveAttribute('aria-expanded', 'false');

      await burger.click();
      const panel = page.locator('#nav-menu[data-state="open"]');
      await expect(panel).toBeVisible();
      await expect(burger).toHaveAttribute('aria-expanded', 'true');

      const menuTexts = await panel
        .locator('a:visible')
        .evaluateAll((els) => els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()));
      expect(menuTexts.slice(0, NAV_ORDER.length)).toEqual(NAV_ORDER);
      const last = menuTexts[menuTexts.length - 1] ?? '';
      expect(last).toMatch(SUPPORT_TEXT);
      const support = panel.locator('a[href="/support"]');
      await expect(support).toBeVisible();
      await expect(support).toHaveText(SUPPORT_TEXT);

      await page.keyboard.press('Escape');
      await expect(page.locator('#nav-menu[data-state="open"]')).toHaveCount(0);
      await expect(burger).toBeFocused();
    }

    // Footer landmark (03 Footer row; 02 RP-13; 01 INV-74).
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveCount(1);
    await expect(footer.getByRole('link', { name: /custom orders/i })).toHaveCount(0);
    expect(await footer.getByText(/^\s*find me\s*$/i).count()).toBeGreaterThan(0);
    expect(await footer.getByText(/^\s*site\s*$/i).count()).toBeGreaterThan(0);

    // S0.AC3 fonts: self-hosted WOFF2, no Google/CDN host.
    expect(requests.filter((u) => /googleapis|gstatic/i.test(u))).toEqual([]);
    // next/font/local rewrites `public/fonts/*.woff2` to `/_next/static/media/*.woff2` at build time;
    // both self-hosted paths satisfy S0.AC3 ("served from /fonts/*.woff2, no Google/CDN host").
    const woff2 = requests.filter((u) => {
      const { pathname } = new URL(u);
      return (
        pathname.endsWith('.woff2') &&
        (pathname.startsWith('/fonts/') || pathname.startsWith('/_next/static/media/'))
      );
    });
    expect(woff2.length).toBeGreaterThan(0);

    // T-E2E-45a robots (02 SM-24; ADR-0002 A9).
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain('Disallow: /admin');

    await expectNoSeriousA11y(page);
    const file = await shoot(page, 'home');
    // T-E2E-19 — screenshot exists and is non-empty (design-fidelity input).
    const info = await stat(file);
    expect(info.size).toBeGreaterThan(0);
  });

  test('T-E2E-1 hero + featured (S1.2 scope): one h1 = pixel-chameleon, gold DOWNLOAD, 4-up = seed-exclusive-pack only, footer lines', async ({
    page,
  }) => {
    const isPhone = (page.viewportSize()?.width ?? 1280) < 900;
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('odsens'); // 02 SM-01: absolute, no template

    // Exactly one h1 — the Bungee hero title of pixel-chameleon (lowest featured_order).
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('Pixel Chameleon');

    // Wordmark links to `/`; nav has no Commissions; Support button present (02 §2.1 / 03 N-04).
    await expect(page.locator('header a[aria-label="odsens home"]')).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: 'Commissions' })).toHaveCount(0);
    if (!isPhone) {
      await expect(page.locator('header nav a[href="/support"]')).toBeVisible();
    }

    // Hero CTAs: gold DOWNLOAD → the Modrinth listing URL from the seed `external_id` `sd000102`
    // (synced hero with no hosted file — 02 §2.1 #1 as amended by ADR-0037 D6), tracked
    // (`TrackedLink`, gold face via Button recipe); secondary "See the project" → the detail page.
    const hero = page.locator('section', { has: h1 });
    const download = hero.getByRole('link', { name: 'DOWNLOAD' });
    await expect(download).toHaveAttribute('href', 'https://modrinth.com/project/sd000102');
    await expect(download.locator('[data-variant="gold"]')).toBeVisible();
    await expect(hero.getByRole('link', { name: 'See the project' })).toHaveAttribute(
      'href',
      '/projects/pixel-chameleon',
    );
    await expect(hero.getByText('OddSense makes things for Minecraft.')).toBeVisible();

    // Featured 4-up: seed-exclusive-pack ONLY (hero excluded; no back-fill — 02 §2.1 #2).
    const featured = page.locator('section', {
      has: page.getByRole('heading', { name: 'FEATURED PROJECTS' }),
    });
    await expect(featured.locator('article')).toHaveCount(1);
    await expect(featured.getByRole('heading', { name: 'Seed Exclusive Pack' })).toBeVisible();
    await expect(featured.getByRole('heading', { name: 'Pixel Chameleon' })).toHaveCount(0);

    // Footer (02 RP-13; DESIGN.md §12.2): the Mojang line + the Site links, in order.
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByText(/Not affiliated with Mojang\./)).toBeVisible();
    const siteHrefs = await footer
      .locator('a[href^="/"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(siteHrefs).toEqual([
      '/projects',
      '/seen-on',
      '/support',
      '/how-comments-work',
      '/privacy',
    ]);

    await expectNoSeriousA11y(page);
  });

  test('T-E2E-1 Latest videos (S1.6): two facades = seedvid0001 + seedvid0004, zero iframe, zero Google-host requests, Find me links, one compact TipPanel in the row, axe', async ({
    page,
    requests,
  }) => {
    const isPhone = (page.viewportSize()?.width ?? 1280) < 900;
    const response = await page.goto('/', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    expect(await response?.text()).not.toContain('<iframe');

    // Videos column: h2 + the channel link (external, new tab) + the two newest visible long videos.
    const latest = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'LATEST VIDEOS' }),
    });
    await expect(latest).toHaveCount(1);
    const channel = latest.getByRole('link', { name: /@OdSens on YouTube/ });
    await expect(channel).toHaveAttribute('href', 'https://www.youtube.com/@OdSens');
    await expect(channel).toHaveAttribute('target', '_blank');
    await expect(channel).toHaveAttribute('rel', /noopener/);

    const cards = latest.locator('article[data-variant="home"]');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByRole('heading', { level: 3 })).toHaveText('Seed Long Video One');
    await expect(cards.nth(1).getByRole('heading', { level: 3 })).toHaveText(
      'Seed Long Video Four',
    );
    // Every card is a facade button — the only interactive element in it (03 `VideoCard`).
    const facades = latest.getByRole('button', { name: /^Play / });
    await expect(facades).toHaveCount(2);
    await expect(facades.nth(0)).toHaveAccessibleName(/^Play Seed Long Video One/);
    await expect(facades.nth(1)).toHaveAccessibleName(/^Play Seed Long Video Four/);
    await expect(cards.locator('a')).toHaveCount(0);
    // Thumbnails ride `next/image` on OUR host (01 INV-54) — never a raw ytimg URL.
    const thumbs = await latest
      .locator('img')
      .evaluateAll((els) => els.map((el) => el.getAttribute('src') ?? ''));
    expect(thumbs).toHaveLength(2);
    for (const [i, id] of [SEED_VIDEOS.long.youtubeId, SEED_VIDEOS.long4.youtubeId].entries()) {
      expect(thumbs[i]).toMatch(/^\/_next\/image\?/);
      expect(decodeURIComponent(thumbs[i] ?? '')).toContain(`/vi/${id}/`);
    }
    // AC6 / AC7 / AC5: the hidden row (newest overall) and the Short are nowhere on Home.
    const html = await page.content();
    expect(html).not.toContain(SEED_VIDEOS.hiddenLong.youtubeId);
    expect(html).not.toContain(SEED_VIDEOS.short.youtubeId);
    await expect(page.getByText(/Seed Long Video Two|Seed Short/)).toHaveCount(0);

    // AC2: nothing is an iframe, and nothing went to a YouTube / Google host (hostname match).
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(googleHostRequests(requests)).toEqual([]);

    // Side column: FIND ME — the three RP-13 links, in order, each a new tab with its mark.
    const find = page.locator('section', {
      has: page.getByRole('heading', { level: 2, name: 'FIND ME' }),
    });
    await expect(find).toHaveCount(1);
    const findLinks = find.getByRole('link');
    await expect(findLinks).toHaveCount(FIND_ME_LINKS.length);
    for (const [i, link] of FIND_ME_LINKS.entries()) {
      const row = findLinks.nth(i);
      await expect(row).toHaveAccessibleName(new RegExp(`${link.name}.*opens in new tab`));
      await expect(row).toHaveAttribute('href', link.href);
      await expect(row).toHaveAttribute('target', '_blank');
      await expect(row).toHaveAttribute('rel', /noopener/);
      await expect(row.getByRole('img', { name: link.name })).toHaveCount(1);
      const box = await row.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // The footer column stays (02 RP-13): same three hrefs there.
    const footerHrefs = await page
      .getByRole('contentinfo')
      .locator('a[target="_blank"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(footerHrefs).toEqual(FIND_ME_LINKS.map((link) => link.href));

    // Exactly ONE compact TipPanel on `/` (00 S1.5b.AC4; T-E2E-49), in this row, under Find me.
    const tip = page.locator('aside[aria-label="Support"][data-compact]');
    await expect(tip).toHaveCount(1);
    await expect(tip.locator('a[data-variant="gold-ink"]')).toHaveAttribute('href', '/support');
    const row = latest.locator('xpath=..');
    await expect(row.locator('aside[aria-label="Support"][data-compact]')).toHaveCount(1);
    await expect(row.getByRole('heading', { level: 2, name: 'FIND ME' })).toHaveCount(1);

    // Layout: videos | (Find me over the panel) at 1280; one column in DOM order below 900.
    const latestBox = await latest.boundingBox();
    const findBox = await find.boundingBox();
    const tipBox = await tip.boundingBox();
    expect(latestBox && findBox && tipBox).toBeTruthy();
    if (latestBox && findBox && tipBox) {
      expect(tipBox.y).toBeGreaterThanOrEqual(findBox.y + findBox.height);
      expect(Math.round(tipBox.x)).toBe(Math.round(findBox.x));
      expect(Math.round(tipBox.width)).toBe(Math.round(findBox.width));
      if (isPhone) {
        expect(findBox.y).toBeGreaterThanOrEqual(latestBox.y + latestBox.height);
        expect(Math.round(findBox.x)).toBe(Math.round(latestBox.x));
        // DESIGN.md §3: 24px page gutter on phones, both sides.
        expect(Math.round(latestBox.x)).toBe(24);
        expect(Math.round(latestBox.width)).toBe((page.viewportSize()?.width ?? 390) - 48);
      } else {
        expect(findBox.x).toBeGreaterThanOrEqual(latestBox.x + latestBox.width);
        expect(Math.round(findBox.y)).toBe(Math.round(latestBox.y));
      }
    }
    // The channel link is a 44px target at both widths.
    const channelBox = await channel.boundingBox();
    expect(channelBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    // No horizontal page overflow (PR #21 lesson).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    // Nothing takes focus on first render; the gold 3px ring shows on the channel link, on a
    // Find me row (its slab edge is an outline too — the ring must win) and on a facade.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    for (const target of [channel, findLinks.first(), facades.first()]) {
      await target.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(target).toBeFocused();
      await expect(target).toHaveCSS('outline-color', GOLD);
      await expect(target).toHaveCSS('outline-width', '3px');
      await expect(target).toHaveCSS('outline-style', 'solid');
    }

    await expectNoSeriousA11y(page);
    await shoot(page, 'home-latest-videos');
  });

  test('T-E2E-45b /sitemap.xml → 200, lists /projects + published slugs, no noindexed URLs', async ({
    request,
  }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<loc>http://localhost:3000/projects</loc>');
    // Published, non-hidden slugs are listed (02 RP-07; slugs from the `projects`-tagged read).
    expect(xml).toContain('<loc>http://localhost:3000/projects/pixel-chameleon</loc>');
    expect(xml).toContain('<loc>http://localhost:3000/projects/metal-pipe-mace</loc>');
    expect(xml).toContain('<loc>http://localhost:3000/projects/seed-exclusive-pack</loc>');
    for (const banned of ['/admin', '/welcome', '/profile', '/__test']) {
      expect(xml, `${banned} never appears in the sitemap`).not.toContain(banned);
    }
  });

  test('T-E2E-17 skip link, landmarks, heading order, img alt, focus ring, 44px targets', async ({
    page,
  }) => {
    const isPhone = (page.viewportSize()?.width ?? 1280) < 900;
    await page.goto('/');
    // An expired ISR entry streams the shell (loading fallback) first — settle on the hero h1
    // before sampling document structure (heading order is judged on the finished page).
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // Skip link is the first focusable element and targets #main (03 SkipLink row, N-07).
    await page.keyboard.press('Tab');
    const skip = page.locator(':focus');
    await expect(skip).toHaveAttribute('href', '#main');
    await expect(skip).toBeVisible();
    await expect(skip).toHaveText(/skip to content/i);
    await expect(page.locator('main#main')).toHaveCount(1);

    // Landmarks header / nav / main / footer.
    await expect(page.locator('header')).toHaveCount(1);
    await expect(page.locator('header nav[aria-label="Main"]')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('footer')).toHaveCount(1);

    // Heading levels never skip (h1..h6 in DOM order; first heading is the h1).
    const levels = await page
      .locator('h1, h2, h3, h4, h5, h6')
      .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
    expect(levels.length).toBeGreaterThan(0);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      const prev = levels[i - 1] ?? 1;
      const cur = levels[i] ?? 1;
      expect(cur, `heading order ${levels.join(' → ')} skips a level`).toBeLessThanOrEqual(
        prev + 1,
      );
    }

    // Every img has an alt attribute (decorative = alt="").
    const imgsWithoutAlt = await page
      .locator('img')
      .evaluateAll((els) => els.filter((el) => !el.hasAttribute('alt')).map((el) => el.outerHTML));
    expect(imgsWithoutAlt).toEqual([]);

    // Focus ring on the first nav link reached by keyboard: outline 3px --gold (DESIGN.md §9).
    let onNavLink = false;
    for (let i = 0; i < 6 && !onNavLink; i += 1) {
      await page.keyboard.press('Tab');
      onNavLink = await page.evaluate(() => {
        const el = document.activeElement;
        return (
          el instanceof HTMLAnchorElement && el.closest('header nav[aria-label="Main"]') !== null
        );
      });
    }
    expect(onNavLink).toBe(true);
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement as Element);
      return { color: cs.outlineColor, width: cs.outlineWidth };
    });
    expect(ring.color).toBe('rgb(255, 198, 31)');
    expect(ring.width).toBe('3px');

    // Phone: every visible a/button in header + footer is at least 44×44 CSS px.
    if (isPhone) {
      const targets = page.locator('header a, header button, footer a, footer button');
      const count = await targets.count();
      const small: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const el = targets.nth(i);
        if (!(await el.isVisible())) continue;
        const box = await el.boundingBox();
        if (!box) continue;
        if (box.width < 44 || box.height < 44) {
          small.push(
            `${await el.evaluate((n) => n.outerHTML.slice(0, 80))} → ${box.width}×${box.height}`,
          );
        }
      }
      expect(small, 'interactive targets under 44×44 on phone').toEqual([]);
    }
  });
});
