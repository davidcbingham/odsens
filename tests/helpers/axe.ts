/**
 * tests/helpers/axe.ts — `expectNoSeriousA11y(page)` (docs/build/05-test-plan.md §1.3, H-8).
 * Runs axe with tags wcag2a + wcag2aa; fails with a readable list when any violation has
 * impact `serious` or `critical`. Waits for the route fade first (`settleRouteFade`, ADR-0035
 * D3): axe's `color-contrast` reads the blended colours of a page still fading in.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { settleRouteFade } from './routeFade';

const FAILING_IMPACTS = new Set(['serious', 'critical']);

export async function expectNoSeriousA11y(page: Page): Promise<void> {
  await settleRouteFade(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact && FAILING_IMPACTS.has(v.impact));
  const report = serious
    .map((v) => {
      const targets = v.nodes
        .slice(0, 5)
        .map((n) => `      - ${n.target.join(' ')}`)
        .join('\n');
      return `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${targets}`;
    })
    .join('\n');
  expect(serious, `axe found serious/critical violations on ${page.url()}:\n${report}`).toEqual([]);
}
