/**
 * tests/e2e/flows/floating-support.spec.ts — T-E2E-49 (05 §7; 00 S1.5b.AC3/AC4/AC5/AC6; 02 RP-15 /
 * SM-31; 03 §2.1 `FloatingSupportButton`, §2.3 `TipPanel`; 04 §5.6; DESIGN.md §5; ADR-0002 #80).
 *  - FSB present on `/`, `/projects/pixel-chameleon`, `/videos`; ABSENT on `/support`, `/welcome`
 *    (the `nohandle` account) and `/admin` (the anon `AdminGate`); it is one `<a href="/support">`
 *    reading `♥ SUPPORT`, ≥44px, fixed bottom-right.
 *  - scroll down → `data-state="hidden"` and it leaves the viewport; scroll up → `visible`;
 *    keyboard focus while hidden brings it back (never focus off-screen).
 *  - `prefers-reduced-motion: reduce` → no transform at all, the hide is opacity only.
 *  - phone (390): `data-compact`, a 52px square, heart only (the word is visually hidden).
 *  - click → `/support` + `tip_click {from:'floating'}` on the `window.va` stub — no `amount`.
 *  - `TipPanel`: `<aside aria-label="Support">` in the detail rail and (compact) on `/`, its
 *    `a[data-variant="gold-ink"]` → `/support`, `tip_click {from:'tip-panel'}`; static — no dismiss
 *    control, nothing opens in place.
 *  - axe zero serious/critical on `/` with the FSB visible.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { loginAs, logout } from '../../helpers/loginAs';
import { stubVa } from '../../helpers/vaStub';

const DETAIL = '/projects/pixel-chameleon';

function fsb(page: Page) {
  return page.locator('a[aria-label="Support OddSense on Ko-fi"]');
}

/** The positioned wrapper that carries `data-state` / `data-compact` (03 §3). */
function fsbRoot(page: Page) {
  return page.locator('div[data-state]:has(> a[aria-label="Support OddSense on Ko-fi"])');
}

async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo(0, top), y);
}

async function inViewport(page: Page): Promise<boolean> {
  return fsb(page).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  });
}

