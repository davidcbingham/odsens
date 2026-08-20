/**
 * tests/e2e/smoke/how-comments-work.spec.ts — T-E2E-13: `/how-comments-work` (02 §1.1 ISR 600;
 * DESIGN.md §12.5). Title, the four Bungee-headed blocks in order, the handle guidance line, the
 * age line, and the Footer link. Runs at both viewports; axe + screenshot (H-8).
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

const BLOCKS = ['SIGN IN', 'FIRST COMMENT', 'THE RULES', 'LEAVING'];
const HANDLE_GUIDANCE =
  "Handles are made-up names. Don't use your real one — nobody here needs to know it, including us.";
const AGE_LINE = "Sign-in needs a Google account; Google's age rules apply.";

test.describe('how comments work', () => {
  test('T-E2E-13 /how-comments-work title, four Bungee blocks, guidance line, footer link', async ({
    page,
  }) => {
    const response = await page.goto('/how-comments-work');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('How comments work — odsens');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('HOW COMMENTS WORK');

    const h2 = page.locator('main').getByRole('heading', { level: 2 });
    const titles = await h2.evaluateAll((els) =>
      els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    expect(titles).toEqual(BLOCKS);

    // "Bungee blocks": every h2 renders in the display face (`--font-display`, next/font/local
    // Bungee — DESIGN.md §2). Compare the first family of the computed stack with the token.
    const families = await h2.evaluateAll((els) => {
      const first = (stack: string) => (stack.split(',')[0] ?? '').replace(/["']/g, '').trim();
      const display = first(
        getComputedStyle(document.documentElement).getPropertyValue('--font-display'),
      );
      return els.map((el) => ({ display, actual: first(getComputedStyle(el).fontFamily) }));
    });
    for (const { display, actual } of families) {
      expect(display).not.toBe('');
      expect(actual).toBe(display);
    }

    await expect(page.getByText(HANDLE_GUIDANCE)).toBeVisible();
    await expect(page.getByText(AGE_LINE)).toBeVisible();

    // Linked from the Footer "Site" column (03 Footer row; 00 S1.1.AC7).
    const footerLink = page.getByRole('contentinfo').locator('a[href="/how-comments-work"]');
    await expect(footerLink).toHaveCount(1);

    await expectNoSeriousA11y(page);
    await shoot(page, 'how-comments-work');
  });
});
