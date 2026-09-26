/**
 * tests/fixtures/ui/flatBarChart.ts — `FlatBarChart` states for `/dev/components` (03 §2.2
 * `FlatBarChart`; DESIGN.md §11.1 Flat bar chart; 05 T-E2E-48; ADR-0049 D24): the full 30-column chart on
 * 30 seeded-looking days, the compact 15-bar variant on the same days, and the empty chart (30 zero
 * days — 00 §S1.9 AC2 before any snapshot). Each fixture FORCES its variant (`compact: true |
 * false`) so the gallery shows both at any width; `/admin/stats` passes neither and lets the width
 * decide. Dates are a fixed window (never the wall clock) so the specimens render the same every
 * time. No DB, no network.
 */
import type { FlatBarChartProps } from '@/components/primitives/FlatBarChart';
import { CHART_TITLE, dayRange, type DailyDownloads } from '@/lib/stats';

export type FlatBarChartFixture = { label: string; props: FlatBarChartProps };

/** A fixed 30-day window ending on a known day — the dates only feed the hidden table. */
const WINDOW = dayRange('2026-09-26', 30);

/**
 * Daily gains in the seed's proportions (SEED-12: 40 / 3 / 2 a day — modrinth, curseforge, direct),
 * with a weekend-ish swell, two flat days (index 9 and 22 — "missing days → 0") and one spike, so
 * the stacked max and the half label read as real numbers.
 */
const SEEDED: readonly [number, number, number][] = [
  [41, 3, 2],
  [38, 4, 1],
  [44, 2, 3],
  [52, 5, 2],
  [61, 6, 4],
  [58, 4, 3],
  [40, 3, 1],
  [37, 2, 2],
  [43, 3, 0],
  [0, 0, 0],
  [49, 4, 2],
  [66, 7, 5],
  [72, 6, 4],
  [55, 3, 2],
  [42, 2, 1],
  [39, 3, 2],
  [47, 5, 3],
  [88, 9, 6],
  [64, 5, 3],
  [51, 4, 2],
  [45, 3, 1],
  [40, 2, 2],
  [0, 0, 0],
  [36, 3, 1],
  [48, 4, 3],
  [57, 6, 2],
  [62, 5, 4],
  [50, 3, 2],
  [44, 4, 1],
  [40, 3, 2],
];

const seededDays: DailyDownloads[] = WINDOW.map((date, i) => {
  const [modrinth, curseforge, direct] = SEEDED[i] ?? [0, 0, 0];
  return { date, modrinth, curseforge, direct };
});

const emptyDays: DailyDownloads[] = WINDOW.map((date) => ({
  date,
  modrinth: 0,
  curseforge: 0,
  direct: 0,
}));

export const flatBarChartFixtures: FlatBarChartFixture[] = [
  {
    label: 'FlatBarChart · 30 days',
    props: { days: seededDays, title: CHART_TITLE, compact: false },
  },
  {
    label: 'FlatBarChart · compact',
    props: { days: seededDays, title: CHART_TITLE, compact: true },
  },
  {
    label: 'FlatBarChart · empty',
    props: { days: emptyDays, title: CHART_TITLE, compact: false },
  },
];