test.describe('FloatingSupportButton + TipPanel (T-E2E-49)', () => {
  test('T-E2E-49 FSB present on /, a project, /videos; absent on /support, /admin, /welcome', async ({
    page,
  }) => {
    for (const path of ['/', DETAIL, '/videos']) {
      await page.goto(path);
      await expect(fsb(page), path).toHaveCount(1);
      await expect(fsb(page), path).toBeVisible();
      await expect(fsb(page)).toHaveAttribute('href', '/support');
      await expect(fsb(page)).toHaveText(/♥\s*SUPPORT/);
      const box = await fsb(page).boundingBox();
      expect(box?.height ?? 0, path).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0, path).toBeGreaterThanOrEqual(44);
    }
    // Bottom-right, 24px inset (DESIGN.md §5).
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const box = await fsb(page).boundingBox();
    expect(Math.round(viewport.width - ((box?.x ?? 0) + (box?.width ?? 0)))).toBe(24);
    expect(Math.round(viewport.height - ((box?.y ?? 0) + (box?.height ?? 0)))).toBe(24);

    for (const path of ['/support', '/admin']) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await expect(fsb(page), path).toHaveCount(0);
    }

    await loginAs(page, 'nohandle');
    await page.goto('/welcome', { waitUntil: 'networkidle' });
    expect(new URL(page.url()).pathname).toBe('/welcome');
    await expect(fsb(page), '/welcome').toHaveCount(0);
    await logout(page);
  });

  test('T-E2E-49 FSB hides on scroll-down, returns on scroll-up, returns on focus; axe on /', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(fsbRoot(page)).toHaveAttribute('data-state', 'visible');
    await expectNoSeriousA11y(page);

    await page.goto(DETAIL, { waitUntil: 'networkidle' });
    await expect(fsbRoot(page)).toHaveAttribute('data-state', 'visible');
    await scrollTo(page, 600);
    await expect(fsbRoot(page)).toHaveAttribute('data-state', 'hidden');
    await expect.poll(() => inViewport(page)).toBe(false);

    await scrollTo(page, 300);
    await expect(fsbRoot(page)).toHaveAttribute('data-state', 'visible');
    await expect.poll(() => inViewport(page)).toBe(true);

    // Hidden + keyboard focus → back on screen.
    await scrollTo(page, 900);
    await expect(fsbRoot(page)).toHaveAttribute('data-state', 'hidden');
    await expect.poll(() => inViewport(page)).toBe(false);
    await fsb(page).focus();
    await expect.poll(() => inViewport(page)).toBe(true);
  });

  test('T-E2E-49 reduced motion: the hide has no transform — opacity only', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(DETAIL, { waitUntil: 'networkidle' });
    await scrollTo(page, 600);
    const root = fsbRoot(page);
    await expect(root).toHaveAttribute('data-state', 'hidden');
    await expect.poll(() => root.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    const style = await root.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { transform: computed.transform, transition: computed.transitionProperty };
    });
    expect(style.transform).toBe('none');
    expect(style.transition).not.toContain('transform');
    await scrollTo(page, 100);
    await expect(root).toHaveAttribute('data-state', 'visible');
    await expect.poll(() => root.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });

  test('T-E2E-49 click → /support + tip_click {from:"floating"}; TipPanel (rail + Home compact) → {from:"tip-panel"}', async ({
    page,
  }) => {
    const va = await stubVa(page);
    await page.goto(DETAIL, { waitUntil: 'networkidle' });

    // TipPanel in the rail: static aside, one gold-ink link, no dismiss control.
    const panel = page.locator('aside[aria-label="Support"]');
    await expect(panel).toHaveCount(1);
    await expect(panel).toContainText('Support OddSense on Ko-fi.');
    await expect(panel.locator('button')).toHaveCount(0);
    const tip = panel.locator('a[data-variant="gold-ink"]');
    await expect(tip).toHaveAttribute('href', '/support');

    await fsb(page).click();
    await page.waitForURL('**/support');
    await expect.poll(() => va.events().length).toBe(1);
    expect(va.events()[0]).toEqual({ name: 'tip_click', data: { from: 'floating' } });

    await page.goto(DETAIL, { waitUntil: 'networkidle' });
    await page.locator('aside[aria-label="Support"] a[data-variant="gold-ink"]').click();
    await page.waitForURL('**/support');
    await expect(page.locator('iframe')).toHaveCount(0); // nothing opened in place
    await expect.poll(() => va.events().length).toBe(2);
    expect(va.events()[1]).toEqual({ name: 'tip_click', data: { from: 'tip-panel' } });

    // Home: the compact panel is always rendered (02 §2.1 #4).
    await page.goto('/', { waitUntil: 'networkidle' });
    const compact = page.locator('aside[aria-label="Support"][data-compact]');
    await expect(compact).toHaveCount(1);
    await expect(compact.locator('a[data-variant="gold-ink"]')).toHaveAttribute('href', '/support');
  });

  test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('T-E2E-49 phone: data-compact, 52px square, heart only', async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(fsbRoot(page)).toHaveAttribute('data-compact', '');
      const box = await fsb(page).boundingBox();
      expect(Math.round(box?.width ?? 0)).toBe(52);
      expect(Math.round(box?.height ?? 0)).toBe(52);
      // Same 24px inset as desktop — only the shape changes on phones (DESIGN.md §5).
      const viewport = page.viewportSize() ?? { width: 390, height: 844 };
      expect(Math.round(viewport.width - ((box?.x ?? 0) + (box?.width ?? 0)))).toBe(24);
      expect(Math.round(viewport.height - ((box?.y ?? 0) + (box?.height ?? 0)))).toBe(24);
      const word = fsb(page).locator('span', { hasText: 'SUPPORT' });
      const wordBox = await word.boundingBox();
      expect(wordBox?.width ?? 0).toBeLessThanOrEqual(1);
      await expect(fsb(page).locator('span[aria-hidden="true"]')).toHaveText('♥');
    });
  });
});
