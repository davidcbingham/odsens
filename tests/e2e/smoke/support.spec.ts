/**
 * tests/e2e/smoke/support.spec.ts — T-E2E-11 (05 §7.2; 00 S1.5b.AC1/AC2/AC6; 02 §2.7; 03 §2.9;
 * 04 §5.6/§5.7; DESIGN.md §6 #7, §11.4, §12.4): the public `/support` page with SEED-1
 * `kofi_page = 'oddsense'`, at 1280 and 390.
 *  - title, one h1; `AmountPicker` radiogroup `$1 / $3 / $5 / Other`, `$3` preselected, arrow keys
 *    move the check; `KofiPanelSlot` idle (dashed slot, no Ko-fi iframe, nothing requested from
 *    ko-fi.com); "on Ko-fi ↗" ghost link; "What it pays for"; `Leaderboard` empty state + how-to
 *    line, no rows, no amounts; no begging copy; no `FloatingSupportButton` here (02 RP-15).
 *  - axe zero serious/critical + the screenshot, before the third-party frame exists.
 *  - $5 → CONTINUE ON KO-FI mounts `iframe[title="Ko-fi"]` IN PLACE (same tab, no popup; src host
 *    `ko-fi.com`, page `oddsense`, no amount parameter) and `tip_click {amount:5, from:'support'}`
 *    lands on the `window.va` stub; Other + a typed value → `{amount:'other'}` — the typed number
 *    is never sent (ADR-0002 A16).
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
  test('T-E2E-11 /support: picker, idle slot, ghost link, pays-for, empty leaderboard, axe; CONTINUE mounts the Ko-fi iframe in place + tip_click', async ({
    page,
    context,
    requests,
  }) => {
    const va = await stubVa(page);
    const response = await page.goto('/support', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Support — odsens');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('SUPPORT');

    // AmountPicker — $1 / $3 / $5 / Other, $3 preselected (00 O-8).
    const group = page.getByRole('radiogroup', { name: 'Amount' });
    const radios = group.getByRole('radio');
    await expect(radios).toHaveText(['$1', '$3', '$5', 'Other']);
    await expect(group.getByRole('radio', { checked: true })).toHaveText(['$3']);
    for (const radio of await radios.all()) {
      const box = await radio.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }

    // Arrow keys move and check (roving tabindex).
    await group.getByRole('radio', { name: '$3' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { checked: true })).toHaveText(['$5']);
    await expect(group.getByRole('radio', { name: '$5' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(group.getByRole('radio', { checked: true })).toHaveText(['$3']);

    const proceed = page.getByRole('button', { name: 'CONTINUE ON KO-FI', exact: true });
    await expect(proceed).toBeEnabled();
    await expect(page.getByText('Tips open soon.')).toHaveCount(0);

    // KofiPanelSlot idle: the dashed slot, no iframe, nothing asked of ko-fi.com yet.
    const slot = page.locator('[data-state="idle"]', { hasText: 'KO-FI PANEL LOADS HERE' });
    await expect(slot).toBeVisible();
    await expect(slot).toContainText('Their look, our frame.');
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

    // $5 → CONTINUE mounts the iframe in place: same tab, no popup.
    await group.getByRole('radio', { name: '$5' }).click();
    await proceed.click();
    const frame = page.locator('iframe[title="Ko-fi"]');
    await expect(frame).toHaveCount(1);
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
    expect(va.events()[0]).toEqual({ name: 'tip_click', data: { amount: 5, from: 'support' } });

    // Other: the typed value stays on the page — the event says 'other'.
    await group.getByRole('radio', { name: 'Other' }).click();
    await page.getByLabel('Amount in dollars').fill('7');
    await proceed.click();
    await expect.poll(() => va.events().length).toBe(2);
    expect(va.events()[1]).toEqual({
      name: 'tip_click',
      data: { amount: 'other', from: 'support' },
    });
    expect(JSON.stringify(va.events())).not.toContain('7');
  });
});
