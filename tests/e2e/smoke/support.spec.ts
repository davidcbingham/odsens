/**
 * tests/e2e/smoke/support.spec.ts — T-E2E-11 (05 §7.2; 00 S1.5b.AC1/AC2/AC6; 02 §2.7; 03 §2.9;
 * 04 §5.6/§5.7; DESIGN.md §6 #7, §11.4, §12.4): the public `/support` page with SEED-1
 * `kofi_page = 'oddsense'`, at 1280 and 390.
 *  - title, one h1; `KofiCard` in its `card` state — one TIP ON KO-FI button, no amount picker of
 *    ours (ADR-0042 D1), no Ko-fi iframe and nothing requested from ko-fi.com; "on Ko-fi ↗" ghost
 *    link; "What it pays for"; `Leaderboard` empty state + how-to line, no rows, no amounts; no
 *    begging copy; no `FloatingSupportButton` here (02 RP-15).
 *  - axe zero serious/critical + the screenshot, before the third-party frame exists.
 *  - TIP ON KO-FI swaps the gold slab for `iframe[title="Ko-fi"]` IN PLACE (same tab, no popup; src
 *    host `ko-fi.com`, page `oddsense`, no amount parameter) — one box, never both (ADR-0042 D2);
 *    focus lands on "← Back"; `tip_click {from:'support'}` (no amount) lands on the `window.va`
 *    stub; Back restores the card, focus returns to the button, and the frame is gone.
 * The empty-`kofi_page` state and the Settings → `revalidateTag('settings')` leg live in
 * tests/e2e/admin/projects.spec.ts (they write `site_settings`; the `admin` project is serial).
 * H-10: the iframe's own request to ko-fi.com is aborted by the shared context — only the element
 * and its `src` are asserted.
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';
import { stubVa } from '../../helpers/vaStub';

const HOW_TO =
  'Tip on Ko-fi with the same email as your Google sign-in, or put your handle in the message.';

test.describe('support', () => {
  test('T-E2E-11 /support: one-button card, ghost link, pays-for, empty leaderboard, axe; TIP ON KO-FI swaps the card for the Ko-fi iframe + tip_click; Back', async ({
    page,
    context,
    requests,
  }) => {
    const va = await stubVa(page);
    const response = await page.goto('/support', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Support — odsens');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('SUPPORT');

    // KofiCard, `card` state — one button; the amount is chosen in Ko-fi, not here (ADR-0042 D1).
    const card = page.locator('[data-state="card"]');
    await expect(card.getByRole('heading', { name: 'BUY ME A BLOCK' })).toBeVisible();
    await expect(card).toContainText('You pick the amount there.');
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
    await expect(page.getByRole('radio')).toHaveCount(0);
    const tip = page.getByRole('button', { name: 'TIP ON KO-FI', exact: true });
    await expect(tip).toBeEnabled();
    expect((await tip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByText('Tips open soon.')).toHaveCount(0);

    // Nothing of Ko-fi's before the click: no slot, no iframe, nothing asked of ko-fi.com.
    await expect(page.getByText('KO-FI PANEL LOADS HERE')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(requests.filter((url) => url.includes('ko-fi.com'))).toEqual([]);

    // "on Ko-fi ↗" — the only thing that leaves the site.
    const out = page.getByRole('link', { name: /on Ko-fi/ });
    await expect(out).toHaveAttribute('href', 'https://ko-fi.com/oddsense');
    await expect(out).toHaveAttribute('target', '_blank');
    await expect(out).toHaveAttribute('rel', 'noopener noreferrer');

    await expect(page.getByRole('heading', { name: 'What it pays for' })).toBeVisible();

    // Leaderboard — empty state only: no rows, no amounts (00 S1.5b.AC2).
    const board = page.locator('section[aria-labelledby="supporters"]');
    await expect(board.getByRole('heading', { name: 'SUPPORTERS' })).toBeVisible();
    await expect(board.getByRole('heading', { name: 'NOBODY YET' })).toBeVisible();
    await expect(board.getByText('Be first.', { exact: true })).toBeVisible();
    await expect(board.getByText(HOW_TO)).toBeVisible();
    await expect(board.locator('ol, li')).toHaveCount(0);
    expect(await board.innerText()).not.toMatch(/\$\d/);

    // Voice (DESIGN.md §7): no begging.
    const main = await page.locator('main').innerText();
    expect(main).not.toMatch(/please/i);
    expect(main).not.toContain('!!');

    // 02 RP-15: the floating button is not on this page.
    await expect(page.locator('a[aria-label="Support OddSense on Ko-fi"]')).toHaveCount(0);

    await expectNoSeriousA11y(page);
    await shoot(page, 'support');

    // TIP ON KO-FI swaps the slab for the iframe in place: same tab, no popup, one box.
    await tip.click();
    const frame = page.locator('iframe[title="Ko-fi"]');
    await expect(frame).toHaveCount(1);
    await expect(page.locator('[data-state="card"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'BUY ME A BLOCK' })).toHaveCount(0);
    const panel = page.getByRole('region', { name: 'Tip on Ko-fi' });
    await expect(panel).toHaveAttribute('data-state', 'panel');
    const src = new URL((await frame.getAttribute('src')) ?? '');
    expect(src.origin).toBe('https://ko-fi.com');
    expect(src.pathname).toBe('/oddsense/');
    expect(src.searchParams.get('embed')).toBe('true');
    expect(src.searchParams.has('amount')).toBe(false);
    expect(new URL(page.url()).pathname).toBe('/support');
    expect(context.pages()).toHaveLength(1);
    const height = (await frame.boundingBox())?.height ?? 0;
    expect(Math.round(height)).toBe((page.viewportSize()?.width ?? 1280) < 600 ? 620 : 712);
    await expect.poll(() => va.events().length).toBe(1);
    expect(va.events()[0]).toEqual({ name: 'tip_click', data: { from: 'support' } });

    // The panel's bar: focus moved to Back; the ghost link is still the only way off the site.
    const back = panel.getByRole('button', { name: 'Back' });
    await expect(back).toBeFocused();
    expect((await back.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(panel.getByRole('link', { name: /on Ko-fi/ })).toHaveAttribute(
      'href',
      'https://ko-fi.com/oddsense',
    );
    await expectNoSeriousA11y(page);
    await shoot(page, 'support-panel');

    // Back restores the card, returns focus to the button and removes the frame; no second event.
    await back.click();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('[data-state="card"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'TIP ON KO-FI', exact: true })).toBeFocused();
    expect(va.events()).toHaveLength(1);
  });
});
