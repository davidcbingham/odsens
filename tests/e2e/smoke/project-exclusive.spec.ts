/**
 * tests/e2e/smoke/project-exclusive.spec.ts — T-E2E-4: `/projects/seed-exclusive-pack` (05 §7.3;
 * 00 S1.3.AC1/AC3/AC8; DESIGN.md §5 "Exclusive badge", §6 #3). Runs in `smoke-desktop` and
 * `smoke-phone` — the two viewports satisfy the exclusive-detail half of 00 S1.3.AC12.
 *
 *  - Detail: `ExclusiveBadge` ("ONLY ON ODSENS") in the header meta row; GET IT primary →
 *    `/api/download/<file id>` with `data-variant="primary"` and NO Modrinth/CurseForge rows
 *    (the platform-word check is scoped to the rows `<ul>` — the combined-count explainer
 *    paragraph keeps the words by design, `COMBINED_COUNT_LINE` verbatim per 03 §2.3); the
 *    `.get-it-sha` line shows the full 128-hex sha512 (00 S1.3.AC3); DETAILS "Source" reads
 *    "Only on odsens"; VERSIONS & FILES Download href = the same `/api/download/…` id
 *    (ADR-0002 #42 direct branch); SEEN ON absent (S1.8).
 *  - DEFERRED (05 §12 note 2026-08-27): T-E2E-4's "Comments closed state text" clause —
 *    "Comments are off for this one. The old ones stay." — needs the S1.4 `CommentThread`;
 *    the S1.4 run adds that assertion here (same pattern as T-E2E-3's S1.2 "except
 *    comments/SEEN ON" scope).
 *  - Grid: on `/projects`, the seed-exclusive-pack card carries `data-exclusive` + the badge;
 *    the Modrinth-sourced metal-pipe-mace card carries neither (00 S1.3.AC1/AC8).
 *
 * Seed truths (SEED-4/5/6): seed-exclusive-pack — source odsens, datapack, downloads
 * 0+0+7=7, one release version `1.0.0` (…0401) with one primary file …0501
 * `seed-exclusive-pack-1.0.0.zip` (769 B, sha512 stored). Read-only: mutates nothing.
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';
import { SEED_FILES } from '../../helpers/seedIds';

const DOWNLOAD_HREF = `/api/download/${SEED_FILES.exclusiveZip}`;

test.describe('project exclusive', () => {
  test('T-E2E-4 /projects/seed-exclusive-pack — badge, GET IT direct href + sha512, DETAILS source, versions href, no SEEN ON', async ({
    page,
  }) => {
    const response = await page.goto('/projects/seed-exclusive-pack');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Seed Exclusive Pack — odsens');

    // Header: one h1 = the title; the meta row leads with the ExclusiveBadge (00 S1.3.AC1).
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('Seed Exclusive Pack');
    const header = page.locator('header', { has: h1 });
    // The seed description also contains the phrase "only on odsens.com" (getByText is
    // case-insensitive-ish substring), so target the badge's full text — sr prefix included.
    await expect(header.getByText('Exclusive: ★ ONLY ON ODSENS')).toBeVisible();
    await expect(header.getByText('Exclusive:')).toBeAttached(); // sr prefix — never glyph alone (03 C-26)
    await expect(header.getByText('DATAPACK', { exact: true })).toBeVisible();
    await expect(header.getByText('7 DOWNLOADS')).toBeVisible(); // 0+0+7 direct only

    // GET IT panel: primary is the direct download route, marked data-variant="primary".
    const getIt = page.locator('aside[aria-labelledby="get-it-seed-exclusive-pack"]');
    const primary = getIt.locator('a[data-variant="primary"]');
    await expect(primary).toHaveAttribute('href', DOWNLOAD_HREF);
    await expect(primary).toContainText('Download');

    // No Modrinth/CurseForge rows: the primary is the panel's ONLY link, and the rows list
    // holds just the Direct count. (The explainer paragraph below keeps the platform words —
    // COMBINED_COUNT_LINE verbatim — so the word check scopes to the rows <ul>.)
    await expect(getIt.getByRole('link')).toHaveCount(1);
    const rows = getIt.locator('ul');
    await expect(rows.getByText('Direct')).toBeVisible();
    await expect(rows.getByText('7 ↓')).toBeVisible();
    expect(await rows.innerText()).not.toMatch(/Modrinth|CurseForge/);
    await expect(getIt.getByText('7 COMBINED')).toBeVisible();

    // sha512 line (00 S1.3.AC3): label + the full 128-hex value.
    const sha = getIt.locator('p', { hasText: 'sha512' });
    await expect(sha).toBeVisible();
    await expect(sha).toHaveText(/^sha512 [0-9a-f]{128}$/);

    // DETAILS: the Source row reads "Only on odsens" — no platform link (02 §2.3 rail).
    const details = page.locator('section[aria-labelledby="details-title"] dl');
    const sourceRow = details.locator('div', {
      has: page.getByText('Source', { exact: true }),
    });
    await expect(sourceRow.locator('dd')).toHaveText('Only on odsens');

    // VERSIONS & FILES: one file row, Download href = the same /api/download/<id>.
    await expect(page.getByRole('heading', { name: 'VERSIONS & FILES' })).toBeVisible();
    const table = page.locator('table', { has: page.getByText('Versions and files') });
    await expect(table.getByText('1.0.0', { exact: true })).toBeVisible();
    const download = table.getByRole('link', { name: /^Download / });
    await expect(download).toHaveCount(1);
    await expect(download).toHaveAccessibleName('Download seed-exclusive-pack-1.0.0.zip');
    await expect(download).toHaveAttribute('href', DOWNLOAD_HREF);

    // SEEN ON is S1.8 — no heading yet (05 T-E2E-4 "SEEN ON absent").
    await expect(page.getByRole('heading', { name: 'SEEN ON' })).toHaveCount(0);

    await expectNoSeriousA11y(page);
    await shoot(page, 'project-exclusive');
  });

  test('T-E2E-4 /projects grid — badge on the exclusive card, not the synced card', async ({
    page,
  }) => {
    await page.goto('/projects');

    // ProjectCard root is an <article>; data-exclusive pins the badge (03 §2.3; 00 S1.3.AC1).
    const exclusiveCard = page.locator('article', {
      has: page.getByRole('heading', { name: 'Seed Exclusive Pack' }),
    });
    await expect(exclusiveCard).toHaveCount(1);
    await expect(exclusiveCard).toHaveAttribute('data-exclusive', '');
    // Badge full text (the card description carries the phrase too — strict-mode safe).
    await expect(exclusiveCard.getByText('Exclusive: ★ ONLY ON ODSENS')).toBeVisible();
    // The badge sits outside the link — the whole card stays ONE <a> (03 §2.3).
    expect(await exclusiveCard.locator('a').count()).toBe(1);

    const syncedCard = page.locator('article', {
      has: page.getByRole('heading', { name: 'Metal Pipe Mace' }),
    });
    await expect(syncedCard).toHaveCount(1);
    await expect(syncedCard).not.toHaveAttribute('data-exclusive');
    await expect(syncedCard.getByText('Exclusive: ★ ONLY ON ODSENS')).toHaveCount(0);
  });
});
