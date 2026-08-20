/**
 * tests/e2e/smoke/home.spec.ts — `/` at S0 (00 S0.AC1/AC3/AC8; 05 T-E2E-17, T-E2E-19, T-E2E-45a).
 * Runs in `smoke-desktop` (1280) and `smoke-phone` (390). Home content (T-E2E-1) arrives in S1.2.
 */
import { stat } from 'node:fs/promises';
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

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

  test('T-E2E-17 skip link, landmarks, heading order, img alt, focus ring, 44px targets', async ({
    page,
  }) => {
    const isPhone = (page.viewportSize()?.width ?? 1280) < 900;
    await page.goto('/');

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
