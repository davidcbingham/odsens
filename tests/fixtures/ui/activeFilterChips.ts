/**
 * tests/fixtures/ui/activeFilterChips.ts — `ActiveFilterChips` for `/dev/components` (03 §2.3
 * `ActiveFilterChips`; DESIGN.md §5 "Active filters echo below…"; T-E2E-48). The component reads
 * `useSearchParams`: with no `?type=`/`?version=` on the dev route it renders NOTHING (its
 * spec'd empty behaviour); add `?type=mod&version=1.21.x` to the dev URL to see chips + Clear.
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { ActiveFilterChipsProps } from '@/components/projects/ActiveFilterChips';

export type ActiveFilterChipsFixture = { label: string; props: ActiveFilterChipsProps };

export const activeFilterChipsFixtures: ActiveFilterChipsFixture[] = [
  {
    label: 'ActiveFilterChips · url-driven',
    props: {
      labels: {
        mod: 'MODS',
        datapack: 'DATAPACKS',
        resourcepack: 'PACKS',
        plugin: 'PLUGINS',
        '1.21.x': '1.21.x',
        '1.20.x': '1.20.x',
        snapshots: 'snapshots',
      },
    },
  },
];
