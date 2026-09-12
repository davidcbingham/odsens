/**
 * tests/helpers/routeFade.ts — `settleRouteFade(page)` (ADR-0035 D3; DESIGN.md §8).
 * Every route change replays the `template.tsx` `page-in` animation: the page wrapper goes from
 * opacity 0 to 1 over `--dur-fast` (150 ms). While it runs, every colour on the page is blended
 * toward the background, so axe's `color-contrast` check reads the blended value (a gold label
 * measured at 3.6:1 instead of its real ratio) and a screenshot shows a half-faded page. A
 * `page.goto` plus a couple of fast assertions can finish inside that window, which made
 * T-E2E-42 flake on `/admin/comments` (seen 2026-09-11, S1.5a e2e lane).
 *
 * Waits for every running `page-in` / `page-in-still` CSS animation to finish (their `finished`
 * promise — already settled once the fill-mode `both` animation has ended) and never longer
 * than one second, so a page with no fade (or a reduced-motion context) returns at once.
 * Only the fade is awaited — indefinite animations (spinners) are never waited on.
 */
import type { Page } from '@playwright/test';

export async function settleRouteFade(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const fades = document
      .getAnimations()
      .filter(
        (animation) =>
          animation instanceof CSSAnimation && /page-in(-still)?$/.test(animation.animationName),
      );
    if (fades.length === 0) return;
    const finished = Promise.all(fades.map((animation) => animation.finished.catch(() => null)));
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    await Promise.race([finished, deadline]);
  });
}
