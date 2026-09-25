/**
 * tests/e2e/smoke/projects.spec.ts — T-E2E-2: `/projects` (02 §2.2, SM-02; DESIGN.md §6.2, §5
 * Filter bar, §11.7 empty; ADR-0002 #39/A7; 00 S1.2.AC2/AC3/AC4). Replaces the S0 placeholder
 * assertions (02 RP-16; the placeholder spec retired with S1.7 — no placeholders remain). Runs in `smoke-desktop` and `smoke-phone`.
 *
 * Seed truths (05 §3 SEED-4..6): 3 published projects — metal-pipe-mace (resourcepack, 2531),
 * pixel-chameleon (mod, 1688 combined), seed-exclusive-pack (datapack, 7) — so the count line is
 * "3 things. Some useful, some not." and the type counts are MODS 1 / DATAPACKS 1 /
 * RESOURCE PACKS 1 / PLUGINS 0. Filters/search/sort are client-side over the ISR list — URL is
 * the state (02 RP-02); the whole flow runs without a page reload.
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

const CARDS = 'article'; // ProjectCard root (03 §2.3: `<article>` with one `<a>`)

test.describe('projects', () => {
  test('T-E2E-2 /projects — title, 3 cards, count line, filter counts, type/search filters, empty state', async ({
    page,
  }) => {
    const response = await page.goto('/projects');
    expect(response?.status()).toBe(200); // SM-02
    await expect(page).toHaveTitle('Projects — odsens');

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('PROJECTS');

    // Count line (ADR-0002 #39; 03 V-02) + 3 ProjectCards.
    await expect(page.getByText('3 things. Some useful, some not.')).toBeVisible();
    const grid = page.locator('section', {
      has: page.getByRole('heading', { name: 'All projects' }),
    });
    await expect(grid.locator(CARDS)).toHaveCount(3);

    // FilterBar buttons with counts, ALL first (02 §2.2: the bar shows ALL + one active).
    const filter = page.locator('[role="group"][aria-label="Filter"]');
    for (const name of ['ALL 3', 'MODS 1', 'DATAPACKS 1', 'RESOURCE PACKS 1', 'PLUGINS 0']) {
      await expect(filter.getByRole('link', { name })).toBeVisible();
    }
    // Default: ALL is the active type link (03 C-13 `aria-current` on the `<a>`).
    await expect(filter.getByRole('link', { name: 'ALL 3' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    // Phone (ADR-0046 D4): the five type links overflow into a scroll box that carries 5px of
    // padding for the focus ring. At rest the row must sit where it always did — first link at the
    // bar's 12px content edge, scrollLeft 0 (scroll-snap must not rest on that padding) — and the
    // focused first link's 5px gold ring (2px offset + 3px) must not be clipped by the box.
    if ((page.viewportSize()?.width ?? 0) < 600) {
      const box = async (locator: ReturnType<typeof page.locator>) => {
        const rect = await locator.boundingBox();
        if (!rect) throw new Error('no bounding box');
        return rect;
      };
      const allLink = filter.getByRole('link', { name: 'ALL 3' });
      const types = allLink.locator('..');
      expect(await types.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect(await types.evaluate((el) => el.scrollLeft)).toBe(0);
      expect(Math.round((await box(allLink)).x)).toBe(Math.round((await box(filter)).x + 12));
      await allLink.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(allLink).toBeFocused();
      await expect(allLink).toHaveCSS('outline-color', 'rgb(255, 198, 31)'); // --gold
      await expect(allLink).toHaveCSS('outline-offset', '2px');
      expect((await box(allLink)).x - 5).toBeGreaterThanOrEqual((await box(types)).x);
      expect(await types.evaluate((el) => el.scrollLeft)).toBe(0);
      await allLink.blur();
    }

    // Each card is one link; TypeBadge = glyph (aria-hidden svg) + word; download count in footer.
    const firstCard = grid.locator(CARDS).first(); // downloads desc → Metal Pipe Mace (2531)
    expect(await firstCard.locator('a').count()).toBe(1);
    await expect(firstCard.getByText('RESOURCE PACK', { exact: true })).toBeVisible();
    expect(await firstCard.locator('svg[aria-hidden="true"]').count()).toBeGreaterThan(0);
    await expect(firstCard.getByText('2.5K ↓')).toBeVisible();
    await expect(firstCard.getByText('2,531 downloads')).toBeAttached(); // sr text (03 §2.3)

    // Click MODS → URL ?type=mod, 1 card, ActiveFilterChips echo + Clear (no reload — RP-02).
    await filter.getByRole('link', { name: 'MODS 1' }).click();
    await expect(page).toHaveURL(/\/projects\?type=mod$/);
    await expect(filter.getByRole('link', { name: 'MODS 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(grid.locator(CARDS)).toHaveCount(1);
    await expect(
      grid.locator(CARDS).getByRole('heading', { name: 'Pixel Chameleon' }),
    ).toBeVisible();
    const chips = page.locator('ul[aria-label="Active filters"]');
    await expect(chips.getByText('MODS', { exact: true })).toBeVisible(); // labels[type=mod]
    await expect(chips.getByRole('button', { name: 'Remove filter MODS' })).toBeVisible();
    const clear = chips.getByRole('button', { name: 'Clear' });
    await expect(clear).toBeVisible();

    // Clear the type filter, then search "pipe" → 1 card (client substring match on title).
    await clear.click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(grid.locator(CARDS)).toHaveCount(3);
    const search = page.getByRole('searchbox', { name: 'Search projects' }).locator('visible=true');
    await search.fill('pipe');
    await search.press('Enter'); // Enter writes immediately (ADR-0002 #59)
    await expect(page).toHaveURL(/\/projects\?q=pipe$/);
    await expect(grid.locator(CARDS)).toHaveCount(1);
    await expect(
      grid.locator(CARDS).getByRole('heading', { name: 'Metal Pipe Mace' }),
    ).toBeVisible();

    // Type "zzz" → §11.7 empty state (NOTHING MATCHES / Try fewer filters.) with Clear filters.
    await search.fill('zzz');
    await search.press('Enter');
    await expect(grid.locator(CARDS)).toHaveCount(0);
    await expect(page.getByText('NOTHING MATCHES')).toBeVisible();
    await expect(page.getByText('Try fewer filters.')).toBeVisible();
    const clearFilters = page.getByRole('link', { name: 'Clear filters' });
    await expect(clearFilters).toBeVisible();
    await clearFilters.click();
    await expect(grid.locator(CARDS)).toHaveCount(3);

    // Themed listbox (ADR-0035 D1): Sort is a combobox; keyboard opens, moves, picks; Esc closes.
    const sort = page.getByLabel('Sort', { exact: true });
    await expect(sort).toHaveRole('combobox');
    await expect(sort).toHaveText('Downloads');
    await sort.focus();
    await page.keyboard.press('ArrowDown');
    const listbox = page.getByRole('listbox', { name: 'Sort options' });
    await expect(listbox).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/projects\?sort=updated$/);
    await expect(sort).toHaveText('Updated');
    await expect(listbox).toBeHidden();
    await expect(sort).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(listbox).toBeVisible();
    // Home / End move to the first / last option (highlight only — no pick until Enter).
    await page.keyboard.press('End');
    await expect(listbox.getByRole('option', { name: 'Title' })).toHaveAttribute('data-active', '');
    await page.keyboard.press('Home');
    await expect(listbox.getByRole('option', { name: 'Downloads' })).toHaveAttribute(
      'data-active',
      '',
    );
    await page.keyboard.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(sort).toHaveText('Updated');

    await expectNoSeriousA11y(page);
    await shoot(page, 'projects');
  });
});
