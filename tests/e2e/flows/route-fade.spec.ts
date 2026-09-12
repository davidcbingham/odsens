/**
 * T-E2E-50 — route-change fade + avatar outline (ADR-0035 D2/D3; DESIGN.md §3, §8 v1.8; amended
 * by ADR-0038 D2 — the crown site mark's 2px border is transparent, DESIGN.md v1.9).
 * The nav avatar's border box is 2px with no visible colour; navigating `/` → `/projects` through the nav remounts the
 * `template.tsx` wrapper (its animation ran) while the `<nav>` element itself is the same node
 * (the chrome never fades). Under `prefers-reduced-motion: reduce` the wrapper animates
 * opacity only (`page-in-still`) and never transforms.
 */
import { test, expect } from '../fixtures';

test.describe('route fade + avatar outline (T-E2E-50)', () => {
  test('T-E2E-50 avatar border is 2px; the page wrapper fades on navigation; nav is untouched', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = page.locator('nav').first();
    const avatar = nav.locator('img[alt="OddSense"]').first();
    await expect(avatar).toBeVisible();
    const border = await avatar.evaluate((el) => {
      const style = getComputedStyle(el.parentElement as HTMLElement);
      return { width: style.borderTopWidth, color: style.borderTopColor };
    });
    expect(border.width).toBe('2px');
    // ADR-0038 D2 (DESIGN.md v1.9): the crown site mark keeps the 2px box but no visible outline.
    expect(border.color).toBe('rgba(0, 0, 0, 0)');

    const navBefore = await nav.evaluate((el) => {
      (el as HTMLElement).dataset.marker = 't-e2e-50';
      return true;
    });
    expect(navBefore).toBe(true);

    await nav.getByRole('link', { name: 'Projects' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    const wrapper = page.locator('main > div').first();
    const animation = await wrapper.evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toMatch(/page-in$/); // CSS-module keyframes are hashed: `<file>__<hash>__page-in`
    // Same nav node → the chrome did not remount.
    expect(await nav.evaluate((el) => (el as HTMLElement).dataset.marker)).toBe('t-e2e-50');
  });

  test('T-E2E-50 reduced motion: the wrapper animates opacity only, never transform', async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/projects');
    const wrapper = page.locator('main > div').first();
    const style = await wrapper.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { animationName: cs.animationName, transform: cs.transform };
    });
    expect(style.animationName).toMatch(/page-in-still$/);
    expect(style.transform).toBe('none');
    await context.close();
  });
});
