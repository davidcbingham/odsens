/**
 * tests/helpers/vaStub.ts — the `window.va` stub (04 §5.6; ADR-0002 C12): custom-event calls are
 * forwarded to Node synchronously, the T-E2E-16 / T-E2E-31 mechanism, shared by the S1.5b specs.
 * Install BEFORE the first `page.goto`. `<Analytics />` also reports page views through
 * `window.va('pageview', …)` — `events()` keeps only the custom events under test.
 */
import type { Page } from '@playwright/test';

export type VaEvent = { name: string; data: Record<string, string | number> };

export async function stubVa(page: Page): Promise<{ events: () => VaEvent[] }> {
  const calls: [string, unknown][] = [];
  await page.exposeFunction('__odsensVa', (kind: string, payload: unknown) => {
    calls.push([kind, payload]);
  });
  await page.addInitScript(() => {
    type Stubbed = Window & {
      va?: (kind: string, payload: unknown) => void;
      __odsensVa?: (kind: string, payload: unknown) => Promise<void>;
    };
    const w = window as Stubbed;
    w.va = (kind, payload) => {
      void w.__odsensVa?.(kind, payload);
    };
  });
  return {
    events: () =>
      calls.filter(([kind]) => kind === 'event').map(([, payload]) => payload as VaEvent),
  };
}
