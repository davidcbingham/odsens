/**
 * tests/fixtures/ui/statTile.ts — `StatTile` states for `/dev/components` (03 §2.2 `StatTile`;
 * DESIGN.md §11.1 Stat tile; T-E2E-48). Number values go through `formatCount` inside the
 * component (`1.2M`); the pre-snapshot empty state is the caller passing `0` + "No data yet."
 * (ADR-0002 #29). All three context tones. No DB, no network.
 */
import type { StatTileProps } from '@/components/primitives/StatTile';

export type StatTileFixture = { label: string; props: StatTileProps };

export const statTileFixtures: StatTileFixture[] = [
  {
    label: 'StatTile · up',
    props: {
      label: 'Downloads all time',
      value: 1_243_000,
      context: { text: 'Up 214 this week.', tone: 'up' },
    },
  },
  {
    label: 'StatTile · attention',
    props: {
      label: 'Comments',
      value: 38,
      context: { text: '4 held.', tone: 'attention' },
    },
  },
  {
    label: 'StatTile · neutral',
    props: {
      label: 'Downloads 7 days',
      value: 214,
      context: { text: 'Counts refresh hourly.', tone: 'neutral' },
    },
  },
  {
    label: 'StatTile · empty',
    props: {
      label: 'Tips 30 days',
      value: 0,
      context: { text: 'No data yet.', tone: 'neutral' },
    },
  },
  {
    label: 'StatTile · string value',
    props: { label: 'Last sync', value: '30 min ago' },
  },
];
