/**
 * tests/e2e/smoke/privacy.spec.ts — T-E2E-12: `/privacy` (02 §1.1 ISR 600; DESIGN.md §11.3 #12,
 * §12.5, §12.7 #24). Title, h1, the four h2s in order, the NOTE callout with the age line, the
 * handle guidance sentence. Runs in `smoke-desktop` and `smoke-phone`; axe + screenshot (H-8).
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

const H2S = ['WHAT WE STORE', 'WHAT WE NEVER SHOW', 'TIPS AND DOWNLOADS', 'DELETING YOUR ACCOUNT'];
const HANDLE_GUIDANCE =
  "Handles are made-up names. Don't use your real one — nobody here needs to know it, including us.";
const AGE_LINE = "Sign-in needs a Google account; Google's age rules apply.";

test.describe('privacy', () => {
  test('T-E2E-12 /privacy title, h1, h2s, NOTE callout, handle guidance, age line', async ({
    page,
  }) => {
    const response = await page.goto('/privacy');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Privacy — odsens');

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('WHAT WE KEEP');

    const h2s = await page
      .locator('main')
      .getByRole('heading', { level: 2 })
      .evaluateAll((els) => els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()));
    expect(h2s.map((t) => t.toUpperCase())).toEqual(H2S);

    // NOTE callout (03 §2.2 NoteCallout: <aside aria-label="Note"> with the Silkscreen NOTE tag)
    // closes the page on the §12.7 #24 age line + "downloads without an account".
    const note = page.getByRole('complementary', { name: 'Note' });
    await expect(note).toHaveCount(1);
    await expect(note.getByText('NOTE', { exact: true })).toBeVisible();
    await expect(note).toContainText(AGE_LINE);
    await expect(note).toContainText('without an account');

    await expect(page.getByText(HANDLE_GUIDANCE)).toBeVisible();
    await expect(page.getByText(AGE_LINE)).toBeVisible();

    await expectNoSeriousA11y(page);
    await shoot(page, 'privacy');
  });
});
