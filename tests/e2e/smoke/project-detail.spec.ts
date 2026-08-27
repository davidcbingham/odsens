/**
 * tests/e2e/smoke/project-detail.spec.ts — `/projects/[slug]` (02 §2.3, SM-03; DESIGN.md §6 #3,
 * §12.5, §5 Gallery). Runs in `smoke-desktop` and `smoke-phone`.
 *
 *  - T-E2E-3, S1.2 scope (05 §8 row: "except comments/SEEN ON"): title/breadcrumb/header, ABOUT
 *    markdown, VERSIONS & FILES ("Download", never "Get"; `Changes ▾` expander), GET IT panel
 *    (primary → Modrinth URL; rows `1.6K` / `120`; combined line `1.7K`), DETAILS list. The
 *    COMMENTS thread content ("N TOTAL", slots — S1.4) and SEEN ON row (S1.8) extend this spec
 *    in their slices; the reserved COMMENTS heading is SM-03's assertion.
 *    Note: seed has exactly one version with a changelog (…0404), so "one open at a time" is
 *    exercised as open→close on the single group member; the multi-member exclusivity is the
 *    component contract (03 `ChangelogExpander` groupName store).
 *  - T-E2E-5, S1.2 scope ("gallery/lightbox part"): metal-pipe-mace's 2-thumb gallery, thumb
 *    swap, Lightbox open/Esc/arrows. The SEEN ON MentionCard part is S1.8.
 *
 * Seed truths (SEED-4/5/6): pixel-chameleon — mod, downloads 1568+120+0=1688, one beta version
 * `2.0.0-beta.1` with 2 files (primary jar first) and a changelog; CF link 900001 (120).
 * metal-pipe-mace — gallery entries "In hand" (featured) and "Bonk".
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

test.describe('project detail', () => {
  test('T-E2E-3 /projects/pixel-chameleon — header, ABOUT, VERSIONS & FILES, changelog, GET IT, DETAILS', async ({
    page,
  }) => {
    const response = await page.goto('/projects/pixel-chameleon');
    expect(response?.status()).toBe(200); // SM-03
    await expect(page).toHaveTitle('Pixel Chameleon — odsens');

    // Breadcrumb (03 §2.2): Projects link, current page last.
    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(breadcrumb.getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      '/projects',
    );
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Pixel Chameleon');

    // Header: one h1, description, TypeBadge mod (glyph + word), combined count.
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('Pixel Chameleon');
    await expect(
      page.getByText('A tiny chameleon that blends into whatever block it sits on.').first(),
    ).toBeVisible();
    const header = page.locator('header', { has: h1 });
    await expect(header.getByText('MOD', { exact: true })).toBeVisible();
    await expect(header.getByText('1,688 DOWNLOADS')).toBeVisible();

    // ABOUT renders markdown (body_md h2 via the `about` variant — 03 `Markdown`).
    const about = page.locator('section', {
      has: page.getByRole('heading', { name: 'ABOUT', exact: true }),
    });
    await expect(about.getByRole('heading', { name: 'Pixel Chameleon' })).toBeVisible();
    // overrides.notes_md ("seed note") renders as a second block under a NoteCallout (02 §2.3 #3).
    await expect(about.getByText('seed note')).toBeVisible();

    // VERSIONS & FILES: 2.0.0-beta.1, 2 files, primary first, "Download" never "Get".
    await expect(page.getByRole('heading', { name: 'VERSIONS & FILES' })).toBeVisible();
    const table = page.locator('table', {
      has: page.getByText('Versions and files'),
    });
    // `.first()`: the version cell AND the (hidden) changelog h4 both carry "2.0.0-beta.1".
    await expect(table.getByText('2.0.0-beta.1', { exact: true }).first()).toBeVisible();
    const downloads = table.getByRole('link', { name: /^Download / });
    await expect(downloads).toHaveCount(2);
    // Primary first (05 T-UNIT-30 order): row 1 = the primary jar, row 2 = the -sources jar.
    await expect(downloads.nth(0)).toHaveAccessibleName(
      'Download pixel-chameleon-2.0.0-beta.1.jar',
    );
    await expect(downloads.nth(1)).toHaveAccessibleName(
      'Download pixel-chameleon-2.0.0-beta.1-sources.jar',
    );
    await expect(downloads.nth(0)).toHaveAttribute('href', /cdn\.modrinth\.com/); // ADR-0002 #42
    expect(await table.innerText()).not.toMatch(/\bGet\b/); // C-30: "Download", never "Get"

    // Changes ▾ expander: collapsed by default; opens the changelog inline; closes again.
    const changes = table.getByRole('button', { name: /^Changes/ });
    await expect(changes).toHaveAttribute('aria-expanded', 'false');
    await expect(table.getByText('New blending engine')).toBeHidden(); // <tr hidden> until open
    await changes.click();
    await expect(changes).toHaveAttribute('aria-expanded', 'true');
    await expect(table.getByText('New blending engine')).toBeVisible();
    await changes.click();
    await expect(changes).toHaveAttribute('aria-expanded', 'false');
    await expect(table.getByText('New blending engine')).toBeHidden();

    // GET IT panel: primary → the Modrinth project URL; per-platform rows; combined line 1.7K.
    const getIt = page.locator('aside[aria-labelledby="get-it-pixel-chameleon"]');
    const primary = getIt.locator('a[data-variant="primary"]');
    await expect(primary).toHaveAttribute('href', 'https://modrinth.com/project/pixel-chameleon');
    await expect(primary).toContainText('Download on Modrinth');
    const modrinthRow = getIt.getByRole('link', { name: /Modrinth.*opens in new tab/ });
    await expect(modrinthRow.getByText('1.6K ↓')).toBeVisible();
    const curseforgeRow = getIt.getByRole('link', { name: /CurseForge.*opens in new tab/ });
    await expect(curseforgeRow.getByText('120 ↓')).toBeVisible();
    await expect(getIt.getByText('1.7K COMBINED')).toBeVisible(); // 1688 via formatCount
    await expect(
      getIt.getByText(
        'Modrinth and CurseForge report their own counts. Direct downloads are the ones we serve.',
      ),
    ).toBeVisible();

    // DETAILS list: <dl> with type / updated / licence / source (02 §2.3 rail).
    const details = page.locator('section[aria-labelledby="details-title"] dl');
    const labels = await details.locator('dt').allInnerTexts();
    expect(labels).toEqual(['Type', 'Updated', 'Licence', 'Source']);
    await expect(details.getByText('Mod', { exact: true })).toBeVisible();
    await expect(details.getByRole('link', { name: 'Modrinth' })).toHaveAttribute(
      'href',
      'https://modrinth.com/project/pixel-chameleon',
    );

    // Reserved COMMENTS heading (SM-03; the thread itself is S1.4).
    await expect(page.getByRole('heading', { name: 'COMMENTS' })).toBeVisible();

    await expectNoSeriousA11y(page);
    await shoot(page, 'project-detail');
  });

  test('T-E2E-5 /projects/metal-pipe-mace — gallery thumbs swap, Lightbox opens, Esc closes, arrows move', async ({
    page,
  }) => {
    await page.goto('/projects/metal-pipe-mace');
    await expect(page).toHaveTitle('Metal Pipe Mace — odsens');

    // Gallery: 2 thumbs (SEED-4 gallery "In hand" featured-first, then "Bonk").
    const thumb1 = page.getByRole('button', { name: 'Show image 1: In hand' });
    const thumb2 = page.getByRole('button', { name: 'Show image 2: Bonk' });
    await expect(thumb1).toBeVisible();
    await expect(thumb2).toBeVisible();
    await expect(thumb1).toHaveAttribute('aria-current', 'true');

    // Click thumb → main image swaps (the well's aria-label names the selected image).
    const well = page.locator('button[aria-haspopup="dialog"]');
    await expect(well).toHaveAttribute('aria-label', 'Open image viewer: In hand');
    await thumb2.click();
    await expect(thumb2).toHaveAttribute('aria-current', 'true');
    await expect(well).toHaveAttribute('aria-label', 'Open image viewer: Bonk');
    expect(await well.locator('img').getAttribute('src')).toContain('gallery-2');
    await thumb1.click();
    await expect(well).toHaveAttribute('aria-label', 'Open image viewer: In hand');

    // Lightbox opens on main click (dialog, data-state="open"), arrows move, Esc closes.
    await well.click();
    const dialog = page.locator('dialog[aria-label="Image viewer"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-state', 'open');
    await expect(dialog.locator('img')).toHaveAttribute('alt', 'In hand');
    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('img')).toHaveAttribute('alt', 'Bonk');
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.locator('img')).toHaveAttribute('alt', 'In hand');
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[aria-label="Image viewer"]')).toHaveCount(0);
    // Focus restored to the opener (03 `Lightbox` a11y).
    await expect(well).toBeFocused();

    await expectNoSeriousA11y(page);
    await shoot(page, 'project-detail-gallery');
  });
});
